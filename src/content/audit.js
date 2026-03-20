/**
 * @file src/content/audit.js
 * @overview
 * Queries the current origin's actual storage state for caches, IndexedDB,
 * service workers, and overall byte quota.
 */

/**
 * Returns a count-based inventory of existing origin data stores
 * using the highest fidelity APIs dynamically available.
 * Resolves to all zeros if execution sandbox restricts API visibility.
 * 
 * @param {string} origin
 * @returns {Promise<{caches:number, idbDatabases:number, serviceWorkers:number, bytes:number, cacheNames:string[], idbNames:string[]}>}
 */
export async function auditOriginStorage(origin) {
  const audit = {
    caches: 0, idbDatabases: 0, serviceWorkers: 0, bytes: 0,
    cacheNames: /** @type {string[]} */([]),
    idbNames:   /** @type {string[]} */([]),
  };
  const promises = [];

  try {
    if (window.caches && typeof caches.keys === "function") {
      promises.push(
        caches.keys().then((keys) => {
          audit.caches     = keys.length;
          audit.cacheNames = keys.slice();
        }),
      );
    }
  } catch {}

  try {
    if (window.indexedDB && typeof window.indexedDB.databases === "function") {
      promises.push(
        window.indexedDB.databases().then((dbs) => {
          audit.idbDatabases = dbs.length;
          audit.idbNames     = dbs.map((d) => d.name).filter(Boolean);
        }),
      );
    }
  } catch {}

  try {
    if (navigator.serviceWorker && typeof navigator.serviceWorker.getRegistrations === "function") {
      promises.push(navigator.serviceWorker.getRegistrations().then((regs) => {
        audit.serviceWorkers = regs.filter((r) => r.scope.startsWith(origin)).length;
      }));
    }
  } catch {}

  try {
    if (navigator.storage && typeof navigator.storage.estimate === "function") {
      promises.push(navigator.storage.estimate().then(({ usage }) => {
        audit.bytes = usage ?? 0;
      }));
    }
  } catch {}

  await Promise.allSettled(promises);
  return audit;
}

/**
 * Formats an audit result into a compact single-line summary.
 * Omits zero-count entries. Returns null if nothing was found.
 *
 * @param {{ caches: number, idbDatabases: number, serviceWorkers: number, bytes: number, cacheNames: string[], idbNames: string[] }} audit
 * @returns {string | null}
 */
export function formatAuditSummary(audit) {
  const lines = [];

  if (audit.bytes > 0) {
    const mb = audit.bytes / 1_048_576;
    lines.push(mb >= 0.1 ? `~${mb.toFixed(1)} MB` : `~${(audit.bytes / 1024).toFixed(0)} KB`);
  }

  const cacheNames = audit.cacheNames ?? [];
  if (cacheNames.length > 0) {
    for (const n of cacheNames) lines.push(`[Cache] ${n}`);
  } else if (audit.caches > 0) {
    lines.push(`${audit.caches} caches`);
  }

  const idbNames = audit.idbNames ?? [];
  if (idbNames.length > 0) {
    for (const n of idbNames) lines.push(`[IDB] ${n}`);
  } else if (audit.idbDatabases > 0) {
    lines.push(`${audit.idbDatabases} IDB`);
  }

  if (audit.serviceWorkers > 0) lines.push(`${audit.serviceWorkers} SW`);

  return lines.length > 0 ? lines : null;
}
