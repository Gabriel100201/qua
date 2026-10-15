import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

vi.mock("wxt/browser", () => ({ browser: fakeBrowser }));

const { LocalSessionManager } = await import("./local-session-manager.js");
const { LocalStore } = await import("../../shared/local/store.js");

const VIEWPORT = { w: 1280, h: 800, dpr: 2 };
let n = 0;

async function setup() {
  fakeBrowser.reset();
  (fakeBrowser.runtime as unknown as { getManifest: () => { version: string } }).getManifest = () => ({ version: "0.1.0" });
  let hasDoc = false;
  const offscreen = {
    hasDocument: vi.fn(async () => hasDoc),
    createDocument: vi.fn(async () => {
      hasDoc = true;
    }),
    closeDocument: vi.fn(async () => {
      hasDoc = false;
    }),
  };
  (fakeBrowser as unknown as { offscreen: typeof offscreen }).offscreen = offscreen;
  const sent: unknown[] = [];
  fakeBrowser.runtime.sendMessage = vi.fn(async (m: unknown) => {
    sent.push(m);
  }) as never;
  const store = new LocalStore(`qua-local-sm-${++n}`);
  let now = 1_700_000_000_000;
  const manager = new LocalSessionManager(store, () => now);
  await manager.init();
  return { manager, store, offscreen, sent, advance: (ms: number) => (now += ms) };
}

