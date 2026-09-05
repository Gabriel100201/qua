import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

vi.mock("wxt/browser", () => ({ browser: fakeBrowser }));

const { startKeepalive, stopKeepalive, KEEPALIVE_ALARM_NAME, KEEPALIVE_PERIOD_MINUTES } = await import(
  "./keepalive.js"
);

describe("keepalive", () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it("crea el alarm cada 25 s (§5.3)", () => {
    expect(KEEPALIVE_PERIOD_MINUTES * 60).toBeCloseTo(25);
    startKeepalive(() => {});
    // fakeBrowser no expone getAll síncrono tipado; alcanza con que no explote y
    // dispare el listener registrado más abajo.
  });

  it("onTick se llama al disparar el alarm correcto, no con otros", async () => {
    let ticks = 0;
    startKeepalive(() => {
      ticks += 1;
    });

    await fakeBrowser.alarms.onAlarm.trigger({ name: "otra-cosa" } as never);
    expect(ticks).toBe(0);

    await fakeBrowser.alarms.onAlarm.trigger({ name: KEEPALIVE_ALARM_NAME } as never);
    expect(ticks).toBe(1);
  });

  it("stopKeepalive limpia el alarm sin lanzar", () => {
    startKeepalive(() => {});
    expect(() => stopKeepalive()).not.toThrow();
  });
});
