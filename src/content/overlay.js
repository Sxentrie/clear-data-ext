/**
 * @file src/content/overlay.js
 * @overview
 * Modularised overlay UI with shadcn/ui aesthetic.
 * Fixed structural design to enforce Single Responsibility.
 */

import {
  CONTAINER_ID,
  AUTO_DISARM_MS,
  CLOSE_TIMEOUT_MS,
  SUCCESS_CLOSE_DELAY_MS,
  PRESET_SMART,
  PRESET_FULL,
  WARNING_FULL_PREFIX,
  WARNING_FULL_SUFFIX,
  DATA_LABELS_SMART,
  DATA_LABELS_FULL,
} from "../shared/constants.js";
import { estimateCookieDomain } from "../shared/validation.js";
import { friendlyErrorMessage } from "./errors.js";
import { auditOriginStorage, formatAuditSummary } from "./audit.js";

const STATES = Object.freeze({ IDLE: "idle", ARMED: "armed", FIRING: "firing" });

/**
 * Main entry point. Wires the functional controllers.
 * @returns {HTMLElement} The injected host element
 */
export function createOverlay() {
  const host = document.createElement("div");
  host.id = CONTAINER_ID;
  host.style.cssText =
    "all:initial; position:fixed; top:0; right:0; z-index:2147483647; pointer-events:none;";
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = buildTemplate();

  const origin = location.origin;
  const isValid = /^https?:\/\//.test(origin);
  const cookieDomain = isValid ? estimateCookieDomain(origin) : origin;

  // DOM Refs
  const refs = {
    overlay: shadow.getElementById("overlay"),
    closeBtn: shadow.getElementById("close-btn"),
    actionBtn: shadow.getElementById("action-btn"),
    dataTypes: shadow.getElementById("data-types"),
    warningEl: shadow.getElementById("warning"),
    statusEl: shadow.getElementById("status"),
    btnSmart: shadow.getElementById("btn-smart"),
    btnFull: shadow.getElementById("btn-full"),
    originText: shadow.getElementById("origin-text"),
  };

  // Safe DOM injection (prevents XSS from opaque/malformed origins)
  refs.originText.textContent = isValid ? origin : "Not a web page";
  refs.originText.className = isValid ? "origin" : "origin invalid";
  refs.actionBtn.disabled = !isValid;

  // State flag for the one-shot storage audit
  const auditState = { applied: false };

  // Initialize UI controllers
  const stateCtrl = setupStateController(refs, origin);
  setupPresetController(refs, cookieDomain, stateCtrl, auditState);
  setupCloseController(host, refs);

  // Kick off storage audit asynchronously
  auditOriginStorage(origin).then((audit) => {
    // Only apply if the user hasn't already toggled presets before we resolved
    if (!auditState.applied && refs.btnSmart.classList.contains("active")) {
      const summary = formatAuditSummary(audit);
      refs.dataTypes.textContent = summary || "No stored data detected";
      auditState.applied = true;
    }
  }).catch(() => {
    // Non-fatal, static label remains
  });

  // Entrance transition
  requestAnimationFrame(() => refs.overlay.classList.add("visible"));
  
  return host;
}

/**
 * Manages the overlay lifecycle and tear-down logic.
 */
function setupCloseController(host, refs) {
  let isClosing = false;
  let closeTimer = null;

  const close = () => {
    if (isClosing) return;
    isClosing = true;

    refs.overlay.classList.remove("visible");

    const onEnd = () => {
      clearTimeout(closeTimer);
      host.remove();
    };

    // Race conditional fallback if transitionend drops
    closeTimer = setTimeout(onEnd, CLOSE_TIMEOUT_MS);
    refs.overlay.addEventListener("transitionend", onEnd, { once: true });
  };

  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      document.removeEventListener("keydown", onKeyDown);
      close();
    }
  };

  // Close intercepts
  document.addEventListener("keydown", onKeyDown);

  const patchedClose = () => {
    document.removeEventListener("keydown", onKeyDown);
    close();
  };

  host.addEventListener("page-util:close", patchedClose);
  refs.closeBtn.addEventListener("click", patchedClose);
}

/**
 * Manages the Smart Clear vs Full Nuke toggles.
 */
