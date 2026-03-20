/**
 * @file src/background/index.js
 * @overview
 * Service Worker entry point. Registers all listeners and wires modules.
 */

import {
  VALID_SCHEMES,
  THROTTLE_MS,
  PRESET_SMART,
  PRESET_FULL,
  CONTENT_SCRIPT_PATH,
} from "../shared/constants.js";
import { isValidWebOrigin } from "../shared/validation.js";
import { getLastClickTime, setLastClickTime } from "./throttle.js";
import { nukeOriginAndReload } from "./nuke.js";

// ─── Startup guard ────────────────────────────────────────────────────────────

(function validateAPI() {
  if (typeof chrome?.browsingData?.remove !== "function") {
    console.error(
      "[OriginNuke] FATAL: chrome.browsingData.remove is unavailable. " +
      "Ensure the 'browsingData' permission is declared and Chrome >= 74.",
    );
  }
})();

// ─── Action icon click ────────────────────────────────────────────────────────

/**
 * Named async handler — replaces the previous IIFE wrapper.
 * Throttle functions are now synchronous (Map-based).
 */
async function handleActionClick(tab) {
  if (!tab?.id || !tab.url) return;

  let scheme;
  try {
    ({ protocol: scheme } = new URL(tab.url));
  } catch {
    return;
  }

  if (!VALID_SCHEMES.includes(scheme)) {
    console.warn("[OriginNuke] Unsupported tab scheme:", scheme);
    return;
  }

  const now  = Date.now();
  const last = getLastClickTime(tab.id);

  if (now - last < THROTTLE_MS) {
    console.debug("[OriginNuke] Click throttled for tab:", tab.id);
    return;
  }
  setLastClickTime(tab.id, now);

  try {
    await chrome.scripting.executeScript({
      target : { tabId: tab.id },
      files  : [CONTENT_SCRIPT_PATH],
    });
  } catch (err) {
    console.warn("[OriginNuke] Injection rejected by browser:", err.message);
  }
}

chrome.action.onClicked.addListener(handleActionClick);

// ─── Message handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.action !== "nuke") return false;

  const tabId  = sender?.tab?.id;
  const tabUrl = sender?.tab?.url;

  if (typeof tabId !== "number" || tabId < 0) {
    sendResponse({ success: false, error: "Cannot identify sender tab.", code: "NO_TAB" });
    return false;
  }

  const preset = message.preset === PRESET_FULL ? PRESET_FULL : PRESET_SMART;
  const { origin: claimedOrigin } = message;

  if (!claimedOrigin || !isValidWebOrigin(claimedOrigin)) {
    sendResponse({ success: false, error: "Invalid or non-web origin.", code: "BAD_ORIGIN" });
    return false;
  }

  let tabOrigin;
  try {
    tabOrigin = new URL(tabUrl).origin;
  } catch {
    sendResponse({ success: false, error: "Cannot parse sender tab URL.", code: "BAD_TAB_URL" });
    return false;
  }

  if (claimedOrigin !== tabOrigin) {
    console.error("[OriginNuke] Origin mismatch:", claimedOrigin, "|", tabOrigin);
    sendResponse({ success: false, error: "Origin mismatch.", code: "ORIGIN_MISMATCH" });
    return false;
  }

  (async () => {
    let timerId;
    try {
      const timeout = new Promise((_, reject) => {
        timerId = setTimeout(() => reject(Object.assign(new Error("Nuke operation timed out."), { code: "TIMEOUT" })), 10000);
      });
      const { cookieDomain } = await Promise.race([
        nukeOriginAndReload(claimedOrigin, tabId, preset),
        timeout
      ]);
      clearTimeout(timerId);
      sendResponse({ success: true, cookieDomain });
    } catch (err) {
      clearTimeout(timerId);
      console.error("[OriginNuke] Nuke failed:", err);
      sendResponse({
        success : false,
        error   : err?.message ?? "Unknown error during data clearance.",
        code    : err?.code ?? "UNKNOWN",
      });
    }
  })();

  return true;
});
