import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import type { EnvInfo } from "@qua/protocol";

vi.mock("wxt/browser", () => ({ browser: fakeBrowser }));

const { SessionFsm } = await import("./fsm.js");

const env: EnvInfo = {
  ua: "test-ua",
  chrome: "142.0",
  platform: "macOS",
  viewport: { w: 1280, h: 800, dpr: 2 },
  ext: "0.1.0",
};

describe("SessionFsm", () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it("arranca en idle", async () => {
    const fsm = new SessionFsm();
    const state = await fsm.load();
    expect(state.phase).toBe("idle");
  });

  it("recorre el ciclo completo idle -> starting -> recording -> stopping -> idle", async () => {
    const fsm = new SessionFsm();
    await fsm.load();

    await fsm.start({ sessionId: "s1", t0Wall: 1000, baseUrl: "http://localhost", env });
    expect(fsm.current.phase).toBe("starting");

    await fsm.confirmRecording();
    expect(fsm.current.phase).toBe("recording");
    expect(fsm.current.session?.sessionId).toBe("s1");

    await fsm.stop();
    expect(fsm.current.phase).toBe("stopping");

    await fsm.finish();
    expect(fsm.current.phase).toBe("idle");
    expect(fsm.current.session).toBeUndefined();
  });

  it("rechaza transiciones inválidas", async () => {
    const fsm = new SessionFsm();
    await fsm.load();
    await expect(fsm.confirmRecording()).rejects.toThrow(/transición inválida/);
    await expect(fsm.stop()).rejects.toThrow(/transición inválida/);
  });

  it("abortStart() vuelve a idle si el handshake falla antes de confirmar", async () => {
    const fsm = new SessionFsm();
    await fsm.load();
    await fsm.start({ sessionId: "s1", t0Wall: 1000, baseUrl: "http://localhost", env });
    await fsm.abortStart();
    expect(fsm.current.phase).toBe("idle");
  });

  it("persiste el estado en chrome.storage.session — sobrevive un reciclado del worker", async () => {
    const fsm = new SessionFsm();
    await fsm.load();
    await fsm.start({ sessionId: "s1", t0Wall: 1000, baseUrl: "http://localhost", env });
    await fsm.confirmRecording();

    // Simula el service worker reciclado: instancia nueva, mismo storage.session.
    const revived = new SessionFsm();
    const state = await revived.load();
    expect(state.phase).toBe("recording");
    expect(state.session?.sessionId).toBe("s1");
  });

  it("isActive() es true en starting y recording, false en idle/stopping", async () => {
    const fsm = new SessionFsm();
    await fsm.load();
    expect(fsm.isActive()).toBe(false);
    await fsm.start({ sessionId: "s1", t0Wall: 1000, baseUrl: "http://localhost", env });
    expect(fsm.isActive()).toBe(true);
    await fsm.confirmRecording();
    expect(fsm.isActive()).toBe(true);
    await fsm.stop();
    expect(fsm.isActive()).toBe(false);
  });
});
