import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import type { Event } from "@qua/protocol";

vi.mock("wxt/browser", () => ({ browser: fakeBrowser }));

const { TabTracker } = await import("./tabs.js");

describe("TabTracker", () => {
  let events: Event[];
  let now: number;

  beforeEach(() => {
    fakeBrowser.reset();
    events = [];
    now = 0;
  });

  function makeTracker() {
    return new TabTracker((e) => events.push(e), () => now);
  }

  it("emite tab_switch con from=null en la primera activación", async () => {
    const tracker = makeTracker();
    tracker.start();

    now = 100;
    await fakeBrowser.tabs.onActivated.trigger({ tabId: 1, windowId: 1 });

    expect(events).toEqual([{ t: 100, k: "tab_switch", from: null, to: 1, url: "" }]);
  });

  it("arma `from` con la última pestaña activa vista, no con la API (que no la manda)", async () => {
    const tracker = makeTracker();
    tracker.start();

    now = 100;
    await fakeBrowser.tabs.onActivated.trigger({ tabId: 1, windowId: 1 });
    now = 200;
    await fakeBrowser.tabs.onActivated.trigger({ tabId: 2, windowId: 1 });

    expect(events[1]).toEqual({ t: 200, k: "tab_switch", from: 1, to: 2, url: "" });
  });

  it("usa la URL rastreada por onUpdated al armar tab_switch", async () => {
    const tracker = makeTracker();
    tracker.start();

    await fakeBrowser.tabs.onUpdated.trigger(
      2,
      { url: "https://agendi.app/turnos" },
      { id: 2 } as never,
    );
    now = 50;
    await fakeBrowser.tabs.onActivated.trigger({ tabId: 2, windowId: 1 });

    expect(events).toEqual([
      { t: 50, k: "tab_switch", from: null, to: 2, url: "https://agendi.app/turnos" },
    ]);
  });

  it("una navegación SPA (onHistoryStateUpdated) actualiza la URL rastreada", async () => {
    const tracker = makeTracker();
    tracker.start();

    await fakeBrowser.webNavigation.onHistoryStateUpdated.trigger({
      tabId: 3,
      url: "https://agendi.app/pacientes",
      frameId: 0,
      timeStamp: 0,
    } as never);
    now = 10;
    await fakeBrowser.tabs.onActivated.trigger({ tabId: 3, windowId: 1 });

    expect(events[0]).toMatchObject({ url: "https://agendi.app/pacientes" });
  });

  it("emite tab_close en onRemoved", async () => {
    const tracker = makeTracker();
    tracker.start();

    now = 300;
    await fakeBrowser.tabs.onRemoved.trigger(7, { windowId: 1, isWindowClosing: false });

    expect(events).toEqual([{ t: 300, k: "tab_close", tab: 7 }]);
  });

  it("stop() deja de escuchar", async () => {
    const tracker = makeTracker();
    tracker.start();
    tracker.stop();

    await fakeBrowser.tabs.onActivated.trigger({ tabId: 1, windowId: 1 });
    await fakeBrowser.tabs.onRemoved.trigger(1, { windowId: 1, isWindowClosing: false });

    expect(events).toEqual([]);
  });
});
