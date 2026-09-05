import { browser } from "wxt/browser";
import type { Event } from "@qua/protocol";

/**
 * Ciclo de pestañas (§5.3): onActivated, onUpdated, onRemoved,
 * webNavigation.onHistoryStateUpdated.
 *
 * `chrome.tabs.onActivated` no manda la pestaña anterior (solo `{tabId, windowId}`),
 * así que el `from` de `tab_switch` se arma con el último activo que vimos acá mismo.
 */
export class TabTracker {
  private urlByTab = new Map<number, string>();
  private activeTabId: number | undefined;
  private started = false;

  constructor(
    private readonly emit: (event: Event) => void,
    private readonly now: () => number,
  ) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    browser.tabs.onActivated.addListener(this.handleActivated);
    browser.tabs.onUpdated.addListener(this.handleUpdated);
    browser.tabs.onRemoved.addListener(this.handleRemoved);
    browser.webNavigation.onHistoryStateUpdated.addListener(this.handleHistoryState);
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    browser.tabs.onActivated.removeListener(this.handleActivated);
    browser.tabs.onUpdated.removeListener(this.handleUpdated);
    browser.tabs.onRemoved.removeListener(this.handleRemoved);
    browser.webNavigation.onHistoryStateUpdated.removeListener(this.handleHistoryState);
  }

  urlOf(tabId: number): string | undefined {
    return this.urlByTab.get(tabId);
  }

  private handleActivated = (activeInfo: { tabId: number; windowId: number }): void => {
    const from = this.activeTabId ?? null;
    this.activeTabId = activeInfo.tabId;
    this.emit({
      t: this.now(),
      k: "tab_switch",
      from,
      to: activeInfo.tabId,
      url: this.urlByTab.get(activeInfo.tabId) ?? "",
    });
  };

  private handleUpdated = (
    tabId: number,
    changeInfo: { url?: string },
    _tab: unknown,
  ): void => {
    if (changeInfo.url) {
      this.urlByTab.set(tabId, changeInfo.url);
    }
  };

  private handleRemoved = (tabId: number): void => {
    this.urlByTab.delete(tabId);
    if (this.activeTabId === tabId) this.activeTabId = undefined;
    this.emit({ t: this.now(), k: "tab_close", tab: tabId });
  };

  private handleHistoryState = (details: { tabId: number; url: string; frameId: number }): void => {
    if (details.frameId !== 0) return; // solo el frame principal
    this.urlByTab.set(details.tabId, details.url);
  };
}
