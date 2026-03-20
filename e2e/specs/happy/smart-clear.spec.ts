import { test, expect, unlockShadowDom, getBackgroundWorker } from "../../fixtures/extension";
import { startTestServer } from "../../fixtures/test-page";
import { OverlayPOM } from "../../helpers/overlay";
import { seedAllStorage, assertStorageEmpty, registerServiceWorker, setCookie, getCookie } from "../../helpers/storage-seed";

test.describe("Smart Clear", () => {
  let server: { url: string; close: () => void };

  test.beforeEach(async ({ page }) => {
    server = await startTestServer();
    await unlockShadowDom(page);
    await page.goto(server.url);
    await seedAllStorage(page);
    await registerServiceWorker(page);
    await setCookie(page, server.url, "test-cookie", "should-survive");
  });

  test.afterEach(async ({ page }) => {
    server.close();
    // Ensure overlay is naturally cleaned up (no memory leaks)
    const overlayCount = await page.locator("#__page-util-nuke-overlay__").count();
    expect(overlayCount).toBe(0);
  });

  test("successfully performs a smart clear of storage but preserves cookies", async ({ page, context }) => {
    const overlay = new OverlayPOM(page);

    const worker = await getBackgroundWorker(context);
    
    // Simulate action click from background context
    const tabUrl = server.url;
    await worker.evaluate(async (url) => {
       const tabs = await chrome.tabs.query({ url: url + "/*" });
       if (tabs[0]?.id) {
          await chrome.scripting.executeScript({
             target: { tabId: tabs[0].id },
             files: ["src/content/index.js"]
          });
       }
    }, tabUrl);

    await overlay.waitForOverlay();
    
    // Verify origin text
    const originText = await overlay.getOriginText();
    expect(originText).toBe(new URL(server.url).origin);

    // Verify default state
    expect(await overlay.getActionBtnText()).toBe("Clear Origin Data");

    // Click action
    await overlay.clickAction();
    await expect.poll(() => overlay.getActionBtnText()).toBe("Confirm — click again to execute");

    // Click to confirm
    await overlay.clickAction();
    await expect.poll(() => overlay.getStatusText()).toContain("Done");

    // Await tab reload inherently caused by nuke
    await page.waitForNavigation();

    // Verify storage was nuked
    const isEmpty = await assertStorageEmpty(page);
    expect(isEmpty).toBe(true);

    // Verify cookies survived
    const cookie = await getCookie(page, server.url, "test-cookie");
    expect(cookie?.value).toBe("should-survive");
  });
});
