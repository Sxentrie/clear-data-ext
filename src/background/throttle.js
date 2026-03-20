/**
 * @file src/background/throttle.js
 * @overview
 * Per-tab click throttle using a module-level Map for zero-latency reads.
 * No session storage — the throttle does not need to survive worker restarts.
 */

/** @type {Map<number, number>} */
const clickTimes = new Map();

/**
 * Returns the last accepted click timestamp for the given tab, or 0.
 * @param {number} tabId
 * @returns {number}
 */
export function getLastClickTime(tabId) {
  return clickTimes.get(tabId) ?? 0;
}

/**
 * Records the last accepted click timestamp for the given tab.
 * @param {number} tabId
 * @param {number} ts
 */
export function setLastClickTime(tabId, ts) {
  clickTimes.set(tabId, ts);
}

chrome.tabs.onRemoved.addListener((tabId) => {
  clickTimes.delete(tabId);
});
