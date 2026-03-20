import { test, expect, unlockShadowDom, getBackgroundWorker } from "../../fixtures/extension";
import { startTestServer } from "../../fixtures/test-page";
import { OverlayPOM } from "../../helpers/overlay";

test.describe("In Flight Guard", () => {
  let server: { url: string; close: () => void };

  test.beforeEach(async ({ page }) => {
    server = await startTestServer();
    await unlockShadowDom(page);
    await page.goto(server.url);
  });

  test.afterEach(() => {
    server.close();
  });

  test("prevents overlapping nuke attempts and handles API rejection gracefully", async ({ page, context }) => {
    const overlay = new OverlayPOM(page);

    const worker = await getBackgroundWorker(context);
    
    await worker.evaluate(async (url) => {
       const tabs = await chrome.tabs.query({ url: url + "/*" });
       await chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          files: ["src/content/index.js"]
       });
    }, server.url);

    await overlay.waitForOverlay();
    
    // Open the Chrome API channel via the worker to mock the hang state
    await worker.evaluate(() => {
       // @ts-ignore Mucking with closure scope or API proxying in worker
       const _originalRemove = chrome.browsingData.remove;
       chrome.browsingData.remove = () => new Promise(r => setTimeout(r, 5000));
    });

    // First click pair arms and fires
    await overlay.clickAction();
    await overlay.clickAction();

    // Verify it is firing
    expect(await overlay.getActionBtnText()).toBe("Clearing…");

    // Second programmatic request sent from isolated world to background
    const errorResponse = await worker.evaluate(async (url) => {
       const tabs = await chrome.tabs.query({ url: url + "/*" });
       const results = await chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          func: async () => {
             return new Promise(resolve => {
                chrome.runtime.sendMessage({
                  action: "nuke",
                  origin: location.origin,
                  preset: "smart"
                }, resolve);
             });
          }
       });
       return results[0].result as any;
    }, server.url);

    expect(errorResponse.success).toBe(false);
    expect(errorResponse.code).toBe("IN_FLIGHT");
  });
});