describe("LocalSessionManager (modo local, D-L1-01)", () => {
  beforeEach(() => vi.useRealTimers());

  it("grabar abre el offscreen, arranca el mic y precarga el modelo", async () => {
    const { manager, store, offscreen, sent } = await setup();
    await manager.start("https://agendi.app/", VIEWPORT, { id: 3, title: "Agendi" });

    expect(manager.getPhase()).toBe("recording");
    expect(offscreen.createDocument).toHaveBeenCalledWith(expect.objectContaining({ reasons: ["USER_MEDIA", "WORKERS", "CLIPBOARD"] }));
    expect(sent).toEqual([
      { type: "qua:start-capture", t0Wall: 1_700_000_000_000 },
      { type: "qua:preload-model" },
    ]);
    expect((await store.latestSession())?.status).toBe("recording");
  });

  it("detener guarda los eventos, marca la sesión en processing y le pide al offscreen que procese", async () => {
    const { manager, store, sent, advance } = await setup();
    await manager.start("https://agendi.app/", VIEWPORT, { id: 3, title: "Agendi" });
    manager.enqueue({ t: 1_700_000_000_500, k: "mark", source: "popup" });
    advance(10_000);
    await manager.stop();

    const s = await store.latestSession();
    expect(manager.getPhase()).toBe("idle");
    expect(s?.status).toBe("processing");
    expect(s?.t_stop).toBe(1_700_000_010_000);
    expect((await store.events(s!.id)).map((e) => e.k)).toEqual(["nav", "mark"]);
    expect(sent.at(-1)).toMatchObject({ type: "qua:process-session", sessionId: s!.id, tStop: 1_700_000_010_000 });
  });

  it("una sesión que quedó procesando sin offscreen (Chrome se cerró) pasa a fallida y deja grabar", async () => {
    const { manager, store, offscreen } = await setup();
    await manager.start("https://agendi.app/", VIEWPORT);
    await manager.stop();
    await offscreen.closeDocument();
    await manager.start("https://agendi.app/", VIEWPORT);
    const sessions = await store.listSessions();
    expect(sessions.map((s) => s.status).sort()).toEqual(["failed", "recording"]);
  });

  it("no deja grabar otra sesión mientras la anterior se procesa", async () => {
    const { manager } = await setup();
    await manager.start("https://agendi.app/", VIEWPORT);
    await manager.stop();
    await expect(manager.start("https://agendi.app/", VIEWPORT)).rejects.toThrow("procesando la sesión anterior");
  });

  it("al terminar de procesar cierra el offscreen y un fallo queda como error visible", async () => {
    const { manager, offscreen, store } = await setup();
    await manager.start("https://agendi.app/", VIEWPORT);
    await manager.stop();
    // El offscreen marca la sesión como fallida antes de avisar (processLocalSession).
    const s = await store.latestSession();
    await store.updateSession(s!.id, { status: "failed", error: "sin GPU" });

    expect(manager.handleOffscreenMessage({ type: "qua:process-done", sessionId: "x", ok: false, error: "sin GPU" })).toBe(true);
    await vi.waitFor(() => expect(offscreen.closeDocument).toHaveBeenCalled());
    expect(manager.getLastError()).toContain("sin GPU");
  });

  it("no precarga el modelo si ya estaba listo: inicializarlo durante la grabación corta el audio", async () => {
    const { manager, sent } = await setup();
    await fakeBrowser.storage.local.set({ "qua:model-state": { status: "listo", device: "webgpu" } });
    await manager.start("https://agendi.app/", VIEWPORT);
    expect(sent).toEqual([{ type: "qua:start-capture", t0Wall: 1_700_000_000_000 }]);
  });

  it("guarda el estado del modelo que reporta el offscreen", async () => {
    const { manager } = await setup();
    manager.handleOffscreenMessage({ type: "qua:model-state", state: { status: "listo", device: "webgpu" } });
    await vi.waitFor(async () =>
      expect(await fakeBrowser.storage.local.get("qua:model-state")).toEqual({
        "qua:model-state": { status: "listo", device: "webgpu" },
      }),
    );
  });

  it("inyecta el content script si la pestaña estaba abierta desde antes de instalar", async () => {
    const { manager } = await setup();
    fakeBrowser.tabs.sendMessage = vi.fn().mockRejectedValue(new Error("Could not establish connection")) as never;
    const executeScript = vi.fn().mockResolvedValue([]);
    fakeBrowser.scripting.executeScript = executeScript as never;
    await manager.start("https://pediloapp.com/", VIEWPORT, { id: 9, title: "Pedilo" });
    expect(executeScript).toHaveBeenCalledWith({ target: { tabId: 9 }, files: ["content-scripts/content.js"] });
  });

  it("no lo inyecta dos veces si la pestaña ya contesta el ping", async () => {
    const { manager } = await setup();
    fakeBrowser.tabs.sendMessage = vi.fn().mockResolvedValue({ type: "qua:pong" }) as never;
    const executeScript = vi.fn().mockResolvedValue([]);
    fakeBrowser.scripting.executeScript = executeScript as never;
    await manager.start("https://pediloapp.com/", VIEWPORT, { id: 9, title: "Pedilo" });
    expect(executeScript).not.toHaveBeenCalled();
  });

  it("si Chrome recicla el worker a mitad de grabación, detener igual le avisa a la pastilla", async () => {
    const { manager, store } = await setup();
    fakeBrowser.tabs.sendMessage = vi.fn().mockResolvedValue({ type: "qua:pong" }) as never;
    await manager.start("https://pediloapp.com/", VIEWPORT, { id: 9, title: "Pedilo" });
    manager.mark("popup");

    // Worker nuevo: misma base y mismo storage, nada en memoria.
    const sendToTab = vi.fn().mockResolvedValue(undefined);
    fakeBrowser.tabs.sendMessage = sendToTab as never;
    const reborn = new LocalSessionManager(store, () => 1_700_000_005_000);
    await reborn.init();
    expect(reborn.getPhase()).toBe("recording");
    expect(reborn.getMarks()).toHaveLength(1);
    expect(await reborn.overlayStateFor(4)).toEqual({ kind: "hidden" }); // otra pestaña no la ve

    await reborn.stop();
    await vi.waitFor(() => expect(sendToTab).toHaveBeenCalledWith(9, expect.objectContaining({ type: "qua:overlay", state: expect.objectContaining({ kind: "processing" }) })));
  });

  it("los eventos fuera de una grabación se ignoran", async () => {
    const { manager } = await setup();
    manager.enqueue({ t: 1, k: "mark", source: "popup" });
    expect(manager.getEventsCount()).toBe(0);
  });
});
