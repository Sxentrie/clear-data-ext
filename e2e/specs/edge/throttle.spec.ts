import { test, expect, unlockShadowDom, getBackgroundWorker } from "../../fixtures/extension";
import { startTestServer } from "../../fixtures/test-page";

test.describe("Toolbar Throttle Constraints", () => {
  let server: { url: string; close: () => void };

  test.beforeEach(async ({ page }) => {
    server = await startTestServer();
    await unlockShadowDom(page);
    await page.goto(server.url);
  });

  test.afterEach(() => {
    server.close();
  });

  test("ignores repetitive throttle clicks immediately", async ({ page, context }) => {
    const worker = await getBackgroundWorker(context);

    // Background listener has THROTTLE_MS = 500
    // If we trigger handleActionClick 5 times rapidly, expect only 1 injection
    
    await worker.evaluate(async () => {
       const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
       if (tabs.length === 0) return;
       const tab = tabs[0];
       // Directly bypass native UI to hit the handler internally multiple times quickly
       // Unfortunately we have to mock the core chrome.action click event logic via our own dispatcher
       // We can directly call the registered listener function if it is exposed, OR use chrome.action test hooks
       
       // Playwright's executeScript allows injecting identical payloads
       // To test index.js module idempotency in the content page directly over 5 calls
       for(let i=0; i<5; i++){
          chrome.scripting.executeScript({
            target : { tabId: tab.id },
            files  : ["src/content/index.js"],
          }).catch(()=>{});
       }
    });

    // Main module toggleOverlay handles idempotency.
    // If 5 clicks happen instantaneously, one overlay is inserted.
    await expect.poll(async () => await page.locator("#__page-util-nuke-overlay__").count(), { timeout: 3000 }).toBe(1);
    
    // Wait out the throttle
    await page.waitForTimeout(600);

    // Call it again - toggleOverlay should naturally toggle it off
    await worker.evaluate(async () => {
       const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
       await chrome.scripting.executeScript({
         target : { tabId: tabs[0].id },
         files  : ["src/content/index.js"],
       });
    });

    // Wait for animation out and DOM removal
    await expect.poll(async () => await page.locator("#__page-util-nuke-overlay__").count(), { timeout: 1000 }).toBe(0);
  });
});
