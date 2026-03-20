import { Page, Locator } from "@playwright/test";

export class OverlayPOM {
  readonly host: Locator;

  constructor(private page: Page) {
    this.host = page.locator("#__page-util-nuke-overlay__");
  }

  async isVisible(): Promise<boolean> {
    return this.host.isVisible();
  }

  async waitForOverlay(timeout = 3000) {
    await this.host.waitFor({ state: "visible", timeout });
  }

  async clickSmart()  { await this.host.locator("#btn-smart").click(); }
  async clickFull()   { await this.host.locator("#btn-full").click(); }
  async clickAction() { await this.host.locator("#action-btn").click(); }
  async clickClose()  { await this.host.locator("#close-btn").click(); }
  async clickUnregister() { await this.host.locator("#unregister-btn").click(); }

  async getActionBtnText()  { return this.host.locator("#action-btn").textContent().then(t => t?.trim() ?? ""); }
  async getStatusText()     { return this.host.locator("#status").textContent().then(t => t?.trim() ?? ""); }
  async getDataTypesText()  { return this.host.locator("#data-types").textContent().then(t => t?.trim() ?? ""); }
  async getOriginText()     { return this.host.locator("#origin-text").textContent().then(t => t?.trim() ?? ""); }
  async getWarningText()    { return this.host.locator("#warning").textContent().then(t => t?.trim() ?? ""); }
  async getSwAlertText()    { return this.host.locator("#sw-alert").textContent().then(t => t?.trim() ?? ""); }
}
