import { test, expect, unlockShadowDom, getBackgroundWorker } from "../../fixtures/extension";
import { startTestServer } from "../../fixtures/test-page";
import { OverlayPOM } from "../../helpers/overlay";

test.describe("CSP Blocked Navigation", () => {
  let server: { url: string; close: () => void };

  test.beforeEach(async ({ page }) => {
    server = await startTestServer();
    await unlockShadowDom(page);
  });

  test.afterEach(() => {
    server.close();
  });

  test("overlay successfully injects unharmed on strict CSP pages in modern Chromium", async ({ page, context }) => {
    // Navigate to strict CSP page endpoint
    await page.goto(server.url + "/csp-strict");

    const worker = await getBackgroundWorker(context);
    const overlay = new OverlayPOM(page);

    await worker.evaluate(async (url) => {
       const tabs = await chrome.tabs.query({ url: url + "/*" });
       await chrome.scripting.executeScript({
          world: "ISOLATED",
          target: { tabId: tabs[0].id },
          files: ["src/content/index.js"]
       });
    }, server.url);

    // It should open the overlay natively, bypassing the page CSP
    await overlay.waitForOverlay();
    
    expect(await overlay.isVisible()).toBe(true);
  });
});
