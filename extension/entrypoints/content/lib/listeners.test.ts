import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Event } from "@qua/protocol";
import { installListeners } from "./listeners.js";

function collect() {
  const events: Event[] = [];
  return { emit: (e: Event) => events.push(e), events };
}

describe("installListeners", () => {
  let teardown: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    teardown?.();
    teardown = undefined;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("click sube al ancestro interactivo más cercano, no al <span> interno", () => {
    document.body.innerHTML = `<button id="btn"><span id="icon">×</span></button>`;
    const { emit, events } = collect();
    teardown = installListeners({ window, document }, emit);

    document.getElementById("icon")!.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));

    expect(events).toHaveLength(1);
    expect(events[0]?.k === "click" ? events[0].target.sel : null).toBe("#btn");
  });

  it("input debounce: varios eventos seguidos emiten uno solo, 800 ms después del último", () => {
    document.body.innerHTML = `<input id="i" name="nombre" type="text" />`;
    const { emit, events } = collect();
    teardown = installListeners({ window, document }, emit);
    const input = document.getElementById("i")!;

    input.dispatchEvent(new Event("input", { bubbles: true }));
    vi.advanceTimersByTime(400);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    vi.advanceTimersByTime(400);
    expect(events).toHaveLength(0); // todavía no pasaron 800 ms del último
    vi.advanceTimersByTime(400);
    expect(events).toHaveLength(1);
    expect(events[0]?.k).toBe("input");
  });

  it("un campo sensible nunca emite input, ni siquiera tras el debounce", () => {
    document.body.innerHTML = `<input id="pw" name="password" type="password" />`;
    const { emit, events } = collect();
    teardown = installListeners({ window, document }, emit);

    document.getElementById("pw")!.dispatchEvent(new Event("input", { bubbles: true }));
    vi.advanceTimersByTime(2000);

    expect(events).toHaveLength(0);
  });

  it("hover: dwell < 400 ms no emite nada", () => {
    document.body.innerHTML = `<button id="b">x</button>`;
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const { emit, events } = collect();
    teardown = installListeners({ window, document }, emit);

    const btn = document.getElementById("b")!;
    btn.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    now += 200;
    btn.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));

    expect(events).toHaveLength(0);
  });

  it("hover: dwell >= 400 ms emite hover con el dwell_ms redondeado", () => {
    document.body.innerHTML = `<button id="b">x</button>`;
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const { emit, events } = collect();
    teardown = installListeners({ window, document }, emit);

    const btn = document.getElementById("b")!;
    btn.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    now += 550;
    btn.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));

    expect(events).toEqual([expect.objectContaining({ k: "hover", dwell_ms: 550 })]);
  });

  it("hover: moverse entre hijos del mismo ancestro interactivo no reinicia el dwell", () => {
    document.body.innerHTML = `<button id="b"><span id="a">a</span><span id="c">c</span></button>`;
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const { emit, events } = collect();
    teardown = installListeners({ window, document }, emit);

    const a = document.getElementById("a")!;
    const c = document.getElementById("c")!;
    const btn = document.getElementById("b")!;

    a.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    now += 200;
    a.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: c }));
    c.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    now += 300; // total 500 ms sobre el mismo <button>
    c.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));

    expect(events).toEqual([expect.objectContaining({ k: "hover", dwell_ms: 500 })]);
    expect(events[0]?.k === "hover" ? events[0].target.sel : null).toBe("#b");
    void btn;
  });
});
