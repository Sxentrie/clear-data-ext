import { test, expect, unlockShadowDom, getBackgroundWorker } from "../../fixtures/extension";
import { startTestServer } from "../../fixtures/test-page";

test.describe("Origin Mismatch Guard", () => {
  let server: { url: string; close: () => void };

  test.beforeEach(async ({ page }) => {
    server = await startTestServer();
    await unlockShadowDom(page);
    await page.goto(server.url);
  });

  test.afterEach(() => {
    server.close();
  });

  test("rejects malformed IPC requests asserting false origins", async ({ page, context }) => {
    const worker = await getBackgroundWorker(context);

    const response = await worker.evaluate(async (url) => {
       const tabs = await chrome.tabs.query({ url: url + "/*" });
       const results = await chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          func: async () => {
             return new Promise(resolve => {
                chrome.runtime.sendMessage({
                  action: "nuke",
                  origin: "https://evil.com",
                  preset: "smart"
                }, resolve);
             });
          }
       });
       return results[0].result as any;
    }, server.url);

    expect(response.success).toBe(false);
    expect(response.code).toBe("ORIGIN_MISMATCH");
    expect(response.error).toContain("mismatch");
  });
});
