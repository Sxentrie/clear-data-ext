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
  AUDIT_SNAPSHOT_KEY_PREFIX,
  AUDIT_SNAPSHOT_EXPIRY_MS,
  SW_REREG_ESCALATE_AT,
  SW_REREG_EXPIRY_MS,
} from "../shared/constants.js";
import { estimateCookieDomain } from "../shared/validation.js";
import { friendlyErrorMessage } from "./errors.js";
import { auditOriginStorage, formatAuditSummary } from "./audit.js";

const STATES = Object.freeze({ IDLE: "idle", ARMED: "armed", FIRING: "firing" });

const SW_REREG_KEY_PREFIX = "sw_rereg_";

// ── Snapshot helpers ───────────────────────────────────────────────────────

function snapshotKey(origin) {
  // UTF-8 safe btoa encoding
  const utf8 = encodeURIComponent(origin).replace(/%([0-9A-F]{2})/g, (match, p1) => String.fromCharCode(parseInt(p1, 16)));
  return AUDIT_SNAPSHOT_KEY_PREFIX + btoa(utf8).replace(/[=+/]/g, "");
}

async function saveAuditSnapshot(origin, audit) {
  try {
    await chrome.storage.session.set({
      [snapshotKey(origin)]: { audit, ts: Date.now() },
    });
  } catch { /* Non-fatal — session storage quota exceeded on some profiles */ }
}

async function loadAuditSnapshot(origin) {
  try {
    const result = await chrome.storage.session.get(snapshotKey(origin));
    const entry = result[snapshotKey(origin)];
    if (!entry) return null;
    if (Date.now() - entry.ts > AUDIT_SNAPSHOT_EXPIRY_MS) {
      chrome.storage.session.remove(snapshotKey(origin));
      return null;
    }
    return entry;
  } catch { return null; }
}

async function loadSwReregFlag(origin) {
  const key = SW_REREG_KEY_PREFIX + encodeURIComponent(origin);
  try {
    const result = await chrome.storage.session.get(key);
    const flag = result[key];
    if (!flag) return null;

    const now     = Date.now();
    const cutoff  = now - SW_REREG_EXPIRY_MS;

    let recentEvents;
    if (Array.isArray(flag.events)) {
      recentEvents = flag.events.filter((ts) => ts > cutoff);
    } else if (typeof flag.ts === "number" && flag.ts > cutoff) {
      recentEvents = [flag.ts];
    } else {
      recentEvents = [];
    }

    if (recentEvents.length === 0) {
      chrome.storage.session.remove(key).catch(() => {});
      return null;
    }

    if (recentEvents.length !== flag.events?.length) {
      chrome.storage.session
        .set({ [key]: { origin, events: recentEvents } })
        .catch(() => {});
    }

    return { key, count: recentEvents.length };
  } catch { return null; }
}

// ── Regrowth message builder ───────────────────────────────────────────────

function buildRegrowthLine(snapshot, live) {
  const age = Math.round((Date.now() - snapshot.ts) / 1000);
  const lines = [];

  const liveNames  = live.cacheNames ?? [];
  const liveIdb    = live.idbNames   ?? [];

  const hasNameData = liveNames.length > 0 || liveIdb.length > 0
    || live.serviceWorkers > 0 || live.bytes > 0;

  if (!hasNameData) {
    return { lines: [`\u2713 Clean since nuke ${age}s ago`], type: "clean" };
  }

  lines.push(`\u26A0 Regrew ${age}s ago:`);

  if (live.bytes > 0) {
    const mb = live.bytes / 1_048_576;
    lines.push(mb >= 0.1 ? `> ~${mb.toFixed(1)} MB` : `> ~${(live.bytes / 1024).toFixed(0)} KB`);
  }

  for (const n of liveNames) lines.push(`> [Cache] ${n}`);
  for (const n of liveIdb) lines.push(`> [IDB] ${n}`);

  if (live.serviceWorkers > 0) lines.push(`> ${live.serviceWorkers} SW`);

  return { lines, type: "regrowth" };
}

// Safely appends multi-line text arrays into the DOM without XSS vulnerability vectors
function setConsoleLines(el, lines) {
  el.replaceChildren();
  for (const line of lines) {
    const div = document.createElement("div");
    // Prevent malicious lengths blowing out the shadow DOM height bounds
    div.textContent = line.length > 200 ? line.slice(0, 197) + "..." : line;
    el.appendChild(div);
  }
}

/**
 * Main entry point. Wires the functional controllers.
 * @returns {HTMLElement} The injected host element
 */
