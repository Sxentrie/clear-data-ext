/**
 * @file src/content/index.js
 * @overview
 * Classic-script bootstrapper for the content script module graph.
 *
 * chrome.scripting.executeScript injects classic scripts, NOT ES modules.
 * This wrapper uses dynamic import() to load the real module entry point
 * (main.js) and calls its named export.
 *
 * All module files must be listed in manifest.json web_accessible_resources
 * so the extension-internal URLs resolve correctly from the content world.
 */

"use strict";

(async () => {
  try {
    // Dynamic import without cache buster allows V8 to safely cache the module.
    // The idempotency logic is handled entirely inside toggleOverlay().
    const mod = await import(chrome.runtime.getURL("src/content/main.js"));
    mod.toggleOverlay();
  } catch (err) {
    console.error("[OriginNuke] Failed to load content modules:", err);
  }
})();
