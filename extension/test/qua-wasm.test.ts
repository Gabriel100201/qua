import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import initQuaWasm, { finalize, render, segment, vad_chunk_size } from "../shared/qua-wasm/qua_wasm.js";

/**
 * qua-wasm de verdad (D-L1-01), no un mock: es el mismo `qua-core` que usa `quad`,
 * compilado a wasm32. Necesita `pnpm build:wasm` antes; sin eso el test se saltea.
 */
// vitest corre desde `extension/` (jsdom no da un `import.meta.url` con esquema file:).
const wasmPath = join(process.cwd(), "shared/qua-wasm/qua_wasm_bg.wasm");
const built = existsSync(wasmPath);

describe.skipIf(!built)("qua-wasm", () => {
  beforeAll(async () => {
    await initQuaWasm({ module_or_path: readFileSync(wasmPath) });
  });

  it("segmenta con los parámetros de §06.1: padding de 300 ms y cierre tras 600 ms de silencio", () => {
    const chunk = vad_chunk_size();
    expect(chunk).toBe(512);
    // 10 s de audio: habla entre los chunks 50 y 100 (1,6 s a 3,2 s).
    const chunks = Math.floor((16000 * 10) / chunk);
    const probs = new Float32Array(chunks).map((_, i) => (i >= 50 && i < 100 ? 0.95 : 0.01));
    const pcm = new Int16Array(16000 * 10).fill(1000);
    const segs = JSON.parse(segment(pcm, probs, "")) as { t_offset_ms: number; len: number }[];
    expect(segs).toHaveLength(1);
    expect(segs[0]!.t_offset_ms).toBe(1600 - 300);
    expect(segs[0]!.len / 16).toBeGreaterThanOrEqual(3200 - 1300);
  });

  it("finalize arma la sesión, normaliza tiempos y usa el host como proyecto", () => {
    const t0 = 1_789_681_899_391;
    const out = JSON.parse(
      finalize(
        JSON.stringify({
          meta: {
            id: "2026-10-14T10-00-00Z-abcd",
            t0_wall: t0,
            started_at: "2026-10-14T10:00:00.000Z",
            base_url: "https://technodevs.com.ar/",
            env: { ua: "x", chrome: "151", platform: "macOS", viewport: { w: 1710, h: 981, dpr: 2 }, ext: "0.1.0" },
          },
          events: [
            { k: "nav", t: t0, tab: 1, url: "https://technodevs.com.ar/", title: "T", kind: "load" },
            { k: "evento_inventado", t: t0 + 5 },
          ],
          utterances: [
            {
              id: "u01",
              t_start: 2000,
              t_end: 4000,
              text: "este botón no hace nada cuando lo aprieto",
              lang: "es",
              words: [],
              avg_logprob: -0.2,
              no_speech_prob: 0.01,
              marked: false,
            },
          ],
          t_stop: t0 + 10_000,
          ended_at: "2026-10-14T10:00:10.000Z",
        }),
      ),
    );
    expect(out.skipped_events).toBe(1);
    expect(out.session.project.label).toBe("technodevs.com.ar");
    expect(out.session.events[0].t).toBe(0);
    expect(out.session.duration_ms).toBe(10_000);
    expect(out.session.status).toBe("ready");
    expect(out.session.issues.length).toBeGreaterThanOrEqual(1);

    const md = JSON.parse(render(JSON.stringify(out.session))).report_md as string;
    expect(md.startsWith("# QUA — technodevs.com.ar")).toBe(true);
    expect(md).toContain("este botón no hace nada");
  });
});
