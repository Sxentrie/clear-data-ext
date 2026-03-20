import { test, expect, unlockShadowDom, getBackgroundWorker } from "../../fixtures/extension";
import { startTestServer } from "../../fixtures/test-page";
import { OverlayPOM } from "../../helpers/overlay";
import { seedAllStorage, assertStorageEmpty } from "../../helpers/storage-seed";

test.describe("Multi-Tab Same Origin", () => {
  let server: { url: string; close: () => void };

  test.beforeEach(async ({ page }) => {
    server = await startTestServer();
    await unlockShadowDom(page);
  });

  test.afterEach(() => {
    server.close();
  });

  test("nukes 3 tabs cleanly without duplicate reloads", async ({ context }) => {
    // Open 3 tabs
    const page1 = await context.newPage();
    const page2 = await context.newPage();
    const page3 = await context.newPage();

    await unlockShadowDom(page1);
    await unlockShadowDom(page2);
    await unlockShadowDom(page3);

    await page1.goto(server.url);
    await page2.goto(server.url);
    await page3.goto(server.url);

    await seedAllStorage(page1);
    await seedAllStorage(page2);
    await seedAllStorage(page3);

    const overlay = new OverlayPOM(page1);
    await page1.bringToFront();

    const worker = await getBackgroundWorker(context);

    // Trigger overlay safely via background
    await worker.evaluate(async (url) => {
       const tabs = await chrome.tabs.query({ url: url + "/*", active: true });
       await chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          files: ["src/content/index.js"]
       });
    }, server.url);

    await overlay.waitForOverlay();
    
    // Attach navigation listeners to 2 and 3
    let page2Reloaded = false;
    let page3Reloaded = false;
    page2.on('framenavigated', () => { page2Reloaded = true; });
    page3.on('framenavigated', () => { page3Reloaded = true; });

    // Fire nuke and wait for navigation concurrently to avoid race condition
    await overlay.clickAction();
    await Promise.all([
      page1.waitForNavigation({ timeout: 10000 }),
      overlay.clickAction()
    ]);

    // Verify all tabs had storage cleared via Hunter-Killer background task
    expect(await assertStorageEmpty(page1)).toBe(true);
    expect(await assertStorageEmpty(page2)).toBe(true);
    expect(await assertStorageEmpty(page3)).toBe(true);

    // Assert that active tab reloaded, but background tabs did not visually reload
    // By architecture: nukeOriginAndReload triggers `chrome.tabs.reload(tabId)` ONLY if headless,
    // or the UI handles it via `location.reload()` in the specific tab where the UI sits.
    expect(page2Reloaded).toBe(false);
    expect(page3Reloaded).toBe(false);
  });
});
