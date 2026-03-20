import { test, expect, unlockShadowDom, getBackgroundWorker } from "../../fixtures/extension";
import { startTestServer } from "../../fixtures/test-page";
import { OverlayPOM } from "../../helpers/overlay";
import { registerServiceWorker } from "../../helpers/storage-seed";

test.describe("SW Re-registration Post-Nuke", () => {
  let server: { url: string; close: () => void };

  test.beforeEach(async ({ page }) => {
    server = await startTestServer();
    await unlockShadowDom(page);
    await page.goto(server.url);
  });

  test.afterEach(() => {
    server.close();
  });

  test("background detects aggressive SW re-registration and shows amber badge/alert", async ({ page, context }) => {
    // 1. Register persistent SW and ensure it survives reloads (simulating aggressive PWA)
    await page.addInitScript(() => {
      window.addEventListener('load', () => navigator.serviceWorker.register("/sw-persistent.js"));
    });
    // Wait for initial registration
    await registerServiceWorker(page, "/sw-persistent.js");

    const overlay = new OverlayPOM(page);

    const worker = await getBackgroundWorker(context);

    // 2. Trigger Smart Clear
    await worker.evaluate(async (url) => {
       const tabs = await chrome.tabs.query({ url: url + "/*" });
       await chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          files: ["src/content/index.js"]
       });
    }, server.url);

    await overlay.waitForOverlay();
    await overlay.clickAction(); // Arm
    await overlay.clickAction(); // Fire

    // Wait for reload
    await page.waitForNavigation();

    // The persistent SW will have re-registered instantly upon reload inside its own active listener
    // wait for the background extension's safety delay (1500ms + padding)
    await page.waitForTimeout(2500);

    // 3. Verify badge turned amber (SW↑)
    const badgeHasAmberText = await worker.evaluate(async (url) => {
       const tabs = await chrome.tabs.query({ url: url + "/*" });
       return new Promise(resolve => {
           chrome.action.getBadgeText({ tabId: tabs[0].id }, (text) => {
               resolve(text === "SW↑");
           });
       });
    }, server.url);
    
    expect(badgeHasAmberText).toBe(true);

    // 4. Open overlay again to check banner
    await worker.evaluate(async (url) => {
       const tabs = await chrome.tabs.query({ url: url + "/*" });
       await chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          files: ["src/content/index.js"]
       });
    }, server.url);

    await overlay.waitForOverlay();
    
    const swAlertText = await overlay.getSwAlertText();
    expect(swAlertText).toContain("SW re-registered");

    // Click Unregister
    await overlay.clickUnregister();
    
    await expect.poll(() => overlay.getSwAlertText(), { timeout: 3000 }).toContain("Unregistered");
  });
});
