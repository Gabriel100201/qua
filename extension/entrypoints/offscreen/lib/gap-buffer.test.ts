import { describe, expect, it } from "vitest";
import { AUDIO_FRAME } from "@qua/protocol";
import { GapBuffer } from "./gap-buffer.js";

function frame(tag: number): Uint8Array {
  return new Uint8Array([tag]);
}

describe("GapBuffer", () => {
  it("no descarta nada mientras esté por debajo de la capacidad", () => {
    const buf = new GapBuffer({ capacityMs: 100 }); // 5 frames @ 20 ms
    for (let i = 0; i < 5; i++) buf.push(frame(i));
    expect(buf.size).toBe(5);
    expect(buf.takeDroppedMs()).toBe(0);
  });

  it("descarta lo más viejo al desbordar y reporta la duración perdida", () => {
    const buf = new GapBuffer({ capacityMs: 100 }); // 5 frames
    for (let i = 0; i < 8; i++) buf.push(frame(i));
    expect(buf.size).toBe(5);
    expect(buf.takeDroppedMs()).toBe(3 * AUDIO_FRAME.FRAME_MS);
    // Los 3 primeros (0,1,2) se descartaron; quedan 3..7.
    expect(buf.drain().map((f) => f[0])).toEqual([3, 4, 5, 6, 7]);
  });

  it("takeDroppedMs se resetea a 0 después de leerlo", () => {
    const buf = new GapBuffer({ capacityMs: 20 }); // 1 frame
    buf.push(frame(0));
    buf.push(frame(1));
    expect(buf.takeDroppedMs()).toBe(AUDIO_FRAME.FRAME_MS);
    expect(buf.takeDroppedMs()).toBe(0);
  });

  it("drain vacía el buffer y preserva el orden", () => {
    const buf = new GapBuffer({ capacityMs: 30_000 });
    for (let i = 0; i < 10; i++) buf.push(frame(i));
    expect(buf.drain().map((f) => f[0])).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(buf.size).toBe(0);
    expect(buf.drain()).toEqual([]);
  });

  it("respeta el default de 30 s de §04", () => {
    const buf = new GapBuffer();
    const capacityFrames = 30_000 / AUDIO_FRAME.FRAME_MS;
    for (let i = 0; i < capacityFrames + 10; i++) buf.push(frame(i % 256));
    expect(buf.size).toBe(capacityFrames);
    expect(buf.takeDroppedMs()).toBe(10 * AUDIO_FRAME.FRAME_MS);
  });
});
