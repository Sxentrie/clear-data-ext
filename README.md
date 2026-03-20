# Page Util — Origin Nuke

A Chrome extension that clears all origin-scoped browser storage for the active tab without requiring broad host permissions or touching data belonging to any other origin.

---

## What It Does

Clicking the toolbar icon injects an overlay into the active tab. The overlay presents two clearance presets: Smart Clear, which removes cache, cacheStorage, localStorage, IndexedDB, service workers, file system, and WebSQL while deliberately preserving cookies; and Full Nuke, which adds cookies to that set and surfaces an explicit warning that deletion will propagate to the entire eTLD+1 registrable domain. The user must click twice to execute either preset — the first click arms the button, a three-second timeout disarms it if unconfirmed, and the second click dispatches the operation.

The clearance itself is performed by `chrome.browsingData.remove()` in the background service worker, scoped to the exact origin of the sender tab via the `origins` parameter. Before any data is removed, the background cross-checks the origin claimed in the message payload against the actual URL of the sender tab as reported by the browser, rejecting any mismatch as a potential spoofing attempt. After removal completes, the tab is hard-reloaded with `bypassCache: true`. If the preset included service worker removal, `swwatch.js` then monitors the tab's next load-complete event and checks whether a service worker re-registered for the same origin, setting an amber toolbar badge if it did.

The non-trivial constraint shaping the entire design is the MV3 service worker lifecycle. Chromium terminates idle service workers after 30 seconds, and `return true` in the message listener keeps the IPC port open but does nothing to extend the worker's life. A storage heartbeat in `keepalive.js` writes to `chrome.storage.session` immediately on start and every 20 seconds thereafter — chrome API calls are the only mechanism that resets the idle timer reliably. A second constraint affects the content script: `chrome.scripting.executeScript` injects classic scripts, not ES modules. `src/content/index.js` exists solely to bridge this gap via a dynamic `import()` call that loads `main.js` and its module graph at runtime.

---

## Architecture

```
src/
  background/
    index.js        Entry point. Registers onClicked and onMessage listeners only.
    nuke.js         Core clearance operation. Owns IN_FLIGHT_TABS and calls keepalive.
    badge.js        Unified setBadge helper. Omitting text argument clears the badge.
    keepalive.js    Storage heartbeat that prevents premature service worker termination.
    throttle.js     Per-tab click throttle using a module-level Map for zero-latency reads.
    swwatch.js      Post-nuke service worker re-registration detector.
  content/
    index.js        Classic-script bootstrapper. Loads main.js via dynamic import().
    main.js         Module entry point. Owns overlay host reference and toggle logic.
    overlay.js      Full UI: Shadow DOM construction, state machine, preset and close controllers.
    audit.js        Queries live storage state (caches, IDB, SWs, quota) for the current origin.
    errors.js       Maps structured error codes from the background to user-readable strings.
  shared/
    constants.js    Single source of truth for every constant. Nothing is hardcoded elsewhere.
    validation.js   isValidWebOrigin() and memoized estimateCookieDomain().
icons/
manifest.json
```

The separation is enforced at three levels. `shared/` contains no platform-specific code and is imported by both execution environments. `background/` modules never touch the DOM. `content/` modules never call `chrome.browsingData` or `chrome.tabs`. `index.js` in each environment is the only file that wires modules together — pure logic modules do not import each other unless a direct dependency exists.

---

## Technical Decisions

**Decision: Synchronous return value in the message listener**
Problem: Declaring the `onMessage` listener as `async` causes it to implicitly return a Promise. Chromium validates the return value synchronously and treats a Promise as falsy, closing the IPC port immediately. The content script's `sendMessage` Promise resolves as `undefined` before `sendResponse` is ever called, and the UI freezes in the firing state with no error surfaced.
Approach: The listener in `src/background/index.js` is a plain synchronous function that returns the boolean literal `true`. The async work is dispatched inside a fire-and-forget IIFE, and `sendResponse` is called from within it.

**Decision: `since: 1` instead of omitting the `since` parameter**
Problem: Chromium issue #432200328 documents a failure where passing `since: 0` does not properly vacuum the underlying SQLite history databases in some configurations. The value `0` hits a null-time evaluation path in the engine.
Approach: `BROWSING_DATA_SINCE = 1` is defined in `constants.js` and passed to every `browsingData.remove()` call. One millisecond past the Unix epoch is functionally identical to "all time" for any stored data but avoids the defective code path entirely.

**Decision: Dynamic import bootstrapper for ES module content scripts**
Problem: `chrome.scripting.executeScript` with `files` injects a classic script, not an ES module. A classic script cannot use static `import` statements, which means the entire modular content script architecture would be unavailable without a bridge.
Approach: `src/content/index.js` is a classic script whose only job is to call `import(chrome.runtime.getURL("src/content/main.js"))`. All module files are listed under `web_accessible_resources` in `manifest.json` so their extension-internal URLs resolve correctly from the content world. Without the `web_accessible_resources` entry, the imports fail silently and the overlay never appears.

