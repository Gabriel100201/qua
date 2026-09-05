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

    // El buffer también trae el `nav` sintético de arranque (D-Z1-01, sin flush
    // propio) — el `mark` es lo que este test verifica, así que se filtra el resto.
    const markEvents = daemon.allEvents().filter((e) => e.k === "mark");
    expect(markEvents).toEqual([{ t: 123, k: "mark", source: "hotkey" }]);
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

/**
 * D-Z1-01: el `nav` (kind: "load") de la página lo emite el content script al
 * cargar — casi siempre antes de que la sesión llegue a "recording" (el caso común:
 * el usuario ya está parado en la página cuando aprieta grabar). `onEvent` descarta
 * todo evento que llegue mientras la fase no es "recording", así que ese `nav`
 * nunca cruza al daemon y `route_context` (`qua-core/src/correlate/mod.rs`) no
 * tiene de dónde sacar la URL — el reporte ancla a "(ruta desconocida)" pese a que
 * `baseUrl` está bien en `session.json`. `start()` tiene que reconstruir ese `nav`
 * él mismo, ahora que la fase sí es "recording".
 */
describe("nav sintético al arrancar (D-Z1-01)", () => {
  it("start() encola un nav kind:load con la baseUrl real, no solo en session.start", async () => {
    const daemon = new FakeDaemonCtor({ responseDelayMs: 1 });
    const manager = await setupManager(daemon);

    await manager.start("https://agendi.app/agenda", VIEWPORT, { id: 7, title: "Agenda" });
    await sleep(15);
    expect(manager.getPhase()).toBe("recording");

    // El `nav` no fuerza flush inmediato (§04: solo `mark` y `console.error` lo
    // hacen) — `stop()` flushea lo que haya quedado en el buffer del `WsClient`.
    await manager.stop();

    const navEvents = daemon.allEvents().filter((e) => e.k === "nav");
    expect(navEvents).toEqual([
      { t: 1_700_000_000_000, tab: 7, k: "nav", url: "https://agendi.app/agenda", title: "Agenda", kind: "load" },
    ]);
  });

  it("sin tab conocida igual encola el nav (sin tab id, pero con la url)", async () => {
    const daemon = new FakeDaemonCtor({ responseDelayMs: 1 });
    const manager = await setupManager(daemon);

    await manager.start("https://agendi.app", VIEWPORT);
    await sleep(15);
    await manager.stop();

    const navEvents = daemon.allEvents().filter((e) => e.k === "nav");
    expect(navEvents).toEqual([
      { t: 1_700_000_000_000, k: "nav", url: "https://agendi.app", title: "", kind: "load" },
    ]);
  });
});
