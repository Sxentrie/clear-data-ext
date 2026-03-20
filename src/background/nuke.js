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
 * @returns {Promise<{ cookieDomain: string }>}
 */
export async function nukeOriginAndReload(origin, tabId, preset) {
  if (IN_FLIGHT_TABS.has(tabId)) {
    throw Object.assign(
      new Error("A nuke operation is already in progress for this tab."),
      { code: "IN_FLIGHT" },
    );
  }

  IN_FLIGHT_TABS.add(tabId);
  await setBadge(tabId, BADGE_ACTIVE_TEXT, BADGE_ACTIVE_COLOR);

  const keepalive = startKeepalive();
  try {
    await chrome.browsingData.remove(
      { origins: [origin], since: BROWSING_DATA_SINCE },
      preset === PRESET_FULL ? DATA_TYPE_SET_FULL : DATA_TYPE_SET_SMART,
    );

    await new Promise((resolve) => setTimeout(resolve, RELOAD_DELAY_MS));

    await setBadge(tabId, BADGE_SUCCESS_TEXT, BADGE_SUCCESS_COLOR);
    try {
      await chrome.tabs.reload(tabId, { bypassCache: true });
    } catch {
      // Tab was closed by the user during the delay; abort SW watcher
      return { cookieDomain: estimateCookieDomain(origin) };
    }

    const dataTypes = preset === PRESET_FULL ? DATA_TYPE_SET_FULL : DATA_TYPE_SET_SMART;
    if (dataTypes.serviceWorkers) {
      watchForSwReregistration(tabId, origin);
    }

    return { cookieDomain: estimateCookieDomain(origin) };
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
