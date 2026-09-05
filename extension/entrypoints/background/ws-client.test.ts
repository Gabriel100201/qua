import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Event } from "@qua/protocol";
import { Outbox } from "./outbox.js";
import { WsClient } from "./ws-client.js";
import { FakeDaemon } from "./testing/fake-daemon.js";

const HELLO = { ext_version: "0.1.0", chrome: "142.0", platform: "macOS 15.1" };
const SESSION = {
  t0Wall: 1_000_000,
  baseUrl: "http://localhost:3000",
  env: {
    ua: "test",
    chrome: "142.0",
    platform: "macOS",
    viewport: { w: 1280, h: 800, dpr: 2 },
    ext: "0.1.0",
  },
};

// Nota: `k:"mark"` fuerza flush inmediato (§04) — para probar batching normal se
// usan eventos que NO lo fuercen.
function longTask(t: number, duration_ms = 10): Event {
  return { t, k: "long_task", duration_ms };
}

function markEvent(t: number): Event {
  return { t, k: "mark", source: "hotkey" };
}

let dbCounter = 0;
function freshOutbox() {
  dbCounter += 1;
  return new Outbox(`ws-client-test-${dbCounter}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * fake-indexeddb entrega sus callbacks vía `setImmediate` real (a propósito: ver
 * `lib/scheduling.js` — así respeta que una transacción de IndexedDB nunca queda
 * activa entre ticks). Los tests que dependen de un flush disparado *indirectamente*
 * (el timer de 500ms, o el `enqueue()` que fuerza flush en fire-and-forget) usan
 * timers reales con constantes chiquitas en vez de `vi.useFakeTimers()`: mezclar
 * el reloj falso de Sinon con el `setImmediate` real de fake-indexeddb es frágil.
 * El backoff exponencial de verdad (250 ms → 8 s) se prueba aparte, con reloj
 * falso, en un test que nunca toca el outbox.
 */
describe("WsClient — batching y ack (timers reales, constantes chicas)", () => {
  it("escribe en el outbox ANTES de mandar, y borra recién al llegar el ack", async () => {
    const outbox = freshOutbox();
    const daemon = new FakeDaemon({ autoAck: false, responseDelayMs: 1 });
    const client = new WsClient({
      url: "ws://127.0.0.1:7331/ws?token=abc",
      hello: HELLO,
      outbox,
      createSocket: daemon.createSocket,
      flushIntervalMs: 500,
    });

    client.startSession(SESSION);
    await sleep(10); // handshake

    client.enqueue(longTask(1));
    await client.flush();

    const pending = await outbox.pending();
    expect(pending).toHaveLength(1);
    expect(daemon.received).toHaveLength(1); // se mandó también, pero sin ack todavía
    expect(daemon.received[0]?.seq).toBe(pending[0]?.seq);
  });

  it("un ack del daemon vacía el outbox", async () => {
    const outbox = freshOutbox();
    const daemon = new FakeDaemon({ autoAck: true, responseDelayMs: 1 });
    const client = new WsClient({
      url: "ws://127.0.0.1:7331/ws?token=abc",
      hello: HELLO,
      outbox,
      createSocket: daemon.createSocket,
    });
    client.startSession(SESSION);
    await sleep(10);

    client.enqueue(longTask(1));
    await client.flush();
    expect(await outbox.pending()).toHaveLength(1);

    await sleep(10); // el ack del daemon llega ~1ms después
    expect(await outbox.pending()).toEqual([]);
  });

  it("mark fuerza flush inmediato, sin esperar el intervalo normal", async () => {
    const daemon = new FakeDaemon({ responseDelayMs: 1 });
    const client = new WsClient({
      url: "ws://127.0.0.1:7331/ws?token=abc",
      hello: HELLO,
      outbox: freshOutbox(),
      createSocket: daemon.createSocket,
      flushIntervalMs: 10_000, // bien por encima de lo que dura el test
    });
    client.startSession(SESSION);
    await sleep(10);

    client.enqueue(markEvent(1));
    await sleep(20);

    expect(daemon.received.flatMap((b) => b.items)).toEqual([markEvent(1)]);
  });

  it("flushea al llegar al tamaño de batch, aunque no pase el intervalo", async () => {
    const daemon = new FakeDaemon({ responseDelayMs: 1 });
    const client = new WsClient({
      url: "ws://127.0.0.1:7331/ws?token=abc",
      hello: HELLO,
      outbox: freshOutbox(),
      createSocket: daemon.createSocket,
      flushIntervalMs: 10_000,
      flushBatchSize: 10,
    });
    client.startSession(SESSION);
    await sleep(10);

    for (let i = 0; i < 10; i++) client.enqueue(longTask(i));
    await sleep(20);

    expect(daemon.received.flatMap((b) => b.items)).toHaveLength(10);
  });

  it("flushea por intervalo aunque el batch no llegue al tamaño límite", async () => {
    const daemon = new FakeDaemon({ responseDelayMs: 1 });
    const client = new WsClient({
      url: "ws://127.0.0.1:7331/ws?token=abc",
      hello: HELLO,
      outbox: freshOutbox(),
      createSocket: daemon.createSocket,
      flushIntervalMs: 20,
      flushBatchSize: 1000,
    });
    client.startSession(SESSION);
    await sleep(10);

    client.enqueue(longTask(1));
    client.enqueue(longTask(2));
    expect(daemon.received).toHaveLength(0);

    await sleep(40);

    expect(daemon.received.flatMap((b) => b.items)).toHaveLength(2);
  });

  it("al reconectar reenvía (replay) los lotes pendientes en orden de seq", async () => {
    const outbox = freshOutbox();
    const daemon = new FakeDaemon({ autoAck: false, responseDelayMs: 1 });
    const client = new WsClient({
      url: "ws://127.0.0.1:7331/ws?token=abc",
      hello: HELLO,
      outbox,
      createSocket: daemon.createSocket,
      flushIntervalMs: 10_000,
      flushBatchSize: 1000,
      minBackoffMs: 5,
      maxBackoffMs: 20,
    });

    client.startSession(SESSION);
    await sleep(10);

    client.enqueue(longTask(1));
    client.enqueue(longTask(2));
    await client.flush();
    expect(daemon.received).toHaveLength(1); // los dos van en el mismo lote

    daemon.down();
    await sleep(10);
    expect(client.getStatus()).not.toBe("connected");

    client.enqueue(longTask(3));
    await client.flush(); // se escribe en outbox aunque no haya conexión

    daemon.up();
    await sleep(100); // que el backoff reconecte

    expect(client.getStatus()).toBe("connected");
    expect(daemon.allEvents()).toEqual([longTask(1), longTask(2), longTask(3)]);

    // autoAck sigue false a propósito (probamos el replay, no el ack): ackeamos a
    // mano los lotes que reconstruyó el replay y verificamos que el outbox quede vacío.
    const pending = await outbox.pending();
    for (const batch of pending) await outbox.ack(batch.seq);
    expect(await outbox.pending()).toEqual([]);
  });

  it("sendBinary no manda nada (ni explota) sin conexión", () => {
    const daemon = new FakeDaemon();
    daemon.down();
    const client = new WsClient({
      url: "ws://127.0.0.1:7331/ws?token=abc",
      hello: HELLO,
      outbox: freshOutbox(),
      createSocket: daemon.createSocket,
    });
    expect(() => client.sendBinary(new ArrayBuffer(4))).not.toThrow();
  });

  it("capture.request dispara el callback, y sendFrame manda el frame pedido", async () => {
    const daemon = new FakeDaemon({ responseDelayMs: 1 });
    const captured: Array<{ tab: number; tTarget: number }> = [];
    const client = new WsClient({
      url: "ws://127.0.0.1:7331/ws?token=abc",
      hello: HELLO,
      outbox: freshOutbox(),
      createSocket: daemon.createSocket,
      onCaptureRequest: (tab, tTarget) => captured.push({ tab, tTarget }),
    });
    client.startSession(SESSION);
    await sleep(10);

    const socket = [...daemon.sockets][0];
    socket?.triggerMessage({ v: 1, type: "capture.request", tab: 7, t_target: 12345 });

    expect(captured).toEqual([{ tab: 7, tTarget: 12345 }]);

    client.sendFrame(12345, 7, "ZmFrZS1qcGVn");
    const lastRaw = socket?.sentRaw.at(-1);
    expect(lastRaw && JSON.parse(lastRaw)).toEqual({
      v: 1,
      type: "frame",
      t: 12345,
      tab: 7,
      jpeg_b64: "ZmFrZS1qcGVn",
    });
  });
});

describe("WsClient — handshake y backoff (reloj falso, sin tocar el outbox)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("hace hello -> session.start apenas conecta", async () => {
    const daemon = new FakeDaemon();
    const client = new WsClient({
      url: "ws://127.0.0.1:7331/ws?token=abc",
      hello: HELLO,
      outbox: freshOutbox(),
      createSocket: daemon.createSocket,
    });

    client.startSession(SESSION);
    await vi.advanceTimersByTimeAsync(50);

    expect(daemon.helloCount).toBe(1);
    expect(daemon.sessionStartCount).toBe(1);
    expect(client.getStatus()).toBe("connected");
  });

  it("reconecta con backoff 250ms -> 500 -> 1000 -> ... -> tope 8000ms", async () => {
    const daemon = new FakeDaemon({ autoAck: false });
    daemon.down();
    const attempts: number[] = [];
    const realCreate = daemon.createSocket;
    const client = new WsClient({
      url: "ws://127.0.0.1:7331/ws?token=abc",
      hello: HELLO,
      outbox: freshOutbox(),
      createSocket: (url) => {
        attempts.push(Date.now());
        return realCreate(url);
      },
      minBackoffMs: 250,
      maxBackoffMs: 8000,
    });

    client.startSession(SESSION);
    // 1er intento a t=0, falla ~5ms después (connection refused) -> reintento a 250ms
    await vi.advanceTimersByTimeAsync(300);
    // 2do intento falla -> reintento a 500ms más tarde (t≈550)
    await vi.advanceTimersByTimeAsync(600);
    // 3er intento falla -> reintento a 1000ms más tarde
    await vi.advanceTimersByTimeAsync(1100);

    expect(attempts.length).toBeGreaterThanOrEqual(4);
    const gaps = attempts.slice(1).map((t, i) => t - (attempts[i] ?? 0));
    expect(gaps[0]).toBeGreaterThanOrEqual(240);
    expect(gaps[0]).toBeLessThan(260);
    expect(gaps[1]).toBeGreaterThanOrEqual(490);
    expect(gaps[1]).toBeLessThan(520);
  });
});
