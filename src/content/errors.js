/**
 * @file src/content/errors.js
 * @overview
 * Translates structured error codes from the background script into
 * user-readable messages.
 */

/**
 * Returns a friendly, human-readable error message for the given error code.
 *
 * @param {string|undefined} code
 * @param {string|undefined} fallback
 * @returns {string}
 */
export function friendlyErrorMessage(code, fallback) {
  switch (code) {
    case "IN_FLIGHT"      : return "Already nuking this tab — please wait.";
    case "BAD_ORIGIN"     : return "This page's origin is not a valid web URL.";
    case "ORIGIN_MISMATCH": return "Security check failed — origin mismatch.";
    case "NO_TAB"         : return "Cannot identify the current tab.";
    default               : return fallback || "Nuke failed — unknown error.";
  }
}