**Decision: Map-based throttle instead of session storage**
Problem: The original session-storage throttle issued an async read on every toolbar click, adding latency and requiring error handling around storage quota failures. The throttle exists purely to debounce rapid clicks within a single worker lifetime — it has no reason to survive a worker restart.
Approach: `src/background/throttle.js` maintains a module-level `Map<tabId, timestamp>`. Reads and writes are synchronous and free of API overhead. A `chrome.tabs.onRemoved` listener cleans up stale entries so the Map does not grow unboundedly across a long session.

**Decision: `IN_FLIGHT_TABS` Set in `nuke.js`**
Problem: Without a concurrency guard, a user who triggers the overlay on the same tab twice in quick succession — or whose first nuke resolves slowly — can dispatch two concurrent `browsingData.remove()` calls against the same origin. The second call races against the pending tab reload, potentially producing an inconsistent storage state.
Approach: `nuke.js` maintains a module-level `Set<number>`. `nukeOriginAndReload` throws with `code: "IN_FLIGHT"` if the tab is already present. The Set entry is deleted in the `finally` block so a failed nuke does not permanently lock the tab.

**Decision: Origin cross-check in the message handler**
Problem: A compromised or malicious page script can dispatch a `chrome.runtime.sendMessage` payload claiming any origin it chooses. Without verification, the extension would clear browsing data for whatever origin the attacker specified, not necessarily the origin of the tab that sent the message.
Approach: The handler in `src/background/index.js` extracts the tab's actual URL from `sender.tab.url` — a value provided by the browser, not the page — parses its origin, and rejects the message with `code: "ORIGIN_MISMATCH"` if it does not equal the claimed origin in the payload.

**Decision: `Promise.allSettled` in `audit.js`**
Problem: The storage audit queries four independent APIs: `caches.keys()`, `indexedDB.databases()`, `navigator.serviceWorker.getRegistrations()`, and `navigator.storage.estimate()`. Any of these can be absent or blocked by the host page's permissions policy. A single rejected promise in `Promise.all` would discard all other results.
Approach: All sub-queries push into an array and are awaited with `Promise.allSettled`. Each sub-query is also wrapped in its own try/catch so a thrown synchronous error during API existence checking doesn't prevent the others from running.

---

## Safety Invariants

1. The `origins` array passed to `chrome.browsingData.remove()` always contains exactly one entry — the verified origin of the sender tab. It is never derived from the message payload alone.
2. `isValidWebOrigin()` enforces a round-trip equality check: the string must equal `new URL(value).origin` exactly, rejecting any input with a path, query parameter, trailing slash, or non-http/https scheme.
3. The message listener never executes `nukeOriginAndReload` unless `claimedOrigin === tabOrigin`, where `tabOrigin` is parsed from `sender.tab.url`.
4. `minimum_chrome_version: "74"` in `manifest.json` prevents installation on any Chrome version where the `origins` parameter to `browsingData.remove()` is silently ignored, which would cause a global profile wipe instead of an origin-scoped one.
5. The overlay sets `refs.originText.textContent` — never `innerHTML` — when rendering the current origin, eliminating any XSS vector from an opaque or adversarially crafted origin string.
6. Only one nuke operation can be in-flight per tab at any time. `IN_FLIGHT_TABS` is checked before any API call and cleared unconditionally in the `finally` block.
7. The keepalive heartbeat ticks immediately at operation start, not after the first interval delay, ensuring the service worker is already heartbeating before the first async API call begins.

---

## Known Constraints and Tradeoffs

**Cookie deletion is always eTLD+1-scoped.** When Full Nuke is selected, Chromium broadens cookie deletion to the entire registrable domain regardless of the exact origin targeted. Clearing `https://app.example.com` wipes cookies for `.example.com` and all sibling subdomains. This is an immutable behavior of the Chromium engine and cannot be narrowed through any API configuration. Smart Clear avoids this entirely by omitting `cookies` from the data type set.

**The service worker re-registration detector is heuristic, not authoritative.** `swwatch.js` checks for re-registrations 1,500 ms after the tab reaches `complete` status. A service worker that registers earlier than that window, or on a page that never fires `complete`, will not be detected. The amber badge is informational — it does not attempt a second removal.

**Icons must be PNG.** The Chromium shell's native UI layers require pre-rasterized image data for toolbar and install dialog rendering. The SVG files in `icons/` are source assets only and cannot be referenced in `manifest.json`. PNG exports at 16, 32, 48, and 128 pixels are required for the extension to load without broken image placeholders or Chrome Web Store rejection.

**The extension operates only on `http:` and `https:` pages.** Attempting to open the overlay on `chrome://`, `edge://`, `about:blank`, or the Chrome Web Store causes `chrome.scripting.executeScript` to reject. This is caught and logged in `handleActionClick` but no user-facing feedback is provided for this case, since the toolbar icon is the only interaction surface and there is no popup to display an error in.

---

## Setup

Load as an unpacked extension:

1. Convert the SVG files in `icons/` to PNG at 16x16, 32x32, 48x48, and 128x128 pixels. The manifest references `.png` paths.
2. Open `chrome://extensions`, enable Developer Mode, click "Load unpacked", and select the project root directory.

No build step, no dependencies.