export function createOverlay() {
  const host = document.createElement("div");
  host.id = CONTAINER_ID;
  host.style.cssText =
    "all:initial; position:fixed; top:0; right:0; z-index:2147483647; pointer-events:none;";
    
  // Opt into the native Top Layer to hover above site <dialog>s and max z-indexes
  if ("popover" in host) host.popover = "manual";

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

  const swAlertEl     = shadow.getElementById("sw-alert");
  const unregisterBtn = shadow.getElementById("unregister-btn");

  // Safe DOM injection (prevents XSS from opaque/malformed origins)
  refs.originText.textContent = isValid ? origin : "Not a web page";
  refs.originText.className = isValid ? "origin" : "origin invalid";
  refs.actionBtn.disabled = !isValid;

  if (isValid) {
    const crossOriginFrames = Array.from(document.querySelectorAll("iframe")).filter((f) => {
      try { return new URL(f.src).origin !== origin; } catch { return false; }
    });
    if (crossOriginFrames.length > 0) {
      const warnBadge = document.createElement("div");
      warnBadge.className = "warning";
      warnBadge.style.marginTop = "6px";
      warnBadge.textContent = `\u26A0 ${crossOriginFrames.length} Cross-Origin Frame${crossOriginFrames.length > 1 ? "s" : ""} Excluded`;
      refs.originText.after(warnBadge);
    }
  }

  // Setup core logic and close routing
  const auditState = { applied: false };
  const stateCtrl = setupStateController(refs, origin, auditState);
  setupPresetController(refs, cookieDomain, stateCtrl, auditState);
  setupCloseController(host, refs);

  // Decoupled async data loader
  initializeOverlayData(origin, refs, swAlertEl, unregisterBtn, auditState);

  if (typeof host.showPopover === "function") {
    try { host.showPopover(); } catch {}
  }
  requestAnimationFrame(() => {
    refs.overlay.classList.add("visible");
    refs.actionBtn.focus();
  });
  
  return host;
}

/**
 * Handles all async layout and telemetry updates out of the rendering thread.
 */
async function initializeOverlayData(origin, refs, swAlertEl, unregisterBtn, auditState) {
  try {
    const audit = await auditOriginStorage(origin);
    auditState.lastResult = audit;

    const snapshot = await loadAuditSnapshot(origin);
    if (snapshot) {
      const { lines, type } = buildRegrowthLine(snapshot, audit);
      setConsoleLines(refs.dataTypes, lines);
      refs.dataTypes.className = type === "regrowth" ? "data-types regrowth" : "data-types clean";
      auditState.applied = true;
    } else if (!auditState.applied && refs.btnSmart.classList.contains("active")) {
      const summaryLines = formatAuditSummary(audit);
      if (summaryLines) {
        setConsoleLines(refs.dataTypes, summaryLines);
      } else {
        setConsoleLines(refs.dataTypes, ["No stored data detected"]);
      }
      auditState.applied = true;
    }

    const flag = await loadSwReregFlag(origin);
    if (!flag) return;
    swAlertEl.classList.remove("hidden");

    const swAlertText = swAlertEl.querySelector(".sw-alert-text");
    if (flag.count <= 1) {
      swAlertText.textContent = "\u26A0 SW re-registered after last nuke";
      swAlertText.style.color = "";
    } else if (flag.count < SW_REREG_ESCALATE_AT) {
      swAlertText.textContent = `\u26A0 SW re-registered ${flag.count}\u00D7 this session`;
      swAlertText.style.color = "";
    } else {
      swAlertText.textContent = `\u26A0 SW re-registered ${flag.count}\u00D7 \u2014 page script reinstalls on every load`;
      swAlertText.style.color = "var(--escalated-color, #dc2626)";
    }

    unregisterBtn.addEventListener("click", async () => {
      unregisterBtn.disabled = true;
      unregisterBtn.textContent = "Unregistering\u2026";

      try {
        const resp = await chrome.runtime.sendMessage({ action: "unregister_sw", origin });
        if (resp?.success) {
          const n = resp.count;
          unregisterBtn.textContent = `Unregistered ${n} SW`;
          chrome.storage.session.remove(flag.key).catch(() => {});
          setTimeout(() => swAlertEl.classList.add("hidden"), 1500);
        } else {
          unregisterBtn.textContent = "Failed \u2014 try full nuke";
          unregisterBtn.disabled = false;
        }
      } catch {
        unregisterBtn.textContent = "Error \u2014 backend unavailable";
        unregisterBtn.disabled = false;
      }
    });

  } catch {
    // Non-fatal, static layer remains visible.
  }
}

/**
 * Manages the overlay lifecycle and tear-down logic.
 */
