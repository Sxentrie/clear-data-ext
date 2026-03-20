/**
 * @file src/shared/validation.js
 * @overview
 * Origin validation and memoised cookie-domain estimation.
 */

import { VALID_SCHEMES, MAX_ORIGIN_LENGTH } from "../shared/constants.js";



/**
 * Strict parity validation for exactly targeted origins.
 * Guaranteed to return true only for properly formed Scheme + Host origins.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidWebOrigin(value) {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > MAX_ORIGIN_LENGTH) return false;
  try {
    const parsed = new URL(value);
    if (!VALID_SCHEMES.includes(parsed.protocol)) return false;
    if (parsed.origin !== value) return false;
    if (!parsed.hostname) return false;
    return true;
  } catch {
    return false;
  }
}

/** @type {Map<string, string>} */
const cookieDomainCache = new Map();

/**
 * Estimates the eTLD+1 domain at which cookies will be deleted.
 * Results are memoised — the same origin always yields the same domain.
 *
 * @param {string} origin
 * @returns {string}  e.g. ".example.com"
 */
export function estimateCookieDomain(origin) {
  const cached = cookieDomainCache.get(origin);
  if (cached !== undefined) return cached;

  if (cookieDomainCache.size >= 1000) {
    cookieDomainCache.clear();
  }

  let result;
  try {
    result = new URL(origin).hostname;
  } catch {
    result = origin;
  }

  cookieDomainCache.set(origin, result);
  return result;
}
