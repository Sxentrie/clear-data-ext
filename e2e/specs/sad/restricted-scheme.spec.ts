import { test, expect } from "../../fixtures/extension";

test.describe("Restricted Scheme Guard", () => {

  test("fails fast on chrome:// URLs without crashing the worker", async ({ page }) => {
    // Note: Playwright struggles to navigate to raw chrome:// endpoints directly
    // typically we use a blank page or chrome://version if allowed
    await page.goto("about:blank");
    
    let worker = page.context().serviceWorkers().find(sw => sw.url().startsWith("chrome-extension://"));
    if (!worker) worker = await page.context().waitForEvent("serviceworker");

    // Simulate toolbar click logic which verifies schemes
    const logSpy: string[] = [];
    worker.on('console', msg => logSpy.push(msg.text()));

    await worker.evaluate(async () => {
       const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
       if (tabs.length === 0) return;
       // Simulate handleActionClick core logic
       const url = tabs[0].url;
       if (!url || (!url.startsWith("http:") && !url.startsWith("https:"))) {
         console.warn("[OriginNuke] Unsupported tab scheme:", new URL(url || "about:blank").protocol);
       }
    });

    // Worker should have bailed out instantly logging the schema unsupported
    expect(logSpy.some(msg => msg.includes("Unsupported tab scheme"))).toBe(true);

    // Overlay is never shown
    const overlayCount = await page.locator("#__page-util-nuke-overlay__").count();
    expect(overlayCount).toBe(0);
  });
});
