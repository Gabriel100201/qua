import type { ClientMessage, Event } from "@qua/protocol";
import type { WebSocketLike } from "../ws-client.js";

/**
 * Doble de prueba del daemon `quad` + del `WebSocket` del navegador (§04), pensado
 * para simular caídas de proceso a mitad de sesión sin abrir sockets de verdad.
 * Usar siempre con `vi.useFakeTimers()`: las respuestas del "daemon" llegan por
 * `setTimeout`, así que hace falta `vi.advanceTimersByTimeAsync` para que se
 * entreguen.
 */
export class FakeSocket implements WebSocketLike {
  readyState = 0; // CONNECTING
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  readonly sentRaw: string[] = [];

  constructor(
    public readonly url: string,
    private readonly daemon: FakeDaemon,
  ) {
    daemon.sockets.add(this);
  }

  send(data: string | ArrayBufferLike): void {
    if (typeof data === "string") {
      this.sentRaw.push(data);
      this.daemon.onClientMessage(this, JSON.parse(data) as ClientMessage);
    }
  }

  close(): void {
    this.readyState = 3; // CLOSED
    this.daemon.sockets.delete(this);
  }

  triggerOpen(): void {
    if (this.readyState === 3) return;
    this.readyState = 1; // OPEN
    this.onopen?.();
  }

  triggerMessage(payload: unknown): void {
    if (this.readyState !== 1) return;
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  triggerClose(code = 1006, reason = "daemon down"): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.daemon.sockets.delete(this);
    this.onclose?.({ code, reason });
  }
}

interface ReceivedBatch {
  seq: number;
  items: Event[];
}

/**
 * Servidor falso: acepta handshakes, ackea lotes de eventos, y puede "caerse"
 * (`down()`) — mientras está caído, ninguna conexión nueva llega a abrir, tal como
 * pasaría con `quad` no escuchando en el puerto.
 */
export class FakeDaemon {
  sockets = new Set<FakeSocket>();
  received: ReceivedBatch[] = [];
  helloCount = 0;
  sessionStartCount = 0;
  private isUp = true;
  private readonly responseDelayMs: number;
  private readonly autoAck: boolean;

  constructor(opts: { responseDelayMs?: number; autoAck?: boolean } = {}) {
    this.responseDelayMs = opts.responseDelayMs ?? 5;
    this.autoAck = opts.autoAck ?? true;
  }

  createSocket = (url: string): WebSocketLike => {
    const socket = new FakeSocket(url, this);
    if (this.isUp) {
      setTimeout(() => socket.triggerOpen(), this.responseDelayMs);
    } else {
      setTimeout(() => socket.triggerClose(1006, "connection refused"), this.responseDelayMs);
    }
    return socket;
  };

  onClientMessage(socket: FakeSocket, msg: ClientMessage): void {
    switch (msg.type) {
      case "hello":
        this.helloCount += 1;
        setTimeout(() => {
          socket.triggerMessage({
            v: 1,
            type: "hello.ok",
            daemon_version: "test",
            session_dir: "/tmp/qua-test-session",
          });
        }, this.responseDelayMs);
        break;
      case "session.start":
        this.sessionStartCount += 1;
        break;
      case "events": {
        // Dedup por seq: un replay puede reenviar un lote que ya llegó antes de la
        // caída pero cuyo ack se perdió en el camino.
        if (!this.received.some((b) => b.seq === msg.seq)) {
          this.received.push({ seq: msg.seq, items: msg.items });
        }
        if (this.autoAck) {
          setTimeout(() => {
            socket.triggerMessage({ v: 1, type: "ack", seq: msg.seq });
          }, this.responseDelayMs);
        }
        break;
      }
      default:
        break;
    }
  }

  /** Simula `quad` cayéndose: corta todas las conexiones y rechaza las nuevas. */
  down(): void {
    this.isUp = false;
    for (const socket of [...this.sockets]) socket.triggerClose(1006, "daemon down");
  }

  up(): void {
    this.isUp = true;
  }

  /** Todos los eventos recibidos (de todos los lotes), en el orden en que llegaron
   * los lotes — no necesariamente el de `t`, si hubo reordering de red. */
  allEvents(): Event[] {
    return this.received
      .slice()
      .sort((a, b) => a.seq - b.seq)
      .flatMap((b) => b.items);
  }
}
