import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AUDIO_FRAME, AUDIO_SAMPLE_RATE, decodeAudioFrame } from "@qua/protocol";
import { f32ToI16Sample, PcmFramer } from "./pcm-framer.js";

// Fixture dorada de §04 (`fixtures/audio-frame.{bin,json}`, fabricada por F0). El
// `.bin` es el frame de 653 bytes que TS y Rust ya prueban que decodifican
// idéntico — acá se usa como oráculo de que el AudioWorklet arma exactamente
// ese mismo layout byte a byte a partir de muestras f32.
const fixtureDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../fixtures");
const goldenBytes = new Uint8Array(readFileSync(resolve(fixtureDir, "audio-frame.bin")));
const goldenJson = JSON.parse(readFileSync(resolve(fixtureDir, "audio-frame.json"), "utf8")) as {
  seq: number;
  t_ms: number;
  samples: number[];
};

describe("f32ToI16Sample", () => {
  it("cubre los extremos del rango i16", () => {
    expect(f32ToI16Sample(-1)).toBe(-32768);
    expect(f32ToI16Sample(0)).toBe(0);
    expect(f32ToI16Sample(1)).toBe(32767);
  });

  it("clampea entradas fuera de [-1, 1]", () => {
    expect(f32ToI16Sample(-4)).toBe(-32768);
    expect(f32ToI16Sample(4)).toBe(32767);
  });

  it("recupera exactamente cada muestra i16 de la fixture dorada tras dividir por 32768 y reconvertir", () => {
    for (const s of goldenJson.samples) {
      expect(f32ToI16Sample(s / 32768)).toBe(s);
    }
  });
});

describe("PcmFramer — layout de §04", () => {
  it("no emite nada hasta juntar las 320 muestras de un frame (20 ms @ 16 kHz)", () => {
    const framer = new PcmFramer();
    const out = framer.push(new Float32Array(AUDIO_FRAME.SAMPLES_PER_FRAME - 1).fill(0.1));
    expect(out).toHaveLength(0);
  });

  it("reproduce byte a byte la fixture dorada acumulando en bloques de 128 (tamaño real de process())", () => {
    const framer = new PcmFramer({ startSeq: goldenJson.seq, startTMs: goldenJson.t_ms });
    const f32 = Float32Array.from(goldenJson.samples, (s) => s / 32768);
    expect(f32).toHaveLength(320);

    // AudioWorkletProcessor.process() entrega quanta fijos de 128 muestras:
    // 128 + 128 + 64 = 320, el frame recién se completa en la tercera llamada.
    expect(framer.push(f32.subarray(0, 128))).toHaveLength(0);
    expect(framer.push(f32.subarray(128, 256))).toHaveLength(0);
    const out = framer.push(f32.subarray(256, 320));

    expect(out).toHaveLength(1);
    expect(out[0]).toEqual(goldenBytes);
  });

  it("decodifica al layout exacto: magic 0xA0, seq u32le, t_ms u64le, 320×i16le mono a 16 kHz", () => {
    const framer = new PcmFramer({ startSeq: 7, startTMs: 999 });
    const value = f32ToI16Sample(0.5);
    const [frame] = framer.push(new Float32Array(320).fill(0.5));

    expect(frame).toHaveLength(AUDIO_FRAME.TOTAL_BYTES);
    expect(frame![0]).toBe(AUDIO_FRAME.MAGIC);

    const decoded = decodeAudioFrame(frame!);
    expect(decoded.seq).toBe(7);
    expect(decoded.t_ms).toBe(999);
    expect(decoded.samples).toHaveLength(320);
    expect([...decoded.samples].every((v) => v === value)).toBe(true);
  });

  it("numera seq de forma monótona y avanza t_ms exactamente 20 ms por frame a 16 kHz", () => {
    const framer = new PcmFramer({ startSeq: 100, startTMs: 5000 });
    const [f0] = framer.push(new Float32Array(320).fill(0));
    const [f1] = framer.push(new Float32Array(320).fill(0));
    const [f2] = framer.push(new Float32Array(320).fill(0));

    const d0 = decodeAudioFrame(f0!);
    const d1 = decodeAudioFrame(f1!);
    const d2 = decodeAudioFrame(f2!);

    expect([d0.seq, d1.seq, d2.seq]).toEqual([100, 101, 102]);
    expect([d0.t_ms, d1.t_ms, d2.t_ms]).toEqual([5000, 5000 + AUDIO_FRAME.FRAME_MS, 5000 + 2 * AUDIO_FRAME.FRAME_MS]);
    expect(framer.nextSeq).toBe(103);
  });

  it("mantiene el remanente entre llamadas cuando un bloque no cae justo en el límite de 320", () => {
    const framer = new PcmFramer({ startSeq: 0, startTMs: 0 });
    const a = f32ToI16Sample(0.1);
    const b = f32ToI16Sample(-0.1);
    const c = f32ToI16Sample(0.2);

    expect(framer.push(new Float32Array(200).fill(0.1))).toHaveLength(0);
    const first = framer.push(new Float32Array(200).fill(-0.1)); // 400 acumuladas → 1 frame, 80 quedan pendientes
    expect(first).toHaveLength(1);

    const d0 = decodeAudioFrame(first[0]!);
    expect(d0.samples[0]).toBe(a);
    expect(d0.samples[199]).toBe(a);
    expect(d0.samples[200]).toBe(b);
    expect(d0.samples[319]).toBe(b);

    const second = framer.push(new Float32Array(240).fill(0.2)); // 80 pendientes + 240 → 1 frame más, 0 quedan
    expect(second).toHaveLength(1);
    const d1 = decodeAudioFrame(second[0]!);
    expect(d1.samples[0]).toBe(b);
    expect(d1.samples[79]).toBe(b);
    expect(d1.samples[80]).toBe(c);
    expect(d1.samples[319]).toBe(c);
  });

  it("un frame equivale exactamente a 20 ms de audio mono a 16 kHz", () => {
    const ms = (AUDIO_FRAME.SAMPLES_PER_FRAME / AUDIO_SAMPLE_RATE) * 1000;
    expect(ms).toBe(AUDIO_FRAME.FRAME_MS);
  });
});
