import { PROTOCOL_VERSION } from "@qua/protocol";
import type { ClientMessage, EnvInfo, Event, ServerMessage, SessionControlAction } from "@qua/protocol";
import type { Outbox } from "./outbox.js";

/**
 * Subconjunto de la interfaz `WebSocket` del navegador que este módulo necesita.
 * Inyectable para poder testear reconexión y backoff sin abrir sockets reales.
 */
export interface WebSocketLike {
  readyState: number;
  send(data: string | ArrayBufferLike): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export interface SessionStartInfo {
  t0Wall: number;
  baseUrl: string;
  env: EnvInfo;
}

export type WsStatus = "disconnected" | "connecting" | "connected";

export interface WsClientOptions {
  url: string;
  hello: { ext_version: string; chrome: string; platform: string };
  outbox: Outbox;
  now?: () => number;
  createSocket?: (url: string) => WebSocketLike;
  /** §04: backoff exponencial 250 ms → 8 s. */
  minBackoffMs?: number;
  maxBackoffMs?: number;
  /** §04: flush cada 500 ms o cada 50 eventos, lo que ocurra primero. */
  flushIntervalMs?: number;
  flushBatchSize?: number;
  onServerMessage?: (msg: ServerMessage) => void;
  onStatusChange?: (status: WsStatus) => void;
  onCaptureRequest?: (tab: number, tTargetMs: number) => void;
  /** `session.control` (§09, D-C1-01): orden del hotkey global de la app Tauri,
   * reenviada por el daemon. Llega tanto en el canal de control ocioso como en el
   * de una sesión ya arrancada. */
  onSessionControl?: (action: SessionControlAction, t: number) => void;
}

function defaultCreateSocket(url: string): WebSocketLike {
  return new WebSocket(url) as unknown as WebSocketLike;
}

/** Fuerza flush inmediato: `mark` y `console.error` (§04). */
function forcesFlush(event: Event): boolean {
  return event.k === "mark" || (event.k === "console" && event.level === "error");
}

/**
 * Cliente WebSocket del protocolo §04. Dueño de la conexión y del outbox
 * (§5.3: "Transporte: dueño del WebSocket y del outbox en IndexedDB").
 *
 * Garantía: todo evento pasado a `enqueue` queda en IndexedDB antes de que este
 * cliente intente mandarlo, y solo se borra ahí al llegar su `ack`. Una
 * desconexión — de la duración que sea — nunca pierde eventos: se re-envían al
 * reconectar (`replayPending`), en orden de `seq`.
 */
export class WsClient {
  private readonly now: () => number;
  private readonly createSocket: (url: string) => WebSocketLike;
  private readonly minBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly flushIntervalMs: number;
  private readonly flushBatchSize: number;

  private socket: WebSocketLike | undefined;
  private status: WsStatus = "disconnected";
  private buffer: Event[] = [];
  private flushTimer: ReturnType<typeof setInterval> | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private backoffMs: number;
  private session: SessionStartInfo | undefined;
  private stopped = true;

  constructor(private readonly opts: WsClientOptions) {
    this.now = opts.now ?? Date.now;
    this.createSocket = opts.createSocket ?? defaultCreateSocket;
    this.minBackoffMs = opts.minBackoffMs ?? 250;
    this.maxBackoffMs = opts.maxBackoffMs ?? 8000;
    this.flushIntervalMs = opts.flushIntervalMs ?? 500;
    this.flushBatchSize = opts.flushBatchSize ?? 50;
    this.backoffMs = this.minBackoffMs;
  }

  getStatus(): WsStatus {
    return this.status;
  }

  /**
   * Conecta. Con `session`, arranca a batchear de una (§04) — el uso de siempre.
   * Sin `session`, es el canal de control ocioso de D-P1-01: solo hace `hello` y
   * queda escuchando `session.control` hasta que alguien llame `startSession` nuevo
   * (con sesión) o `disconnect()`.
   */
  startSession(session?: SessionStartInfo): void {
    this.session = session;
    this.stopped = false;
    this.backoffMs = this.minBackoffMs;
    this.connect();
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, this.flushIntervalMs);
  }

  /** Encola un evento. Nunca lanza: en el peor caso queda pendiente en el buffer. */
  enqueue(event: Event): void {
    this.buffer.push(event);
    if (forcesFlush(event) || this.buffer.length >= this.flushBatchSize) {
      void this.flush();
    }
  }

