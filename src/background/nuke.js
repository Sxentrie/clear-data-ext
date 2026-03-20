/**
 * @file src/background/nuke.js
 * @overview
 * Core nuke operation — clears origin-scoped browsing data and reloads the tab.
 */

import {
  PRESET_FULL,
  DATA_TYPE_SET_SMART,
  DATA_TYPE_SET_FULL,
  BROWSING_DATA_SINCE,
  RELOAD_DELAY_MS,
  BADGE_ERROR_CLEAR_MS,
  BADGE_ACTIVE_TEXT,
  BADGE_ACTIVE_COLOR,
  BADGE_SUCCESS_TEXT,
  BADGE_SUCCESS_COLOR,
  BADGE_ERROR_TEXT,
  BADGE_ERROR_COLOR,
} from "../shared/constants.js";
import { setBadge } from "./badge.js";
import { startKeepalive } from "./keepalive.js";
import { estimateCookieDomain } from "../shared/validation.js";
import { watchForSwReregistration } from "./swwatch.js";

/** @type {Set<number>} */
const IN_FLIGHT_TABS = new Set();

/**
 * Clears all origin-scoped browsing data for `origin`, then hard-reloads the tab.
 *
 * @param {string} origin
 * @param {number} tabId
 * @param {string} preset  "smart" or "full"
 * @param {boolean} triggeredViaUi true if called from the overlay, false if headless command
 * @returns {Promise<{ cookieDomain: string }>}
 */
export async function nukeOriginAndReload(origin, tabId, preset, triggeredViaUi = true) {
  if (IN_FLIGHT_TABS.has(tabId)) {
    throw Object.assign(
      new Error("A nuke operation is already in progress for this tab."),
      { code: "IN_FLIGHT" },
    );
  }

  IN_FLIGHT_TABS.add(tabId);
  await setBadge(tabId, BADGE_ACTIVE_TEXT, BADGE_ACTIVE_COLOR);

  const keepalive = startKeepalive();
  const metrics = {};
  let killedSwCount = 0;

  try {
    // 1. Hunter-Killer: Discover all tabs active on this origin and force-drop their SW / IDB locks
    // Optimized: filter down to the origin at the C++ layer.
    const targetTabs = await chrome.tabs.query({ url: origin + "/*" });

    await Promise.allSettled(targetTabs.map(t => 
      chrome.scripting.executeScript({
        target: { tabId: t.id },
        func: async () => {
          let swKilled = 0;
          if (typeof navigator !== "undefined" && navigator.serviceWorker) {
            const regs = await navigator.serviceWorker.getRegistrations();
            await Promise.allSettled(regs.map(r => r.unregister()));
            swKilled = regs.length;
          }
          if (typeof window !== "undefined" && window.indexedDB && indexedDB.databases) {
            try {
              const dbs = await indexedDB.databases();
              const drops = [];
              for (const db of dbs) {
                if (db.name) {
                  drops.push(new Promise(resolve => {
                    const req = indexedDB.deleteDatabase(db.name);
                    req.onsuccess = resolve;
                    req.onerror = resolve;
                    req.onblocked = resolve;
                  }));
                }
              }
              await Promise.allSettled(drops);
            } catch (e) {}
          }
          return swKilled;
        }
      }).then(res => {
        if (res?.[0]?.result) killedSwCount += res[0].result;
      })
    ));

    // 2. Headless execution compatibility & API concurrency compliance
    const dataTypes = preset === PRESET_FULL ? DATA_TYPE_SET_FULL : DATA_TYPE_SET_SMART;
    
    // Send one bundled removal request so Chromium doesn't fragment the SQLite database locks.
    const start = performance.now();
    await chrome.browsingData.remove(
      { origins: [origin], since: BROWSING_DATA_SINCE },
      dataTypes
    );
    metrics["bundled_clearance"] = Math.round(performance.now() - start);

    await setBadge(tabId, BADGE_SUCCESS_TEXT, BADGE_SUCCESS_COLOR);

    if (!triggeredViaUi) {
      await new Promise((resolve) => setTimeout(resolve, RELOAD_DELAY_MS));
      try {
        await chrome.tabs.reload(tabId, { bypassCache: true });
      } catch {
        // Ignored if tab closed
      }
    }

    if (dataTypes.serviceWorkers) {
      watchForSwReregistration(tabId, origin);
    }

    return { cookieDomain: estimateCookieDomain(origin), metrics, killedSwCount };
  } catch (err) {
    if (!err.code) err.code = "API_ERROR";
    await setBadge(tabId, BADGE_ERROR_TEXT, BADGE_ERROR_COLOR);
    setTimeout(() => setBadge(tabId), BADGE_ERROR_CLEAR_MS);
    throw err;
  } finally {
    IN_FLIGHT_TABS.delete(tabId);
    keepalive.stop();
  }
}
