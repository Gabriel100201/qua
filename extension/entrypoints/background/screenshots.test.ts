import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

vi.mock("wxt/browser", () => ({ browser: fakeBrowser }));

const { ScreenshotRing, SCREENSHOT_RING_SIZE } = await import("./screenshots.js");

describe("ScreenshotRing", () => {
  let now: number;
  let activeTab: number | undefined;
  let captureCount: number;

  beforeEach(() => {
    vi.useFakeTimers();
    fakeBrowser.reset();
    now = 0;
    activeTab = 1;
    captureCount = 0;
    (fakeBrowser.tabs as unknown as { captureVisibleTab: () => Promise<string> }).captureVisibleTab =
      vi.fn(async () => {
        captureCount += 1;
        return `data:image/jpeg;base64,frame-${captureCount}`;
      });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makeRing() {
    return new ScreenshotRing(
      () => now,
      async () => activeTab,
      async (dataUrl) => dataUrl.replace("data:image/jpeg;base64,", "encoded:"),
    );
  }

  it("captura a 1 fps mientras está iniciado", async () => {
    const ring = makeRing();
    ring.start();

    for (let i = 0; i < 5; i++) {
      now += 1000;
      await vi.advanceTimersByTimeAsync(1000);
    }

    expect(captureCount).toBe(5);
    expect(ring.size()).toBe(5);
    ring.stop();
  });

  it("mantiene como mucho los últimos 40 frames", async () => {
    const ring = makeRing();
    ring.start();

    for (let i = 0; i < SCREENSHOT_RING_SIZE + 10; i++) {
      now += 1000;
      await vi.advanceTimersByTimeAsync(1000);
    }

    expect(ring.size()).toBe(SCREENSHOT_RING_SIZE);
    ring.stop();
  });

  it("closestTo devuelve el frame más cercano a t_target para esa pestaña", async () => {
    const ring = makeRing();
    ring.start();

    for (let i = 0; i < 5; i++) {
      now += 1000; // t = 1000, 2000, 3000, 4000, 5000
      await vi.advanceTimersByTimeAsync(1000);
    }

    const frame = ring.closestTo(1, 3400);
    expect(frame?.t).toBe(3000);
    ring.stop();
  });

  it("closestTo filtra por pestaña", async () => {
    const ring = makeRing();
    ring.start();
    now = 1000;
    await vi.advanceTimersByTimeAsync(1000);
    activeTab = 2;
    now = 2000;
    await vi.advanceTimersByTimeAsync(1000);

    expect(ring.closestTo(1, 2000)?.t).toBe(1000);
    expect(ring.closestTo(2, 2000)?.t).toBe(2000);
    expect(ring.closestTo(99, 2000)).toBeUndefined();
    ring.stop();
  });

  it("stop() vacía el ring en memoria", async () => {
    const ring = makeRing();
    ring.start();
    now = 1000;
    await vi.advanceTimersByTimeAsync(1000);
    expect(ring.size()).toBe(1);
    ring.stop();
    expect(ring.size()).toBe(0);
  });
});
