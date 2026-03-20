import { test as base, chromium, BrowserContext } from "@playwright/test";
import path from "path";

export const test = base.extend<{
  context: BrowserContext;
  extensionId: string;
}>({
  // Override context to launch Chromium with the extension loaded
  context: async ({}, use) => {
    const pathToExtension = path.resolve(__dirname, "../../"); // root of extension
    const context = await chromium.launchPersistentContext("", {
      headless: false,           // extensions require headed mode
      args: [
        `--disable-extensions-except=${pathToExtension}`,
        `--load-extension=${pathToExtension}`,
        "--no-sandbox",
      ],
    });
    await use(context);
    await context.close();
  },

  extensionId: async ({ context }, use) => {
    // Expose extension ID
    let [background] = context.serviceWorkers();
    if (!background) background = await context.waitForEvent("serviceworker");
    const extensionId = new URL(background.url()).hostname;
    await use(extensionId);
  },
});

export async function getBackgroundWorker(context: BrowserContext) {
  let worker = context.serviceWorkers().find(sw => sw.url().startsWith("chrome-extension://"));
  if (!worker) worker = await context.waitForEvent("serviceworker", { predicate: sw => sw.url().startsWith("chrome-extension://") });
  return worker;
}

export async function unlockShadowDom(page: any) {
  await page.addInitScript(() => {
    const originalAttachShadow = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function(init) {
      return originalAttachShadow.call(this, { ...init, mode: 'open' });
    };
  });
}

export { expect } from "@playwright/test";
