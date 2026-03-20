/**
 * @file src/content/audit.js
 * @overview
 * Queries the current origin's actual storage state for caches, IndexedDB,
 * service workers, and overall byte quota.
 */

/**
 * Queries the current origin's actual storage state.
 * All sub-queries are independent — a failure in one doesn't affect others.
 *
 * @param {string} origin
 * @returns {Promise<{ caches: number, idbDatabases: number, serviceWorkers: number, bytes: number }>}
 */
export async function auditOriginStorage(origin) {
  const result = { caches: 0, idbDatabases: 0, serviceWorkers: 0, bytes: 0 };
  const promises = [];

  try {
    if (window.caches && typeof caches.keys === "function") {
      promises.push(caches.keys().then((keys) => { result.caches = keys.length; }));
    }
  } catch {}

  try {
    if (window.indexedDB && typeof indexedDB.databases === "function") {
      promises.push(indexedDB.databases().then((dbs) => { result.idbDatabases = dbs.length; }));
    }
  } catch {}

  try {
    if (navigator.serviceWorker && typeof navigator.serviceWorker.getRegistrations === "function") {
      promises.push(navigator.serviceWorker.getRegistrations().then((regs) => {
        result.serviceWorkers = regs.filter((r) => r.scope.startsWith(origin)).length;
      }));
    }
  } catch {}

  try {
    if (navigator.storage && typeof navigator.storage.estimate === "function") {
      promises.push(navigator.storage.estimate().then(({ usage }) => {
        result.bytes = usage ?? 0;
      }));
    }
  } catch {}

  await Promise.allSettled(promises);
  return result;
}

/**
 * Formats an audit result into a compact single-line summary.
 * Omits zero-count entries. Returns null if nothing was found.
 *
 * @param {{ caches: number, idbDatabases: number, serviceWorkers: number, bytes: number }} audit
 * @returns {string | null}
 */
export function formatAuditSummary(audit) {
  const parts = [];

  if (audit.bytes > 0) {
    const mb = audit.bytes / 1_048_576;
    parts.push(mb >= 0.1 ? `~${mb.toFixed(1)}\u202FMB` : `~${(audit.bytes / 1024).toFixed(0)}\u202FKB`);
  }

  if (audit.caches > 0) {
    parts.push(`${audit.caches} cache${audit.caches !== 1 ? "s" : ""}`);
  }

  if (audit.idbDatabases > 0) {
    parts.push(`${audit.idbDatabases} IDB`);
  }

  if (audit.serviceWorkers > 0) {
    parts.push(`${audit.serviceWorkers}\u202FSW`);
  }

  return parts.length > 0 ? parts.join(" \u00B7 ") : null;
}
