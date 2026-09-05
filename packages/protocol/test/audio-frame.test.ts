import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { AUDIO_FRAME } from "../src/constants.js";
import {
  decodeAudioFrame,
  encodeAudioFrame,
  isAudioFrame,
} from "../src/audio-frame.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

interface GoldenFrame {
  total_bytes: number;
  seq: number;
  t_ms: number;
  samples: number[];
}

const golden: GoldenFrame = JSON.parse(
  readFileSync(resolve(repoRoot, "fixtures/audio-frame.json"), "utf8"),
);
const bin = new Uint8Array(readFileSync(resolve(repoRoot, "fixtures/audio-frame.bin")));

describe("frame binario de audio (§04)", () => {
  it("el layout es el de la spec", () => {
    expect(AUDIO_FRAME.MAGIC).toBe(0xa0);
    expect(AUDIO_FRAME.OFFSET_SEQ).toBe(1);
    expect(AUDIO_FRAME.OFFSET_T_MS).toBe(5);
    expect(AUDIO_FRAME.OFFSET_SAMPLES).toBe(13);
    expect(AUDIO_FRAME.SAMPLES_PER_FRAME).toBe(320);
    expect(AUDIO_FRAME.TOTAL_BYTES).toBe(653);
  });

  it("el frame dorado tiene 653 bytes", () => {
    expect(bin.length).toBe(golden.total_bytes);
    expect(bin.length).toBe(AUDIO_FRAME.TOTAL_BYTES);
  });

  it("decodifica el frame dorado exactamente", () => {
    const frame = decodeAudioFrame(bin);
    expect(frame.seq).toBe(golden.seq);
    expect(frame.t_ms).toBe(golden.t_ms);
    expect([...frame.samples]).toEqual(golden.samples);
  });

  it("round-trip byte a byte", () => {
    expect([...encodeAudioFrame(decodeAudioFrame(bin))]).toEqual([...bin]);
  });

  it("reconoce el magic sin parsear", () => {
    expect(isAudioFrame(bin)).toBe(true);
    expect(isAudioFrame(new Uint8Array([0x7b]))).toBe(false);
  });

  it("rechaza magic equivocado y tamaño equivocado", () => {
    const malo = new Uint8Array(bin);
    malo[0] = 0x01;
    expect(() => decodeAudioFrame(malo)).toThrow(/Magic inesperado/);
    expect(() => decodeAudioFrame(bin.slice(0, 100))).toThrow(/bytes/);
  });
});
