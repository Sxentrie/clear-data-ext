/**
 * @file src/shared/constants.js
 * @overview
 * Single source of truth for every constant used across the extension.
 * No other module may hard-code any of these values.
 */

// ─── Preset names ─────────────────────────────────────────────────────────────

export const PRESET_SMART = "smart";
export const PRESET_FULL  = "full";

// ─── Data-type sets (per preset) ──────────────────────────────────────────────

/**
 * PRESET 1 — "Smart Clear" (default, safe).
 * Removes everything EXCEPT cookies so login sessions are preserved.
 */
export const DATA_TYPE_SET_SMART = Object.freeze({
  cache          : true,
  cacheStorage   : true,
  fileSystems    : true,
  indexedDB      : true,
  localStorage   : true,
  serviceWorkers : true,
  webSQL         : true,
});

/**
 * PRESET 2 — "Full Nuke" (opt-in, destructive).
 * Removes all 8 types including cookies.
 */
export const DATA_TYPE_SET_FULL = Object.freeze({
  cache          : true,
  cacheStorage   : true,
  cookies        : true,
  fileSystems    : true,
  indexedDB      : true,
  localStorage   : true,
  serviceWorkers : true,
  webSQL         : true,
});

// ─── Data-type display labels ─────────────────────────────────────────────────

export const DATA_LABELS_SMART =
  "cache, cacheStorage, localStorage, IndexedDB, service workers, file system, WebSQL";
export const DATA_LABELS_FULL =
  "cache, cacheStorage, cookies, localStorage, IndexedDB, service workers, file system, WebSQL";

// ─── Warning messages ─────────────────────────────────────────────────────────

export const WARNING_FULL_PREFIX = "Cookies will be cleared for ";
export const WARNING_FULL_SUFFIX = " and all subdomains.";

// ─── Schemes ──────────────────────────────────────────────────────────────────

export const VALID_SCHEMES = Object.freeze(["http:", "https:"]);

// ─── Timing ───────────────────────────────────────────────────────────────────

export const THROTTLE_MS          = 500;
export const KEEPALIVE_TICK_MS    = 20_000;
export const RELOAD_DELAY_MS      = 150;
export const BADGE_ERROR_CLEAR_MS = 3_000;
export const AUTO_DISARM_MS       = 3_000;
export const CLOSE_TIMEOUT_MS     = 300;
export const SUCCESS_CLOSE_DELAY_MS = 1_000;

// ─── Limits ───────────────────────────────────────────────────────────────────

export const MAX_ORIGIN_LENGTH = 2_048;

// ─── browsing data API ────────────────────────────────────────────────────────

/** Offset of 1 ms avoids Chromium bug #432200328 with since: 0. */
export const BROWSING_DATA_SINCE = 1;

export const SW_CHECK_DELAY_MS = 1_500;
export const SW_BADGE_CLEAR_MS = 6_000;

export const AUDIT_SNAPSHOT_KEY_PREFIX = "nuke_snap_";
export const AUDIT_SNAPSHOT_EXPIRY_MS  = 5 * 60 * 1000;

// ─── Badge feedback ───────────────────────────────────────────────────────────

export const BADGE_ACTIVE_TEXT   = "...";
export const BADGE_ACTIVE_COLOR  = "#a855f7";
export const BADGE_SUCCESS_TEXT  = "OK";
export const BADGE_SUCCESS_COLOR = "#22c55e";
export const BADGE_ERROR_TEXT    = "ERR";
export const BADGE_ERROR_COLOR   = "#ef4444";
export const BADGE_SW_REREGISTERED_TEXT  = "SW\u2191";
export const BADGE_SW_REREGISTERED_COLOR = "#f59e0b"; // amber

// ─── Content identifiers ─────────────────────────────────────────────────────

export const CONTAINER_ID  = "__page-util-nuke-overlay__";

// ─── Paths ────────────────────────────────────────────────────────────────────

export const CONTENT_SCRIPT_PATH = "src/content/index.js";

// ─── Keepalive ────────────────────────────────────────────────────────────────

export const KEEPALIVE_STORAGE_KEY = "__nuke_keepalive";