  /** Escribe el lote acumulado en el outbox y lo manda si hay conexión. */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const items = this.buffer;
    this.buffer = [];
    const seq = await this.opts.outbox.nextSeq();
    await this.opts.outbox.enqueue(seq, items, this.now());
    this.trySend(seq, items);
  }

  sendMark(t: number): void {
    this.rawSend({ v: PROTOCOL_VERSION, type: "mark", t });
  }

  sendFrame(t: number, tab: number, jpegB64: string): void {
    this.rawSend({ v: PROTOCOL_VERSION, type: "frame", t, tab, jpeg_b64: jpegB64 });
  }

  /** Envía un frame binario de audio tal cual (§04). Se pierde si no hay conexión: el
   * buffer de hasta 30 s vive en el offscreen doc (§5.4/A3), no acá. */
  sendBinary(frame: ArrayBufferLike): void {
    if (this.status === "connected") this.socket?.send(frame);
  }

  /** Fin de sesión: flushea lo que quede, avisa `session.stop` y cierra. */
  async stop(t: number): Promise<void> {
    this.stopped = true;
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    await this.flush();
    this.rawSend({ v: PROTOCOL_VERSION, type: "session.stop", t });
    this.socket?.close();
    this.socket = undefined;
    this.setStatus("disconnected");
  }

  /** Cierra sin el protocolo de fin de sesión — para el canal de control ocioso de
   * D-P1-01, que nunca mandó `session.start` y no tiene nada que avisarle al daemon. */
  disconnect(): void {
    this.stopped = true;
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.close();
    this.socket = undefined;
    this.setStatus("disconnected");
  }

  private connect(): void {
    if (this.stopped) return;
    this.setStatus("connecting");
    const socket = this.createSocket(this.opts.url);
    this.socket = socket;
    socket.onopen = () => this.handleOpen();
    socket.onmessage = (ev) => this.handleMessage(ev.data);
    socket.onclose = () => this.handleClose();
    socket.onerror = () => {
      /* el `close` que sigue dispara el reintento */
    };
  }

  private handleOpen(): void {
    this.rawSend({
      v: PROTOCOL_VERSION,
      type: "hello",
      ext_version: this.opts.hello.ext_version,
      chrome: this.opts.hello.chrome,
      platform: this.opts.hello.platform,
    });
  }

  private handleMessage(raw: string): void {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(raw) as ServerMessage;
    } catch {
      return;
    }

    switch (msg.type) {
      case "hello.ok":
        this.setStatus("connected");
        this.backoffMs = this.minBackoffMs;
        this.onConnected();
        break;
      case "ack":
        void this.opts.outbox.ack(msg.seq);
        break;
      case "capture.request":
        this.opts.onCaptureRequest?.(msg.tab, msg.t_target);
        break;
      case "session.control":
        this.opts.onSessionControl?.(msg.action, msg.t);
        break;
      default:
        break;
    }
    this.opts.onServerMessage?.(msg);
  }

  /**
   * Al confirmar el handshake (primera vez o tras reconectar) hay que volver a
   * mandar `session.start` — la conexión es nueva y el daemon no tiene contexto de
   * sesión propio hasta que se lo decimos otra vez. Ver `docs/DECISIONS.md` (A2):
   * asume que el daemon acepta un `session.start` repetido con el mismo `t0_wall`
   * como el mismo objetivo, no como una sesión nueva.
   */
  private onConnected(): void {
    if (!this.session) return; // canal de control ocioso (D-P1-01): solo `hello`.
    this.rawSend({
      v: PROTOCOL_VERSION,
      type: "session.start",
      session: {
        t0_wall: this.session.t0Wall,
        base_url: this.session.baseUrl,
        env: this.session.env,
      },
    });
    void this.replayPending();
  }

  private async replayPending(): Promise<void> {
    const pending = await this.opts.outbox.pending();
    for (const batch of pending) {
      this.trySend(batch.seq, batch.items);
    }
  }

  private handleClose(): void {
    this.socket = undefined;
    if (this.stopped) {
      this.setStatus("disconnected");
      return;
    }
    this.setStatus("disconnected");
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoffMs);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private trySend(seq: number, items: Event[]): void {
    if (this.status !== "connected") return;
    this.rawSend({ v: PROTOCOL_VERSION, type: "events", seq, items });
  }

  private rawSend(msg: ClientMessage): void {
    if (!this.socket || this.status === "disconnected") return;
    this.socket.send(JSON.stringify(msg));
  }

  private setStatus(status: WsStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.opts.onStatusChange?.(status);
  }
}
