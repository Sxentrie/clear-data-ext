/**
 * @file src/background/keepalive.js
 * @overview
 * Service-worker keepalive heartbeat to prevent premature termination.
 */

import { KEEPALIVE_TICK_MS, KEEPALIVE_STORAGE_KEY } from "../shared/constants.js";

/**
 * Prevents the service worker from being killed mid-operation.
 * Writing to chrome.storage.session resets the 30 s idle countdown.
 * Ticks immediately, then every KEEPALIVE_TICK_MS.
 *
 * @returns {{ stop: () => void }}
 */
export function startKeepalive() {
  let active = true;

  const tick = async () => {
    if (!active) return;
    try {
      await chrome.storage.session.set({ [KEEPALIVE_STORAGE_KEY]: Date.now() });
    } catch {
      // Non-fatal.
    }
    if (active) setTimeout(tick, KEEPALIVE_TICK_MS);
  };

  tick();
  return { stop: () => { active = false; } };
}
