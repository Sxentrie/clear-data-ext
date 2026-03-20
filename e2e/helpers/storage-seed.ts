import { Page } from "@playwright/test";

/** Seeds all major storage types in the current page origin */
export async function seedAllStorage(page: Page) {
  await page.evaluate(async () => {
    // localStorage
    localStorage.setItem("nuke-test-key", "nuke-test-value");
    // sessionStorage
    sessionStorage.setItem("nuke-test-session", "yes");

    // Cache API
    const cache = await caches.open("nuke-test-cache");
    await cache.put("/nuke-test", new Response("hello"));

    // IndexedDB
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("nuke-test-idb", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("store");
      req.onsuccess = () => {
        req.result.close();
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
  });
}

/** Returns true if all seeded storage types are empty */
export async function assertStorageEmpty(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    const lsEmpty   = localStorage.getItem("nuke-test-key") === null;
    const cacheKeys = await caches.keys();
    const cacheEmpty = !cacheKeys.includes("nuke-test-cache");
    // IDB check: open and count object stores
    const idbEmpty = await new Promise<boolean>((resolve) => {
      const req = indexedDB.open("nuke-test-idb");
      req.onsuccess = () => {
        resolve(req.result.objectStoreNames.length === 0);
        req.result.close();
      };
      req.onerror = () => resolve(true); // DB gone = empty
    });
    return lsEmpty && cacheEmpty && idbEmpty;
  });
}

/** Registers a no-op service worker in the current origin */
export async function registerServiceWorker(page: Page, swPath = "/sw.js") {
  await page.evaluate(async (path) => {
    await navigator.serviceWorker.register(path);
    await navigator.serviceWorker.ready;
  }, swPath);
}

/** Returns number of SW registrations for this origin */
export async function getSwCount(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const regs = await navigator.serviceWorker.getRegistrations();
    return regs.length;
  });
}

export async function setCookie(page: Page, url: string, name: string, value: string) {
  await page.context().addCookies([{
    name, value, url, sameSite: "Lax"
  }]);
}

export async function getCookie(page: Page, url: string, name: string) {
  const cookies = await page.context().cookies(url);
  return cookies.find(c => c.name === name);
}
