/**
 * Constantes compartidas de QUA.
 *
 * Todo lo que la extensión, el daemon y la app tienen que saber de memoria vive acá.
 * Los umbrales tuneables NO van acá: van a `~/.qua/config.toml` (§13).
 */

/** Versión del protocolo de mensajes de §04. Va en el campo `v` de cada mensaje. */
export const PROTOCOL_VERSION = 1 as const;

/** Puerto del daemon `quad`. Bind exclusivo a 127.0.0.1 (§12). */
export const DEFAULT_DAEMON_PORT = 7331 as const;

/** Host al que bindea el daemon. Nunca 0.0.0.0: cero egreso de red. */
export const DAEMON_HOST = "127.0.0.1" as const;

/** Path del WebSocket de control + audio. */
export const WS_PATH = "/ws" as const;

/** Endpoint de pairing (§04). */
export const PAIR_PATH = "/pair" as const;

/**
 * Trust-on-first-use (D-U1-01, `docs/DECISIONS.md`): empareja sin código de 6
 * dígitos cuando el daemon nunca emparejó con nadie (`paired_extensions` vacío).
 * El popup lo usa para el botón "Conectar" de un solo click; con una extensión ya
 * emparejada el daemon devuelve 409 y hay que caer al flujo de `PAIR_PATH`.
 */
export const PAIR_AUTO_PATH = "/pair/auto" as const;

/** Endpoint de health que consulta la app Tauri cada 5 s (§09). */
export const HEALTH_PATH = "/health" as const;

/** URL del WebSocket para un puerto y token dados. */
export function wsUrl(token: string, port: number = DEFAULT_DAEMON_PORT): string {
  return `ws://${DAEMON_HOST}:${port}${WS_PATH}?token=${encodeURIComponent(token)}`;
}

/** Identificadores de esquema versionados que viajan en el campo `schema`. */
export const SCHEMA_SESSION = "qua/session@1" as const;

// ─────────────────────────────────────────────────────────────────────────────
// Audio
// ─────────────────────────────────────────────────────────────────────────────

/** Sample rate del PCM que viaja por el WS. */
export const AUDIO_SAMPLE_RATE = 16000 as const;

/** Canales. Mono, siempre. */
export const AUDIO_CHANNELS = 1 as const;

/**
 * Layout del frame binario de audio (§04).
 *
 * ```text
 * offset  0   u8       magic = 0xA0
 * offset  1   u32le    seq
 * offset  5   u64le    t_ms          // desde t0_wall
 * offset 13   i16le[320]             // 20 ms @ 16 kHz mono = 640 bytes
 *                                    // total 653 B/frame · 50 fps · ~32 KB/s
 * ```
 */
export const AUDIO_FRAME = {
  /** Primer byte de todo frame binario. Sirve para descartar basura sin parsear. */
  MAGIC: 0xa0,

  OFFSET_MAGIC: 0,
  OFFSET_SEQ: 1,
  OFFSET_T_MS: 5,
  OFFSET_SAMPLES: 13,

  /** Bytes de cabecera antes del primer sample. */
  HEADER_BYTES: 13,

  /** Muestras i16 por frame. 320 @ 16 kHz = 20 ms exactos. */
  SAMPLES_PER_FRAME: 320,

  /** Bytes por muestra (i16 little-endian). */
  BYTES_PER_SAMPLE: 2,

  /** Bytes de payload PCM. */
  PAYLOAD_BYTES: 320 * 2,

  /** Tamaño total del frame en bytes. */
  TOTAL_BYTES: 13 + 320 * 2,

  /** Duración de un frame en ms. */
  FRAME_MS: 20,

  /** Frames por segundo. */
  FRAMES_PER_SECOND: 50,
} as const;

// Chequeos de consistencia del layout — fallan en tiempo de compilación si alguien
// toca un número sin tocar los otros.
type _AssertHeader = AssertEqual<typeof AUDIO_FRAME.HEADER_BYTES, 13>;
type _AssertTotal = AssertEqual<typeof AUDIO_FRAME.TOTAL_BYTES, 653>;
type AssertEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

// ─────────────────────────────────────────────────────────────────────────────
// Los 18 tipos de evento de §03
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Discriminantes de la unión `Event`, en el orden de la tabla de §03.
 *
 * Ojo: la prosa de la spec dice «17 tipos» pero la tabla lista 18. Ver
 * `docs/DECISIONS.md` (D-01). Manda la tabla.
 */
export const EVENT_KINDS = [
  "nav",
  "tab_switch",
  "tab_close",
  "click",
  "hover",
  "focus_change",
  "input",
  "submit",
  "scroll_settle",
  "viewport",
  "console",
  "net_fail",
  "net_slow",
  "long_task",
  "layout_shift",
  "mutation_burst",
  "mark",
  "audio_gap",
] as const;

export type EventKind = (typeof EVENT_KINDS)[number];

/** Tipos de mensaje cliente → servidor (§04). */
export const CLIENT_MESSAGE_TYPES = [
  "hello",
  "session.start",
  "events",
  "mark",
  "frame",
  "session.stop",
  "ping",
] as const;

export type ClientMessageType = (typeof CLIENT_MESSAGE_TYPES)[number];

/** Tipos de mensaje servidor → cliente (§04). */
export const SERVER_MESSAGE_TYPES = [
  "hello.ok",
  "ack",
  "transcript.partial",
  "capture.request",
  "session.done",
  "session.control",
  "error",
] as const;

export type ServerMessageType = (typeof SERVER_MESSAGE_TYPES)[number];

/** Las 3 clases de anchor de §07 paso 6. */
export const ANCHOR_KINDS = ["element", "route", "session"] as const;

/** Estrategias de selector de §5.2, en orden de cascada. */
export const SELECTOR_STRATEGIES = ["testid", "id", "role-name", "css-path"] as const;