function setupPresetController(refs, cookieDomain, stateCtrl, auditState) {
  const setPreset = (next) => {
    if (auditState.applied) {
      auditState.applied = false;
    }
    const isFull = next === PRESET_FULL;

    refs.btnSmart.classList.toggle("active", !isFull);
    refs.btnFull.classList.toggle("active", isFull);

    refs.dataTypes.textContent = isFull
      ? `Clears ${DATA_LABELS_FULL}`
      : `Clears ${DATA_LABELS_SMART}`;

    if (isFull) {
      refs.warningEl.textContent = WARNING_FULL_PREFIX + cookieDomain + WARNING_FULL_SUFFIX;
      refs.warningEl.classList.remove("hidden");
    } else {
      refs.warningEl.classList.add("hidden");
    }

    if (stateCtrl.getState() === STATES.ARMED) {
      stateCtrl.render(STATES.IDLE);
    }
  };

  // Initial state
  setPreset(PRESET_SMART);

  refs.btnSmart.addEventListener("click", () => setPreset(PRESET_SMART));
  refs.btnFull.addEventListener("click", () => setPreset(PRESET_FULL));
}

/**
 * Manages the core action button state machine and IPC dispatch.
 */
function setupStateController(refs, origin) {
  let currentState = STATES.IDLE;
  let armTimer = null;

  const showStatus = (type, msg) => {
    refs.statusEl.className = `status ${type}`;
    refs.statusEl.textContent = msg;
  };

  const render = (next) => {
    currentState = next;
    clearTimeout(armTimer);

    refs.actionBtn.className = `action-btn ${next}`;

    if (next === STATES.IDLE) {
      refs.actionBtn.disabled = false;
      refs.actionBtn.textContent = "Clear Origin Data";
    } else if (next === STATES.ARMED) {
      refs.actionBtn.disabled = false;
      refs.actionBtn.textContent = "Confirm \u2014 click again to execute";
      armTimer = setTimeout(() => {
        if (currentState === STATES.ARMED) render(STATES.IDLE);
      }, AUTO_DISARM_MS);
    } else if (next === STATES.FIRING) {
      refs.actionBtn.disabled = true;
      refs.actionBtn.textContent = "Clearing\u2026";
    }
  };

  refs.actionBtn.addEventListener("click", async () => {
    if (refs.actionBtn.disabled) return;

    if (currentState === STATES.IDLE) {
      render(STATES.ARMED);
      return;
    }

    if (currentState === STATES.ARMED) {
      render(STATES.FIRING);
      refs.statusEl.className = "status";

      const preset = refs.btnSmart.classList.contains("active") ? PRESET_SMART : PRESET_FULL;

      try {
        const response = await chrome.runtime.sendMessage({ action: "nuke", origin, preset });

        if (response?.success) {
          showStatus("success", "Done \u2014 origin data cleared. Reloading\u2026");
          setTimeout(() => refs.closeBtn.click(), SUCCESS_CLOSE_DELAY_MS);
        } else {
          // Safeguard: Do not leak raw err.message from IPC unhandled rejections directly into UI.
          showStatus("error", "Error \u2014 " + friendlyErrorMessage(response?.code, "Action failed."));
          console.error("[OriginNuke] IPC Error:", response?.error);
          render(STATES.IDLE);
        }
      } catch (err) {
        // Blanket catch for completely blown IPC channels (extension missing/reloaded)
        showStatus("error", "Error \u2014 Backend not responding. Please refresh the page.");
        console.error("[OriginNuke] Messaging Error:", err);
        render(STATES.IDLE);
      }
    }
  });

  return { render, getState: () => currentState };
}

/**
 * Returns static CSS and HTML string for Shadow DOM structural injection.
 */
