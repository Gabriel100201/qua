import { describe, expect, it, vi } from "vitest";
import { installPingResponder, isPingMessage } from "./ping.js";

function fakeRuntime() {
  const listeners: Array<(message: unknown, sender: unknown, sendResponse: (r: unknown) => void) => unknown> = [];
  const runtime = {
    onMessage: {
      addListener: (fn: (typeof listeners)[number]) => listeners.push(fn),
      removeListener: (fn: (typeof listeners)[number]) => {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      },
    },
  };
  return { runtime: runtime as unknown as typeof chrome.runtime, listeners };
}

describe("isPingMessage", () => {
  it("reconoce {type: 'qua:ping'} y nada más", () => {
    expect(isPingMessage({ type: "qua:ping" })).toBe(true);
    expect(isPingMessage({ type: "qua:mark" })).toBe(false);
    expect(isPingMessage(undefined)).toBe(false);
    expect(isPingMessage("qua:ping")).toBe(false);
  });
});

describe("installPingResponder", () => {
  it("responde qua:pong a un qua:ping — así el popup detecta que el content script está inyectado", () => {
    const { runtime, listeners } = fakeRuntime();
    (globalThis as unknown as { chrome: unknown }).chrome = { runtime };

    installPingResponder();
    expect(listeners).toHaveLength(1);

    const sendResponse = vi.fn();
    listeners[0]!({ type: "qua:ping" }, {}, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({ type: "qua:pong" });

    delete (globalThis as { chrome?: unknown }).chrome;
  });

  it("ignora cualquier otro mensaje sin llamar a sendResponse", () => {
    const { runtime, listeners } = fakeRuntime();
    (globalThis as unknown as { chrome: unknown }).chrome = { runtime };

    installPingResponder();
    const sendResponse = vi.fn();
    listeners[0]!({ type: "qua:mark", source: "hotkey" }, {}, sendResponse);
    expect(sendResponse).not.toHaveBeenCalled();

    delete (globalThis as { chrome?: unknown }).chrome;
  });

  it("el teardown saca el listener", () => {
    const { runtime, listeners } = fakeRuntime();
    (globalThis as unknown as { chrome: unknown }).chrome = { runtime };

    const teardown = installPingResponder();
    expect(listeners).toHaveLength(1);
    teardown();
    expect(listeners).toHaveLength(0);

    delete (globalThis as { chrome?: unknown }).chrome;
  });

  it("no-op fuera de una extensión (sin chrome.runtime)", () => {
    delete (globalThis as { chrome?: unknown }).chrome;
    expect(() => installPingResponder()()).not.toThrow();
  });
});
