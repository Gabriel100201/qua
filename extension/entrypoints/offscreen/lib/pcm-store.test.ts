import { describe, expect, it } from "vitest";
import { PcmStore } from "./pcm-store.js";

function frame(tMs: number, value: number, samples = 320): Uint8Array {
  const b = new Uint8Array(13 + samples * 2);
  const v = new DataView(b.buffer);
  b[0] = 0xa0;
  v.setUint32(1, 0, true);
  v.setBigUint64(5, BigInt(tMs), true);
  for (let i = 0; i < samples; i++) v.setInt16(13 + i * 2, value, true);
  return b;
}

describe("PcmStore", () => {
  it("ubica cada frame según su t_ms, con silencio en los huecos", () => {
    const store = new PcmStore();
    store.push(frame(20, 7)); // arranca a los 20 ms: el mic tardó
    store.push(frame(60, -3)); // se perdió el frame de 40 ms
    const pcm = store.pcm();
    expect(pcm.length).toBe(80 * 16);
    expect(pcm[0]).toBe(0);
    expect(pcm[20 * 16]).toBe(7);
    expect(pcm[40 * 16]).toBe(0);
    expect(pcm[60 * 16]).toBe(-3);
    expect(store.durationMs()).toBe(80);
  });

  it("crece más allá del buffer inicial y descarta lo que no es un frame", () => {
    const store = new PcmStore();
    store.push(new Uint8Array([1, 2, 3]));
    store.push(frame(120_000, 5));
    expect(store.durationMs()).toBe(120_020);
    store.clear();
    expect(store.pcm().length).toBe(0);
  });
});
