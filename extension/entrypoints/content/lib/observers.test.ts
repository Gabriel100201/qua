import { afterEach, describe, expect, it, vi } from "vitest";
import type { Event } from "@qua/protocol";
import { installObservers } from "./observers.js";

function collect() {
  const events: Event[] = [];
  return { emit: (e: Event) => events.push(e), events };
}

class FakePerformanceObserver {
  static byType = new Map<string, (list: { getEntries: () => unknown[] }) => void>();
  constructor(private cb: (list: { getEntries: () => unknown[] }) => void) {}
  observe(options: { type: string }) {
    FakePerformanceObserver.byType.set(options.type, this.cb);
  }
  disconnect() {}
}

describe("installObservers", () => {
  let teardown: (() => void) | undefined;

  afterEach(() => {
    teardown?.();
    teardown = undefined;
    document.body.innerHTML = "";
    FakePerformanceObserver.byType.clear();
    vi.restoreAllMocks();
  });

  it("sin PerformanceObserver disponible, no tira nada (jsdom real)", () => {
    expect(() => {
      teardown = installObservers({ window, document }, () => {});
    }).not.toThrow();
  });

  it("long_task solo para entries > 200 ms", () => {
    const { emit, events } = collect();
    teardown = installObservers(
      { window, document },
      emit,
      { PerformanceObserverCtor: FakePerformanceObserver as unknown as typeof PerformanceObserver },
    );

    const cb = FakePerformanceObserver.byType.get("longtask")!;
    cb({ getEntries: () => [{ duration: 150 }, { duration: 250 }] });

    expect(events).toEqual([expect.objectContaining({ k: "long_task", duration_ms: 250 })]);
  });

  it("layout_shift ignora hadRecentInput y el umbral de 0.05", () => {
    const { emit, events } = collect();
    teardown = installObservers(
      { window, document },
      emit,
      { PerformanceObserverCtor: FakePerformanceObserver as unknown as typeof PerformanceObserver },
    );

    const cb = FakePerformanceObserver.byType.get("layout-shift")!;
    cb({
      getEntries: () => [
        { value: 0.9, hadRecentInput: true },
        { value: 0.02, hadRecentInput: false },
        { value: 0.3, hadRecentInput: false },
      ],
    });

    expect(events).toEqual([expect.objectContaining({ k: "layout_shift", value: 0.3 })]);
  });

  it("mutation_burst dispara con > 20 mutaciones y no dos veces en la misma ventana", async () => {
    document.body.innerHTML = `<div id="root"></div>`;
    const { emit, events } = collect();
    teardown = installObservers(
      { window, document },
      emit,
      { mutationThreshold: 20, mutationWindowMs: 100 },
    );

    const root = document.getElementById("root")!;
    for (let i = 0; i < 25; i++) root.appendChild(document.createElement("div"));
    await Promise.resolve();
    await Promise.resolve();

    expect(events).toEqual([expect.objectContaining({ k: "mutation_burst", count: 25 })]);
  });

  it("<= 20 mutaciones no dispara mutation_burst", async () => {
    document.body.innerHTML = `<div id="root"></div>`;
    const { emit, events } = collect();
    teardown = installObservers({ window, document }, emit, { mutationThreshold: 20 });

    const root = document.getElementById("root")!;
    for (let i = 0; i < 10; i++) root.appendChild(document.createElement("div"));
    await Promise.resolve();
    await Promise.resolve();

    expect(events).toHaveLength(0);
  });
});
