/**
 * @file src/content/main.js
 * @overview
 * Content script ES module entry point.
 * Exports toggleOverlay to handle idempotency using module-level state.
 */


import { createOverlay } from "./overlay.js";

/** @type {HTMLElement | null} */
let overlayHost = null;

/**
 * Toggles the overlay. Safe to call multiple times because module
 * state survives across dynamic imports without memory leaks.
 */
export function toggleOverlay() {
  if (overlayHost && document.documentElement.contains(overlayHost)) {
    overlayHost.dispatchEvent(new CustomEvent("page-util:close"));
  } else {
    // Clean up detached host if any.
    if (overlayHost) overlayHost.remove();
    overlayHost = createOverlay();
  }
}
