import { test, expect, unlockShadowDom, getBackgroundWorker } from "../../fixtures/extension";
import { startTestServer } from "../../fixtures/test-page";
import { OverlayPOM } from "../../helpers/overlay";
import { seedAllStorage, assertStorageEmpty, setCookie, getCookie } from "../../helpers/storage-seed";

test.describe("Full Nuke", () => {
  let server: { url: string; close: () => void };

  test.beforeEach(async ({ page }) => {
    server = await startTestServer();
    await unlockShadowDom(page);
    await page.goto(server.url);
    await seedAllStorage(page);
    await setCookie(page, server.url, "test-cookie", "should-die");
  });

  test.afterEach(async () => {
    server.close();
  });

  test("successfully performs a full nuke including cookies", async ({ page, context }) => {
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
    
    // Switch to Full Nuke
    await overlay.clickFull();
    
    // Warning banner should appear
    const warningText = await overlay.getWarningText();
    expect(warningText).toContain("Cookies will be cleared");

    // Click twice to execute
    await overlay.clickAction();
    await overlay.clickAction();

    await page.waitForNavigation();

    // Verify storage was nuked
    const isEmpty = await assertStorageEmpty(page);
    expect(isEmpty).toBe(true);

    // Verify cookies died
    const cookie = await getCookie(page, server.url, "test-cookie");
    expect(cookie).toBeUndefined();
  });
});
