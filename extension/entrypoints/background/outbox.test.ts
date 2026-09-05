import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Event } from "@qua/protocol";
import { Outbox } from "./outbox.js";

function markEvent(t: number): Event {
  return { t, k: "mark", source: "hotkey" };
}

describe("Outbox", () => {
  let dbCounter = 0;
  let outbox: Outbox;

  beforeEach(() => {
    dbCounter += 1;
    outbox = new Outbox(`test-outbox-${dbCounter}`);
  });

  it("asigna seq monótono creciente", async () => {
    const a = await outbox.nextSeq();
    const b = await outbox.nextSeq();
    const c = await outbox.nextSeq();
    expect([a, b, c]).toEqual([1, 2, 3]);
  });

  it("persiste un lote antes de que se confirme por WS", async () => {
    const seq = await outbox.nextSeq();
    await outbox.enqueue(seq, [markEvent(100)], 100);
    const pending = await outbox.pending();
    expect(pending).toEqual([{ seq, items: [markEvent(100)], queuedAt: 100 }]);
  });

  it("borra todo lote con seq <= ack, conserva los posteriores", async () => {
    const seq1 = await outbox.nextSeq();
    await outbox.enqueue(seq1, [markEvent(1)], 1);
    const seq2 = await outbox.nextSeq();
    await outbox.enqueue(seq2, [markEvent(2)], 2);
    const seq3 = await outbox.nextSeq();
    await outbox.enqueue(seq3, [markEvent(3)], 3);

    await outbox.ack(seq2);

    const pending = await outbox.pending();
    expect(pending.map((b) => b.seq)).toEqual([seq3]);
  });

  it("un ack por debajo del mínimo pendiente no borra nada", async () => {
    const seq = await outbox.nextSeq();
    await outbox.enqueue(seq, [markEvent(1)], 1);
    await outbox.ack(0);
    const pending = await outbox.pending();
    expect(pending).toHaveLength(1);
  });

  it("nextSeq sigue creciendo aunque el lote anterior ya se haya ackeado y borrado", async () => {
    const seq1 = await outbox.nextSeq();
    await outbox.enqueue(seq1, [markEvent(1)], 1);
    await outbox.ack(seq1);
    expect(await outbox.pending()).toEqual([]);

    const seq2 = await outbox.nextSeq();
    expect(seq2).toBe(seq1 + 1);
  });

  it("reset() vacía lotes y contador de seq", async () => {
    const seq1 = await outbox.nextSeq();
    await outbox.enqueue(seq1, [markEvent(1)], 1);
    await outbox.reset();

    expect(await outbox.pending()).toEqual([]);
    const seq2 = await outbox.nextSeq();
    expect(seq2).toBe(1);
  });

  it("pending() devuelve los lotes ordenados por seq", async () => {
    const seq1 = await outbox.nextSeq();
    const seq2 = await outbox.nextSeq();
    const seq3 = await outbox.nextSeq();
    // Se escriben fuera de orden a propósito.
    await outbox.enqueue(seq3, [markEvent(3)], 3);
    await outbox.enqueue(seq1, [markEvent(1)], 1);
    await outbox.enqueue(seq2, [markEvent(2)], 2);

    const pending = await outbox.pending();
    expect(pending.map((b) => b.seq)).toEqual([seq1, seq2, seq3]);
  });
});
