import { describe, expect, it, vi } from "vitest";
import { closestFrame, MAX_FRAME_DISTANCE_MS, processSession, type QuaWasm } from "./process.js";
import type { LocalSessionMeta } from "./store.js";

const meta: LocalSessionMeta = {
  id: "2026-10-14T10-00-00Z-abcd",
  t0_wall: 1_000_000,
  started_at: "2026-10-14T10:00:00.000Z",
  base_url: "https://example.com/",
  env: { ua: "x", chrome: "151", platform: "macOS", viewport: { w: 100, h: 100, dpr: 2 }, ext: "0.1.0" },
};

describe("closestFrame", () => {
  const frames = [
    { t: 1000, tab: 1, jpegB64: "a" },
    { t: 2000, tab: 1, jpegB64: "b" },
    { t: 1900, tab: 2, jpegB64: "c" },
  ];
  it("elige el más cercano de la misma pestaña", () => {
    expect(closestFrame(frames, 1, 1800)?.jpegB64).toBe("b");
    expect(closestFrame(frames, 2, 1000)?.jpegB64).toBe("c");
  });
  it("no devuelve un frame demasiado lejos del momento del issue", () => {
    expect(closestFrame(frames, 1, 2000 + MAX_FRAME_DISTANCE_MS + 1)).toBeUndefined();
    expect(closestFrame(frames, 3, 1000)).toBeUndefined();
  });
});

function fakeWasm(issueConfidence: number): QuaWasm & { renderInput: () => unknown } {
  let rendered: unknown;
  return {
    finalize: vi.fn(() =>
      JSON.stringify({
        session: {
          env: meta.env,
          issues: [
            {
              id: "i01",
              anchor: { confidence: issueConfidence, target: { rect: { x: 1, y: 2, w: 3, h: 4 } } },
              evidence: {},
            },
          ],
        },
        captures: [{ issue_id: "i01", tab: 7, t_target: 500 }],
      }),
    ),
    render: vi.fn((json: string) => {
      rendered = JSON.parse(json);
      return JSON.stringify({ report_md: "# QUA", issues_json: "[]", transcript: "" });
    }),
    crop: vi.fn(() => new Uint8Array([137, 80, 78, 71])),
    renderInput: () => rendered,
  };
}

describe("processSession", () => {
  it("recorta la captura del issue y la referencia desde el reporte", () => {
    const wasm = fakeWasm(0.9);
    const out = processSession(wasm, {
      meta,
      events: [],
      utterances: [],
      tStop: 1_010_000,
      endedAt: "x",
      frames: [{ t: 1_000_400, tab: 7, jpegB64: btoa("jpeg") }],
    });
    // El ancho del viewport, no el dpr: el frame del ring está reducido a 1280 px.
    expect(wasm.crop).toHaveBeenCalledWith(expect.any(Uint8Array), JSON.stringify({ x: 1, y: 2, w: 3, h: 4 }), 100);
    expect(out.assets.map((a) => a.name)).toEqual(["i01.png"]);
    expect((wasm.renderInput() as { issues: { evidence: { screenshot?: string } }[] }).issues[0]!.evidence.screenshot).toBe(
      "assets/i01.png",
    );
    expect(out.reportMd).toBe("# QUA");
  });

  it("sin confianza suficiente no hay captura", () => {
    const wasm = fakeWasm(0.3);
    const out = processSession(wasm, {
      meta,
      events: [],
      utterances: [],
      tStop: 0,
      endedAt: "x",
      frames: [{ t: 1_000_500, tab: 7, jpegB64: btoa("jpeg") }],
    });
    expect(wasm.crop).not.toHaveBeenCalled();
    expect(out.assets).toEqual([]);
  });

  it("un frame que no se puede recortar no rompe el reporte", () => {
    const wasm = fakeWasm(0.9);
    (wasm.crop as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("jpeg roto");
    });
    const out = processSession(wasm, {
      meta,
      events: [],
      utterances: [],
      tStop: 0,
      endedAt: "x",
      frames: [{ t: 1_000_500, tab: 7, jpegB64: btoa("jpeg") }],
    });
    expect(out.assets).toEqual([]);
    expect(out.reportMd).toBe("# QUA");
  });
});