function setupCloseController(host, refs) {
  let isClosing = false;
  let closeTimer = null;

  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      close();
    }
  };

  const close = () => {
    if (isClosing) return;
    isClosing = true;

    // Fix closure memory leak on the host window object
    host.removeEventListener("keydown", onKeyDown);
    refs.overlay.classList.remove("visible");

    const onEnd = () => {
      clearTimeout(closeTimer);
      host.remove();
    };

    closeTimer = setTimeout(onEnd, CLOSE_TIMEOUT_MS);
    refs.overlay.addEventListener("transitionend", onEnd, { once: true });
  };

  host.addEventListener("keydown", onKeyDown);

  const patchedClose = () => close();

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
      refs.dataTypes.className = "data-types";
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
function setupStateController(refs, origin, auditState) {
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
      const auditToSave = auditState.lastResult ?? { caches: 0, idbDatabases: 0, serviceWorkers: 0, bytes: 0 };

      try {
        await saveAuditSnapshot(origin, auditToSave);
        const response = await chrome.runtime.sendMessage({ action: "nuke", origin, preset });

        if (response?.success) {
          showStatus("success", "Done \u2014 origin data cleared. Reloading\u2026");
          
          const receiptLines = Object.entries(response.metrics || {})
            .map(([typ, ms]) => `> [${typ}] ${ms}ms`);
            
          if (response.killedSwCount) {
             receiptLines.unshift(`\u26A0 Killed SW Locks: ${response.killedSwCount}`);
          }
          
          if (receiptLines.length > 0) {
             setConsoleLines(refs.dataTypes, receiptLines);
             refs.dataTypes.className = "data-types clean";
          }
          
          setTimeout(() => {
            refs.closeBtn.click();
            window.location.reload();
          }, 1500);
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
:host { all: initial !important; display: block !important; }
*, *::before, *::after { box-sizing: border-box; }
.overlay {
  position: fixed; top: 16px; right: 16px; pointer-events: auto;
  opacity: 0; transform: translateY(-8px) scale(0.98);
  transition: opacity 200ms cubic-bezier(0.16, 1, 0.3, 1), transform 200ms cubic-bezier(0.16, 1, 0.3, 1);
  font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif;
}
.overlay.visible { opacity: 1; transform: translateY(0) scale(1); }
.panel {
  width: 320px; background: #ffffff; border: 1px solid #e4e4e7; border-radius: 12px;
  padding: 14px 16px; display: flex; flex-direction: column; gap: 14px;
  box-shadow: 0 10px 15px -3px rgba(0,0,0,0.06), 0 4px 6px -4px rgba(0,0,0,0.05);
  color: #0a0a0a; user-select: none;
}
.header-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: -10px; }
.title { font-size: 14px; font-weight: 600; letter-spacing: -0.01em; }
.close-btn { font-size: 18px; color: #a1a1aa; background: none; border: none; cursor: pointer; padding: 0; line-height: 1; transition: color 100ms; }
.close-btn:hover { color: #0a0a0a; }
.origin { font-family: 'JetBrains Mono', 'Consolas', monospace; font-size: 11.5px; color: #71717a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.origin.invalid { color: #dc2626; }
hr { border: none; border-top: 1px solid #e4e4e7; margin: 0; }
.section { display: flex; flex-direction: column; gap: 8px; }
.toggle-group { display: flex; background: #f4f4f5; border-radius: 8px; padding: 3px; gap: 2px; }
.toggle-btn {
  flex: 1; padding: 6px 0; font-size: 11px; font-weight: 500;
  color: #71717a; background: none; border: 1px solid transparent; border-radius: 6px; cursor: pointer;
  box-shadow: none; transition: all 150ms ease;
}
.toggle-btn.active { background: #ffffff; border-color: rgba(0,0,0,0.08); color: #0a0a0a; box-shadow: 0 1px 2px rgba(0,0,0,0.06); font-weight: 600; }
.data-box {
  background: #fafafa; border: 1px solid #e4e4e7; border-radius: 8px;
  padding: 8px 10px; height: 100px; display: flex; align-items: flex-start;
  overflow-y: auto; overflow-wrap: anywhere;
}
.data-box::-webkit-scrollbar { width: 6px; }
.data-box::-webkit-scrollbar-track { background: transparent; }
.data-box::-webkit-scrollbar-thumb { background: #d4d4d8; border-radius: 3px; }
.data-types { font-family: 'JetBrains Mono', 'Consolas', monospace; font-size: 10px; color: #52525b; line-height: 1.5; margin: 0; width: 100%; display: flex; flex-direction: column; }
.data-types.regrowth { color: #dc2626; font-weight: 600; }
.data-types.clean { color: #16a34a; font-weight: 600; }
.warning { font-size: 10.5px; color: #dc2626; line-height: 1.4; font-weight: 500; }
.sw-alert {
  display: flex; align-items: center; justify-content: space-between;
  background: #fffbeb; border: 1px solid #fcd34d; border-radius: 8px; padding: 8px 10px; gap: 10px;
}
.sw-alert.hidden { display: none; }
.sw-alert-text { font-size: 10px; color: #b45309; line-height: 1.3; flex: 1; font-weight: 500; margin: 0; }
.unregister-btn {
  flex-shrink: 0; height: 26px; padding: 0 10px; border-radius: 6px; font-size: 10px; font-weight: 600;
  cursor: pointer; background: #fbbf24; border: 1px solid #f59e0b; color: #78350f;
  transition: background 150ms;
}
.unregister-btn:hover:not(:disabled) { background: #f59e0b; }
.unregister-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.hidden { display: none; }
.action-box { display: flex; flex-direction: column; gap: 6px; }
.action-btn {
  width: 100%; height: 38px; border-radius: 8px; font-size: 13px; font-weight: 600;
  cursor: pointer; border: 1px solid transparent; transition: all 150ms ease;
  box-shadow: 0 1px 2px rgba(0,0,0,0.08);
  position: relative; overflow: hidden;
}
.action-btn:focus-visible { outline: 2px solid #a855f7; outline-offset: 2px; }
.action-btn::after {
  content: ""; position: absolute; inset: 0; background: rgba(0,0,0,0.15);
  transform-origin: left; transform: scaleX(0); pointer-events: none;
}
.action-btn.armed::after {
  animation: armed-countdown 3s linear forwards;
}
@keyframes armed-countdown {
  0% { transform: scaleX(1); }
  100% { transform: scaleX(0); }
}
.action-btn.idle { background: #18181b; color: #fafafa; }
.action-btn.idle:hover:not(:disabled) { background: #27272a; }
.action-btn.armed { background: #ef4444; color: #ffffff; border-color: #dc2626; }
.action-btn.armed:hover:not(:disabled) { background: #dc2626; }
.action-btn.firing { background: #f4f4f5; color: #a1a1aa; box-shadow: none; border-color: #e4e4e7;}
.action-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.status { font-size: 11px; line-height: 1.4; opacity: 0; transition: opacity 200ms; text-align: center; }
.status.success { opacity: 1; color: #16a34a; font-weight: 500; }
.status.error { opacity: 1; color: #dc2626; font-weight: 500; }

@media (prefers-color-scheme: dark) {
  .panel { background: #09090b; border-color: #27272a; color: #fafafa; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.5); }
  .title { color: #fafafa; }
  .close-btn { color: #71717a; } .close-btn:hover { color: #fafafa; }
  .origin { color: #a1a1aa; }
  hr { border-top-color: #27272a; }
  .toggle-group { background: #18181b; }
  .toggle-btn { color: #a1a1aa; }
  .toggle-btn.active { background: #27272a; border-color: rgba(255,255,255,0.05); color: #fafafa; }
  .data-box { background: #18181b; border-color: #27272a; }
  .data-box::-webkit-scrollbar-thumb { background: #3f3f46; }
  .data-types { color: #a1a1aa; }
  .data-types.clean { color: #4ade80; }
  .data-types.regrowth { color: #f87171; }
  .sw-alert { background: #451a03; border-color: #78350f; }
  .sw-alert-text { color: #fcd34d; }
  .unregister-btn { background: #78350f; border-color: #92400e; color: #fde68a; }
  .unregister-btn:hover:not(:disabled) { background: #92400e; }
  .action-btn.idle { background: #fafafa; color: #09090b; border-color: #fafafa; }
  .action-btn.idle:hover:not(:disabled) { background: #e4e4e7; border-color: #e4e4e7; }
  .action-btn.armed { background: #dc2626; border-color: #b91c1c; }
  .action-btn.firing { background: #27272a; border-color: #3f3f46; color: #71717a; }
  .status.success { color: #4ade80; }
  .status.error { color: #f87171; }
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
    <div class="section">
      <div class="toggle-group">
        <button class="toggle-btn active" id="btn-smart">Smart Clear</button>
        <button class="toggle-btn" id="btn-full">Full Nuke</button>
      </div>
      <div class="data-box">
        <span class="data-types" id="data-types"></span>
      </div>
      <span class="warning hidden" id="warning"></span>
    </div>
    <div class="sw-alert hidden" id="sw-alert">
      <span class="sw-alert-text"></span> <!-- JS assigns text reliably later -->
      <button class="unregister-btn" id="unregister-btn">Unregister</button>
    </div>
    <hr/>
    <div class="action-box">
      <button class="action-btn idle" id="action-btn">Clear Origin Data</button>
      <span class="status" id="status"></span>
    </div>
  </div>
</div>`;
}
