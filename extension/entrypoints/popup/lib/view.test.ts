import { describe, expect, it } from "vitest";
import { popupView } from "./view.js";
import type { StatusResponse } from "../../background/internal-messages.js";

const NOW = 1_800_000_000_000;
const base = (o: Partial<StatusResponse> = {}): StatusResponse => ({
  phase: "idle", paired: true, startedAtWall: null, eventsCount: 0, lastError: null, micReady: false, marks: [],
  tab: { url: "https://pediloapp.com/admin", recordable: true }, model: { status: "listo", device: "webgpu" }, latest: null, ...o,
});

describe("popupView: un estado del diseño por situación", () => {
  it("1 · Listo para grabar: el anillo quieto es el botón", () => {
    const v = popupView(base(), "granted", NOW);
    expect(v.kind).toBe("idle");
    expect(v.ringAction).toBe("start");
    expect(v.reading).toBe("00:00");
    expect(v.place).toBe("pediloapp.com/admin");
    expect(v.glyphs).toEqual({ mic: "ok", engine: "ok", tab: "ok" });
  });

  it("2 · Abriendo el micrófono hasta que llega audio", () => {
    const v = popupView(base({ phase: "recording", startedAtWall: NOW - 900, micReady: false }), "granted", NOW);
    expect(v.kind).toBe("opening");
    expect(v.controls).toBe("opening");
    expect(v.ringAction).toBe("stop");
  });

  it("3 · Grabando: cronómetro y marcas", () => {
    const v = popupView(base({ phase: "recording", startedAtWall: NOW - 161_000, micReady: true, marks: [10_000, 40_000] }), "granted", NOW);
    expect(v.kind).toBe("recording");
    expect(v.reading).toBe("02:41");
    expect(v.caption).toBe("2 marcas");
    expect((v.ring as { opts: { marks: number[] } }).opts.marks).toHaveLength(2);
  });

  it("4 · Transcribiendo: frases hechas de total, en el tramo de texto del anillo", () => {
    const v = popupView(base({ latest: { id: "s", status: "processing", progress: { stage: "transcripcion", done: 12, total: 34 } } }), "granted", NOW);
    expect(v.kind).toBe("processing");
    expect(v.reading).toBe("12 de 34");
    expect((v.ring as { opts: { stage: number } }).opts.stage).toBe(1);
    expect(v.ringAction).toBeNull();
  });

  it("5 · Primera vez: bajando el modelo", () => {
    const v = popupView(base({ latest: { id: "s", status: "processing", progress: { stage: "modelo", done: 620, total: 1000 } } }), "granted", NOW);
    expect(v.kind).toBe("download");
    expect(v.reading).toBe("62 %");
  });

  it("6 · Reporte listo: un punto por issue, en su momento de la sesión", () => {
    const v = popupView(base({ latest: { id: "s", status: "ready", issues: 7, baseUrl: "https://pediloapp.com/", durationMs: 161_000, issueTimes: [4000, 86000, 139000], updatedAt: NOW - 1000 } }), "granted", NOW);
    expect(v.kind).toBe("ready");
    expect(v.reading).toBe("7 issues");
    expect(v.caption).toBe("pediloapp.com en 2 min 41 s");
    expect((v.ring as { opts: { issues: number[] } }).opts.issues).toHaveLength(3);
    expect(v.controls).toBe("ready");
  });

  it("el reporte deja de ser lo primero que se ve después de media hora", () => {
    const v = popupView(base({ latest: { id: "s", status: "ready", issues: 1, updatedAt: NOW - 31 * 60_000 } }), "granted", NOW);
    expect(v.kind).toBe("idle");
  });

  it("7 · Sin micrófono: rojo y el botón para arreglarlo", () => {
    const v = popupView(base(), "denied", NOW);
    expect(v.kind).toBe("mic-denied");
    expect(v.readingTone).toBe("red");
    expect(v.controls).toBe("grant-mic");
    expect(v.glyphs.mic).toBe("err");
  });

  it("8 · Acá no se puede grabar (páginas de Chrome)", () => {
    const v = popupView(base({ tab: { url: "chrome://extensions", recordable: false } }), "granted", NOW);
    expect(v.kind).toBe("not-recordable");
    expect(v.ringAction).toBeNull();
    expect(v.glyphs.tab).toBe("err");
  });

  it("9 · Falló el procesamiento: reintentar con el audio guardado", () => {
    const v = popupView(base({ latest: { id: "s9", status: "failed", error: "x", updatedAt: NOW } }), "granted", NOW);
    expect(v.kind).toBe("failed");
    expect(v.controls).toBe("retry");
    expect(v.sessionId).toBe("s9");
  });

  it("motor sin GPU: el tooltip lo dice", () => {
    const v = popupView(base({ model: { status: "listo", device: "wasm" } }), "granted", NOW);
    expect(v.tips.engine).toContain("sin GPU");
  });
});
