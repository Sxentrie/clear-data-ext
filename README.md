# Origin Nuke

Chrome extension that clears origin-scoped browsing data and forces an unconditional tab reload without exposing the UI to host-page CSS interference.

## WHAT IT DOES

The extension operates as an atomic reset switch for the active tab's origin. When triggered, it injects an isolated UI overlay into the current document. This overlay provides a real-time storage inventory of the origin—querying active caches, IndexedDB databases, service workers, and total quota—before offering the developer a choice between a Smart Clear (preserving cookies) or a Full Nuke (destroying all state).

Upon confirmation, the background service worker executes a precise data clearance using `chrome.browsingData.remove` targeted strictly at the current origin. Bypassing the cache, it immediately hard-reloads the tab. 

Crucially, it guards against hostile single-page application behaviors. It tracks the tab through the reload lifecycle to detect if a service worker instantly re-registers upon navigation complete, alerting the developer via the extension badge if the application managed to persist its offline state machine.

## ARCHITECTURE

```text
src/
  background/
    badge.js         Controls the extension action badge text and color states.
    index.js         Service worker entry point routing clicks and IPC messages.
    keepalive.js     Maintains service worker lifecycle during async operations.
    nuke.js          Executes Chrome browsing data clearance and forces tab reload.
    swwatch.js       Listens for post-reload service worker re-registrations.
    throttle.js      Manages synchronous click debouncing via a Map.
  content/
    audit.js         Executes read-only queries against browser storage APIs.
    errors.js        Maps internal error codes to user-facing strings.
    index.js         Classic script bootstrapper that invokes the ES module graph.
    main.js          Holds module-level closure state for UI idempotency.
    overlay.js       Constructs the Shadow DOM UI and handles the state machine.
  shared/
    constants.js     Single source of truth for numeric limits and UI strings.
    validation.js    Validates web origins and memoizes cookie domain parsing.
```

The architecture explicitly separates the execution boundaries. Content scripts are restricted to pure DOM construction and read-only storage interrogation. All destructive data operations and tab navigations remain strictly contained within the background service worker, communicated via validated JSON messaging.

## TECHNICAL DECISIONS

Decision: Native ES Module Orchestration in Content Scripts
Problem: `chrome.scripting.executeScript` inevitably runs injected files as classic scripts. Attempting to use `import` statements throws syntax errors. Common workarounds involve Webpack bundling, dropping ES modules entirely in content scripts, or appending cache-busters like `?t=Date.now()` to dynamic imports, which creates uncollectable V8 module memory leaks inside the execution context.
Approach: `executeScript` loads a tiny bootstrapper (`content/index.js`) which runs a single `await import(chrome.runtime.getURL("src/content/main.js"))`. The ES modules are exposed via `web_accessible_resources`. Idempotency is preserved by exporting a `toggleOverlay` function from the ES module graph that maintains its own internal closure state, bypassing the need for global `window` locking.

Decision: Synchronous Exception Isolation in Storage Audits
Problem: When executing `auditOriginStorage`, accessing properties like `navigator.serviceWorker.getRegistrations()` or `window.indexedDB.databases()` directly assumes a permissive execution environment. In `file://` URLs, opaque iframes, or when third-party cookies are blocked, these APIs are either `undefined` or throw synchronous `DOMException`/`TypeError` errors immediately upon property access. `Promise.allSettled` only handles asynchronous rejections; a synchronous structural throw crashes the entire audit script.
Approach: Every storage API access is wrapped in its own isolated `try/catch` block containing a `typeof` capability check. If an API is blocked or unimplemented (e.g., `indexedDB` on Firefox), the sub-query silently swallows the error and resolves with a zero-count, allowing the remaining valid storage metrics to display.

Decision: IPC Promise Racing with Timer Cleanup
Problem: The `chrome.browsingData.remove` API lacks native timeout thresholds. If the Chrome backend hangs, the `await nukeOriginAndReload()` call blocks indefinitely, stranding the content script UI in a perpetual "Clearing" locked state.
Approach: The execution call is wrapped in a `Promise.race` against a 10-second `setTimeout`. A strict design rule guarantees the `timerId` is captured and explicitly passed to `clearTimeout()` in both the resolution and catch phases, ensuring successful rapid executions do not leave dangling closures artificially extending the background worker's keep-alive window.

Decision: Shadow DOM UI Encapsulation with Delayed Interpolation
Problem: Injecting HTML directly into a host page risks CSS conflict (the host tearing up the overlay styling) and DOM-based XSS (hostile URLs executing scripts when injected into innerHTML payloads).
Approach: The UI is rooted inside an `attachShadow({ mode: "closed" })` hierarchy using `all: initial` to block stylesheet inheritance. The structural template is built as a pure static HTML string. The active `origin` variable is never interpolated into the markup; it is injected strictly via `refs.originText.textContent` after the DOM nodes are materialized, fully neutralizing XSS risks.

## SAFETY INVARIANTS

1. Injection is strictly blocked on any URL scheme other than `http:` or `https:`.
2. The UI toggle mechanism verifies element containment against `document.documentElement` to survive pages lacking a standard `<body>`.
3. Background state Maps tracking active `tabId` throttling immediately evict dead IDs upon receiving the `chrome.tabs.onRemoved` event.
4. IPC channels catching `chrome.tabs.reload` exceptions immediately short-circuit to prevent deploying background listeners on dead UI tabs.
5. The `chrome.browsingData.remove` timestamp floor is hardcoded to offset `1` ms to bypass Chromium bug #432200328 at epoch zero.

## KNOWN CONSTRAINTS & TRADEOFFS

- Total origin storage quotas retrieved via `navigator.storage.estimate()` cannot be segmented natively by type. The bytes displayed in the UI audit represent the full origin quota, even if the user selects a preset that leaves portions of that quota intact.
- Service worker re-registration detection relies on a 1500ms heuristic delay following page load. Applications that lazily register their workers strictly upon user interaction will bypass this temporal watcher.
- `indexedDB.databases()` enumeration is a Chromium-only API. The codebase gracefully degrades its output on Firefox instances running the extension natively.

## SETUP

Load the extension into Chrome by opening `chrome://extensions/`, enabling Developer Mode, and selecting "Load unpacked" targeting the project root directory.
