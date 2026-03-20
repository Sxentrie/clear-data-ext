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
    // Dynamic import fails on strict CSP (e.g., GitHub, Banks).
    // The Chromium implementation for MV3 scripting often blocks standard dynamic extension imports.
    const url = chrome.runtime.getURL("src/content/main.js");
    try {
      const mod = await import(url);
      mod.toggleOverlay();
    } catch {
      // Fallback: The page has a strict CSP blocking dynamic ES module imports.
      // We cannot use Blob URLs here as relative imports within the module map will fail.
      console.warn("[OriginNuke] CSP blocked module import. UI cannot be rendered.");
      if (window.confirm("Origin Nuke UI was blocked by this page's strict Security Policy.\n\nWould you like to instantly Smart-Clear this origin instead (preserves cookies)?")) {
        chrome.runtime.sendMessage({ action: "nuke", origin: location.origin, preset: "smart" });
      }
    }
  } catch (err) {
    console.error("[OriginNuke] Failed to load content modules:", err);
  }
})();
