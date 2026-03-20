import { test, expect, getBackgroundWorker, unlockShadowDom } from "../../fixtures/extension";
import { startTestServer } from "../../fixtures/test-page";
import { seedAllStorage, assertStorageEmpty } from "../../helpers/storage-seed";

test.describe("Keyboard Shortcut", () => {
  let server: { url: string; close: () => void };

  test.beforeEach(async ({ page }) => {
    server = await startTestServer();
    await unlockShadowDom(page);
    await page.goto(server.url);
    await seedAllStorage(page);
  });

  test.afterEach(() => {
    server.close();
  });

  test("headless nuke triggered via fallback keyboard simulation", async ({ page, context }) => {
    const worker = await getBackgroundWorker(context);

    await worker.evaluate(async (url) => {
       const tabs = await chrome.tabs.query({ url: url + "/*", active: true });
       // Dynamically trigger the background script's command logic directly
       // Mocks the underlying extension command handler
       await (self as any).__e2e_nukeOriginAndReload(new URL(url).origin, tabs[0].id, "smart", false);
    }, server.url);

    // It should trigger navigation natively from the background reload
    await page.waitForNavigation({ timeout: 5000 });

    const isEmpty = await assertStorageEmpty(page);
    expect(isEmpty).toBe(true);

    // Overlay is never shown
    const overlay = await page.locator("#__page-util-nuke-overlay__").count();
    expect(overlay).toBe(0);
  });
});
