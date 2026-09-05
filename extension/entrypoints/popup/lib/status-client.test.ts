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
  it("mapea la respuesta real del service worker (StatusResponse: phase/wsStatus/paired)", async () => {
    const { runtime, sendMessage } = fakeRuntime(() => ({ phase: "recording", wsStatus: "connected", paired: true }));
    const client = new StatusClient(runtime);

    expect(await client.getStatus()).toEqual({
      state: "recording",
      startedAtWall: null,
      eventsCount: 0,
      lastError: null,
      paired: true,
      wsStatus: "connected",
    });
    expect(sendMessage).toHaveBeenCalledWith({ type: "qua:get-status" });
  });

  it("devuelve IDLE_STATUS con lastError si el service worker no responde (undefined)", async () => {
    const { runtime } = fakeRuntime(() => undefined);
    const client = new StatusClient(runtime);
    const status = await client.getStatus();
    expect(status.state).toBe("idle");
    expect(status.lastError).toMatch(/\[qua\]/);
  });

  it("devuelve un mensaje de error si sendMessage tira (contexto invalidado) — antes se descartaba en silencio", async () => {
    const runtime = {
      sendMessage: vi.fn(() => {
        throw new Error("Extension context invalidated");
      }),
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    } as unknown as typeof chrome.runtime;
    const client = new StatusClient(runtime);
    const status = await client.getStatus();
    expect(status.state).toBe("idle");
    expect(status.lastError).toBe("[qua] el service worker no responde: Extension context invalidated");
  });

  it("sin runtime disponible, devuelve un error concreto (no silencioso)", async () => {
    const client = new StatusClient(undefined);
    const status = await client.getStatus();
    expect(status.lastError).toMatch(/chrome\.runtime no está disponible/);
  });
});

describe("StatusClient — comandos propagan errores (D-U2-01)", () => {
  it("start() manda el mensaje correcto y resuelve {ok:true} si el SW confirma", async () => {
    const { runtime, sendMessage } = fakeRuntime(() => ({ ok: true }));
    const client = new StatusClient(runtime);
    expect(await client.start()).toEqual({ ok: true });
    expect(sendMessage).toHaveBeenNthCalledWith(1, { type: "qua:start-session" });
  });

  it("stop()/mark() mandan el mensaje correcto", async () => {
    const { runtime, sendMessage } = fakeRuntime(() => ({ ok: true }));
    const client = new StatusClient(runtime);
    await client.stop();
    await client.mark();
    expect(sendMessage).toHaveBeenNthCalledWith(1, { type: "qua:stop-session" });
    expect(sendMessage).toHaveBeenNthCalledWith(2, { type: "qua:trigger-mark" });
  });

  it("start() propaga el error real cuando el SW responde {ok:false, error}", async () => {
    const { runtime } = fakeRuntime(() => ({ ok: false, error: "[qua] sin token: emparejá primero desde options." }));
    const client = new StatusClient(runtime);
    expect(await client.start()).toEqual({
      ok: false,
      error: "[qua] sin token: emparejá primero desde options.",
    });
  });

  it("start() propaga un error distinto para una causa distinta (daemon caído)", async () => {
    const { runtime } = fakeRuntime(() => ({
      ok: false,
      error: "[qua] el daemon no responde en 127.0.0.1:7331 — revisá que quad esté corriendo.",
    }));
    const client = new StatusClient(runtime);
    const result = await client.start();
    expect(result).toEqual({
      ok: false,
      error: "[qua] el daemon no responde en 127.0.0.1:7331 — revisá que quad esté corriendo.",
    });
  });

  it("start() propaga un error si sendMessage tira, en vez de devolver undefined en silencio", async () => {
    const runtime = {
      sendMessage: vi.fn(() => Promise.reject(new Error("Extension context invalidated"))),
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    } as unknown as typeof chrome.runtime;
    const client = new StatusClient(runtime);
    expect(await client.start()).toEqual({
      ok: false,
      error: "[qua] el service worker no responde: Extension context invalidated",
    });
  });
});

describe("StatusClient — pushes en vivo", () => {
  it("onStatus solo dispara para mensajes qua:status", () => {
    const { runtime, listeners } = fakeRuntime();
    const client = new StatusClient(runtime);
    const cb = vi.fn();
    client.onStatus(cb);

    const status: PopupStatus = { state: "recording", startedAtWall: 5, eventsCount: 1, lastError: null };
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
