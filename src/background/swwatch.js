/**
 * @file src/background/swwatch.js
 * @overview
 * Watches for malicious/instant service worker re-registrations that fire
 * immediately after nukeOriginAndReload triggers a tab reload.
 */

import {
  SW_CHECK_DELAY_MS,
  SW_BADGE_CLEAR_MS,
  BADGE_SW_REREGISTERED_TEXT,
  BADGE_SW_REREGISTERED_COLOR,
  SW_REREG_EXPIRY_MS,
} from "../shared/constants.js";
import { setBadge } from "./badge.js";

const SW_REREG_KEY_PREFIX = "sw_rereg_";

/**
 * After a nuke that cleared service workers, watches for the tab to finish
 * loading, then checks whether a SW re-registered for the same origin.
 * Sets an amber badge if re-registration is detected.
 *
 * @param {number} tabId
 * @param {string} origin   The nuked origin (e.g. "https://example.com")
 */
export function watchForSwReregistration(tabId, origin) {
  let safetyTimeoutId;

  // One-shot listener: fires on any tab update, filters to ours.
  function onUpdated(updatedTabId, changeInfo) {
    if (updatedTabId !== tabId || changeInfo.status !== "complete") return;
    
    chrome.tabs.onUpdated.removeListener(onUpdated);
    clearTimeout(safetyTimeoutId);

    // SW.register() is called asynchronously after page load.
    // A delay captures most real-world registration patterns.
    setTimeout(async () => {
      let swCount = 0;
      try {
        const [result] = await chrome.scripting.executeScript({
          target: { tabId },
          // executeScript seamlessly awaits Promise-returning functions in MV3
          func: async (nukedOrigin) => {
            if (typeof navigator.serviceWorker === "undefined") return 0;
            const regs = await navigator.serviceWorker.getRegistrations();
            return regs.filter((r) => r.scope.startsWith(nukedOrigin)).length;
          },
          args: [origin],
        });
        swCount = result?.result ?? 0;
      } catch {
        // Tab navigated away, closed, or scripting blocked — ignore.
        return;
      }

      if (swCount > 0) {
        const flagKey = SW_REREG_KEY_PREFIX + encodeURIComponent(origin);
        
        // Read-modify-write: append this detection timestamp to the events array.
        let events = [];
        try {
          const existing = await chrome.storage.session.get(flagKey);
          const stored = existing[flagKey];
          const cutoff = Date.now() - SW_REREG_EXPIRY_MS;
          
          if (Array.isArray(stored?.events)) {
            events = stored.events.filter((ts) => ts > cutoff);
          } else if (typeof stored?.ts === "number" && stored.ts > cutoff) {
            events = [stored.ts]; // Migrate legacy storage structs dynamically
          }
        } catch { /* Non-fatal */ }

        events.push(Date.now());
        chrome.storage.session
          .set({ [flagKey]: { origin, events } })
          .catch(() => {});

        await setBadge(tabId, BADGE_SW_REREGISTERED_TEXT, BADGE_SW_REREGISTERED_COLOR);
        // Auto-clear after display window; pass no text to reset.
        setTimeout(() => setBadge(tabId), SW_BADGE_CLEAR_MS);
      }
    }, SW_CHECK_DELAY_MS);
  }

  chrome.tabs.onUpdated.addListener(onUpdated);

  // Safety valve: if the tab never reaches 'complete' (closed, crashed),
  // remove the listener to prevent memory leaks in the background worker.
  safetyTimeoutId = setTimeout(() => {
    chrome.tabs.onUpdated.removeListener(onUpdated);
  }, 30_000);
}
