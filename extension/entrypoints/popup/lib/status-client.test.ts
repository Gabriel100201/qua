import { describe, expect, it, vi } from "vitest";
import { IDLE_STATUS, StatusClient } from "./status-client.js";
import type { PopupStatus } from "./messages.js";

function fakeRuntime(sendMessageImpl?: (msg: unknown) => unknown) {
  const listeners: Array<(msg: unknown) => void> = [];
  const runtime = {
    sendMessage: vi.fn((msg: unknown) => {
      const result = sendMessageImpl?.(msg);
      return Promise.resolve(result);
    }),
    onMessage: {
      addListener: vi.fn((l: (msg: unknown) => void) => listeners.push(l)),
      removeListener: vi.fn((l: (msg: unknown) => void) => {
        const i = listeners.indexOf(l);
        if (i >= 0) listeners.splice(i, 1);
      }),
    },
  };
  return { runtime: runtime as unknown as typeof chrome.runtime, listeners, sendMessage: runtime.sendMessage };
}

describe("StatusClient.getStatus", () => {
  it("devuelve la respuesta del service worker, completando defaults faltantes", async () => {
    const status: PopupStatus = { state: "recording", startedAtWall: 1000, eventsCount: 12 };
    const { runtime, sendMessage } = fakeRuntime(() => status);
    const client = new StatusClient(runtime);

    expect(await client.getStatus()).toEqual(status);
    expect(sendMessage).toHaveBeenCalledWith({ type: "qua:get-status" });
  });

  it("devuelve IDLE_STATUS si el service worker no responde", async () => {
    const { runtime } = fakeRuntime(() => undefined);
    const client = new StatusClient(runtime);
    expect(await client.getStatus()).toEqual(IDLE_STATUS);
  });

  it("devuelve IDLE_STATUS si sendMessage tira (contexto invalidado)", async () => {
    const runtime = {
      sendMessage: vi.fn(() => {
        throw new Error("Extension context invalidated");
      }),
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    } as unknown as typeof chrome.runtime;
    const client = new StatusClient(runtime);
    expect(await client.getStatus()).toEqual(IDLE_STATUS);
  });

  it("sin runtime disponible, devuelve IDLE_STATUS", async () => {
    const client = new StatusClient(undefined);
    expect(await client.getStatus()).toEqual(IDLE_STATUS);
  });
});

describe("StatusClient — comandos", () => {
  it("start/stop/mark mandan el mensaje correcto", () => {
    const { runtime, sendMessage } = fakeRuntime();
    const client = new StatusClient(runtime);
    client.start();
    client.stop();
    client.mark();
    expect(sendMessage).toHaveBeenNthCalledWith(1, { type: "qua:start-session" });
    expect(sendMessage).toHaveBeenNthCalledWith(2, { type: "qua:stop-session" });
    expect(sendMessage).toHaveBeenNthCalledWith(3, { type: "qua:trigger-mark" });
  });
});

describe("StatusClient — pushes en vivo", () => {
  it("onStatus solo dispara para mensajes qua:status", () => {
    const { runtime, listeners } = fakeRuntime();
    const client = new StatusClient(runtime);
    const cb = vi.fn();
    client.onStatus(cb);

    const status: PopupStatus = { state: "recording", startedAtWall: 5, eventsCount: 1 };
    listeners[0]!({ type: "qua:status", status });
    listeners[0]!({ type: "qua:transcript-partial", utterance: { text: "hola" } });

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(status);
  });

  it("onTranscript solo dispara para mensajes qua:transcript-partial", () => {
    const { runtime, listeners } = fakeRuntime();
    const client = new StatusClient(runtime);
    const cb = vi.fn();
    client.onTranscript(cb);

    listeners[0]!({ type: "qua:status", status: IDLE_STATUS });
    const utterance = { text: "che mirá esto" };
    listeners[0]!({ type: "qua:transcript-partial", utterance });

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(utterance);
  });

  it("unsubscribe saca el listener", () => {
    const { runtime, listeners } = fakeRuntime();
    const client = new StatusClient(runtime);
    const unsub = client.onStatus(vi.fn());
    expect(listeners).toHaveLength(1);
    unsub();
    expect(listeners).toHaveLength(0);
  });
});