function buildTemplate() {
  return `
<style>
:host {
  all: initial !important;
  display: block !important;
}
*, *::before, *::after {
  box-sizing: border-box;
}
.overlay {
  position: fixed;
  top: 16px;
  right: 16px;
  pointer-events: auto;
  opacity: 0;
  transform: translateY(-8px);
  transition: opacity 150ms ease, transform 150ms ease;
}
.overlay.visible {
  opacity: 1;
  transform: translateY(0);
}
.panel {
  width: 280px;
  background: #ffffff;
  border: 1px solid #e4e4e7;
  border-radius: 10px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.08);
  color: #0a0a0a;
  user-select: none;
}
.header-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.title {
  font-family: 'JetBrains Mono', 'Consolas', 'Courier New', monospace;
  font-size: 13px;
  font-weight: 600;
  color: #0a0a0a;
}
.close-btn {
  font-size: 18px;
  color: #71717a;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  line-height: 1;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
}
.close-btn:hover {
  color: #0a0a0a;
}
.origin {
  font-family: 'JetBrains Mono', 'Consolas', 'Courier New', monospace;
  font-size: 11px;
  color: #71717a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: -4px;
}
.origin.invalid {
  color: #dc2626;
}
hr {
  border: none;
  border-top: 1px solid #e4e4e7;
  margin: 0;
}
.toggle-group {
  display: flex;
  background: #f4f4f5;
  border-radius: 6px;
  padding: 2px;
  gap: 2px;
}
.toggle-btn {
  flex: 1;
  padding: 6px 0;
  font-size: 11px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-weight: 400;
  color: #71717a;
  background: none;
  border: 1px solid transparent;
  border-radius: 4px;
  cursor: pointer;
}
.toggle-btn.active {
  background: #ffffff;
  border-color: #e4e4e7;
  font-weight: 600;
  color: #0a0a0a;
}
.data-types {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  font-size: 10px;
  color: #71717a;
  line-height: 1.4;
}
.warning {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  font-size: 10px;
  color: #dc2626;
  line-height: 1.4;
}
.hidden {
  display: none;
}
.action-btn {
  width: 100%;
  height: 36px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  cursor: pointer;
  border: 1px solid transparent;
  transition: opacity 100ms ease;
}
.action-btn.idle {
  background: #3730a3;
  color: #fafafa;
}
.action-btn.idle:hover:not(:disabled) {
  opacity: 0.9;
}
.action-btn.armed {
  background: #dc2626;
  color: #ffffff;
  border-color: rgba(220,38,38,0.4);
}
.action-btn.armed:hover:not(:disabled) {
  opacity: 0.9;
}
.action-btn.firing {
  background: #f4f4f5;
  color: #71717a;
  cursor: not-allowed;
}
.action-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.status {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  font-size: 11px;
  line-height: 1.4;
  opacity: 0;
  transition: opacity 150ms ease;
}
.status.success {
  opacity: 1;
  color: #0a0a0a;
}
.status.error {
  opacity: 1;
  color: #dc2626;
}

@media (prefers-color-scheme: dark) {
  .panel {
    background: #171717;
    border-color: #27272a;
    color: #fafafa;
    box-shadow: 0 1px 3px rgba(0,0,0,0.32), 0 1px 2px rgba(0,0,0,0.24);
  }
  .title {
    color: #fafafa;
  }
  .close-btn {
    color: #a1a1aa;
  }
  .close-btn:hover {
    color: #fafafa;
  }
  .origin {
    color: #a1a1aa;
  }
  .origin.invalid {
    color: #f87171;
  }
  hr {
    border-top-color: #27272a;
  }
  .toggle-group {
    background: #171717;
  }
  .toggle-btn {
    color: #a1a1aa;
  }
  .toggle-btn.active {
    background: #262626;
    border-color: #27272a;
    color: #fafafa;
  }
  .data-types {
    color: #a1a1aa;
  }
  .warning {
    color: #f87171;
  }
  .action-btn.idle {
    background: #e4e4e7;
    color: #171717;
  }
  .action-btn.armed {
    background: #f87171;
    color: #ffffff;
    border-color: rgba(248,113,113,0.4);
  }
  .action-btn.firing {
    background: #262626;
    color: #a1a1aa;
  }
  .status.success {
    color: #fafafa;
  }
  .status.error {
    color: #f87171;
  }
}
</style>
<div class="overlay" id="overlay">
  <div class="panel">
    <div class="header-top">
      <span class="title">origin-nuke</span>
      <button class="close-btn" id="close-btn">&times;</button>
    </div>
    <span class="origin" id="origin-text"></span>
    <hr/>
    <div class="toggle-group">
      <button class="toggle-btn active" id="btn-smart">Smart Clear</button>
      <button class="toggle-btn" id="btn-full">Full Nuke</button>
    </div>
    <span class="data-types" id="data-types"></span>
    <span class="warning hidden" id="warning"></span>
    <hr/>
    <button class="action-btn idle" id="action-btn">Clear Origin Data</button>
    <span class="status" id="status"></span>
  </div>
</div>`;
}
