import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import type { FakeDaemon } from "./testing/fake-daemon.js";

vi.mock("wxt/browser", () => ({ browser: fakeBrowser }));

const { SessionManager } = await import("./session-manager.js");
const { FakeDaemon: FakeDaemonCtor } = await import("./testing/fake-daemon.js");

const TOKEN_STORAGE_KEY = "qua:daemon-token";
const VIEWPORT = { w: 1280, h: 800, dpr: 2 };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function setupManager(daemon: FakeDaemon) {
  fakeBrowser.reset();
  await fakeBrowser.storage.local.set({ [TOKEN_STORAGE_KEY]: "test-token" });
  (fakeBrowser.runtime as unknown as { getManifest: () => { version: string } }).getManifest = () => ({
    version: "0.1.0",
  });
  const manager = new SessionManager(() => 1_700_000_000_000, daemon.createSocket);
  await manager.init(); // como en `index.ts` real: siempre corre antes de cualquier otra cosa
  return manager;
}

/**
 * CRITERIO de esta tarea (§09, D-C1-01/D-P1-01): al recibir `session.control` con
 * action start/stop/mark, la FSM transiciona y se emite el evento correcto. El WS se
 * mockea con `FakeDaemon` (`testing/fake-daemon.ts`), como ya hace A2 en
 * `ws-client.test.ts`/`session-resilience.test.ts`.
 */
describe("session.control: el hotkey global reenviado por el daemon", () => {
  it("action mark durante la grabación encola el mismo evento que chrome.commands (D-09)", async () => {
    const daemon = new FakeDaemonCtor({ responseDelayMs: 1 });
    const manager = await setupManager(daemon);

    await manager.start("https://agendi.app", VIEWPORT);
    await sleep(15);
    expect(manager.getPhase()).toBe("recording");

    const [socket] = [...daemon.sockets];
    if (!socket) throw new Error("sin socket conectado");
    socket.triggerMessage({ v: 1, type: "session.control", action: "mark", t: 123 });
    await sleep(15);

    expect(daemon.allEvents()).toEqual([{ t: 123, k: "mark", source: "hotkey" }]);
  });

  it("action mark en idle no hace nada (no hay sesión que marcar)", async () => {
    const daemon = new FakeDaemonCtor({ responseDelayMs: 1 });
    const manager = await setupManager(daemon);

    await sleep(15);
    expect(manager.getPhase()).toBe("idle");

    const [socket] = [...daemon.sockets];
    if (!socket) throw new Error("sin socket conectado");
    socket.triggerMessage({ v: 1, type: "session.control", action: "mark", t: 999 });
    await sleep(15);

    expect(manager.getPhase()).toBe("idle");
    expect(daemon.allEvents()).toEqual([]);
  });

  it("action stop durante la grabación transiciona la FSM de vuelta a idle", async () => {
    const daemon = new FakeDaemonCtor({ responseDelayMs: 1 });
    const manager = await setupManager(daemon);

    await manager.start("https://agendi.app", VIEWPORT);
    await sleep(15);
    expect(manager.getPhase()).toBe("recording");

    const [socket] = [...daemon.sockets];
    if (!socket) throw new Error("sin socket conectado");
    socket.triggerMessage({ v: 1, type: "session.control", action: "stop", t: 456 });
    await sleep(30);

    expect(manager.getPhase()).toBe("idle");
  });

  it("action start en idle arranca una sesión real con la pestaña activa (§09: cualquier app en foco)", async () => {
    const daemon = new FakeDaemonCtor({ responseDelayMs: 1 });
    const manager = await setupManager(daemon);

    (fakeBrowser.tabs as unknown as { query: () => Promise<unknown[]> }).query = vi
      .fn()
      .mockResolvedValue([{ id: 1, url: "https://agendi.app/agenda" }]);
    (fakeBrowser as unknown as { scripting: { executeScript: () => Promise<unknown[]> } }).scripting = {
      executeScript: vi.fn().mockResolvedValue([{ result: { w: 1440, h: 900, dpr: 2 } }]),
    };

    await sleep(15); // `setupManager` ya corrió `init()`, que abrió el canal de control ocioso
    expect(manager.getPhase()).toBe("idle");
    expect(daemon.sockets.size).toBe(1); // solo el canal de control, ningún `session.start`
    expect(daemon.sessionStartCount).toBe(0);

    const [controlSocket] = [...daemon.sockets];
    if (!controlSocket) throw new Error("sin socket conectado");
    controlSocket.triggerMessage({ v: 1, type: "session.control", action: "start", t: 789 });
    await sleep(30);

    expect(manager.getPhase()).toBe("recording");
    expect(daemon.sessionStartCount).toBe(1);
    expect(daemon.helloCount).toBe(2); // canal de control + canal de grabación
  });
});
