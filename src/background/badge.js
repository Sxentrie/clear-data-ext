/**
 * @file src/background/badge.js
 * @overview
 * Unified toolbar badge helper. Omitting text clears the badge.
 */

/**
 * Sets or clears the toolbar badge for a specific tab.
 * Omit text (or pass empty string) to clear the badge.
 *
 * @param {number} tabId
 * @param {string} [text]  Short badge label. Omit or "" to clear.
 * @param {string} [color] CSS colour string.
 */
export async function setBadge(tabId, text, color) {
  try {
    if (!text) {
      await chrome.action.setBadgeText({ text: "", tabId });
    } else {
      await Promise.all([
        chrome.action.setBadgeText({ text, tabId }),
        chrome.action.setBadgeBackgroundColor({ color, tabId }),
      ]);
    }
  } catch {
    // Non-fatal — badge APIs can fail on restricted pages or closed tabs.
  }
}
