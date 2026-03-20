import { test, expect, unlockShadowDom, getBackgroundWorker } from "../../fixtures/extension";
import { startTestServer } from "../../fixtures/test-page";

test.describe("CSP Blocked Navigation", () => {
  let server: { url: string; close: () => void };

  test.beforeEach(async ({ page }) => {
    server = await startTestServer();
    await unlockShadowDom(page);
  });

  test.afterEach(() => {
    server.close();
  });

  test("shows native confirm dialog when script injection is blocked", async ({ page, context }) => {
    // Navigate to strict CSP page endpoint
    await page.goto(server.url + "/csp-strict");

    const worker = await getBackgroundWorker(context);

    // Listen for the native dialog beforehand!
    const dialogPromise = page.waitForEvent("dialog");

    await worker.evaluate(async (url) => {
       const tabs = await chrome.tabs.query({ url: url + "/*" });
       await chrome.scripting.executeScript({
          world: "ISOLATED",
          target: { tabId: tabs[0].id },
          files: ["src/content/index.js"]
       });
    }, server.url);

    const dialog = await dialogPromise;
    expect(dialog.message()).toContain("Origin Nuke UI was blocked");
    
    // Cancel the confirm
    await dialog.dismiss();
    
    // Wait small amount to ensure no navigation occurs
    await page.waitForTimeout(500);
    expect(page.url()).toContain("/csp-strict");
  });
});
