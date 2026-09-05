import { z } from "zod";
import { PROTOCOL_VERSION } from "./constants.js";
import { EventSchema } from "./event.js";
import { EnvInfoSchema } from "./session.js";
import { UtteranceSchema } from "./utterance.js";

/** Todo mensaje de texto del protocolo lleva `v` (§04). */
const v = { v: z.literal(PROTOCOL_VERSION) };

// ─────────────────────────────────────────────────────────────────────────────
// Cliente → servidor
// ─────────────────────────────────────────────────────────────────────────────

/** Primer mensaje tras conectar. El daemon responde `hello.ok`. */
export const HelloMessageSchema = z
  .object({
    ...v,
    type: z.literal("hello"),
    ext_version: z.string(),
    chrome: z.string(),
    platform: z.string(),
  })
  .meta({ id: "HelloMessage" });

/** Cabecera de sesión. Fija `t0_wall`, el origen del reloj único (§02). */
export const SessionStartMessageSchema = z
  .object({
    ...v,
    type: z.literal("session.start"),
    session: z.object({
      t0_wall: z.int(),
      base_url: z.string(),
      env: EnvInfoSchema,
    }),
  })
  .meta({ id: "SessionStartMessage" });

/**
 * Lote de eventos. Flush cada 500 ms o cada 50 eventos (§04).
 *
 * `seq` es monótono creciente por sesión y es lo que el outbox usa para el replay:
 * el cliente borra de IndexedDB solo al recibir un `ack` con seq ≥ el suyo.
 */
export const EventsMessageSchema = z
  .object({
    ...v,
    type: z.literal("events"),
    seq: z.int().nonnegative(),
    items: z.array(EventSchema),
  })
  .meta({ id: "EventsMessage" });

/** Marcador de precisión. Fuerza flush inmediato. */
export const MarkMessageSchema = z
  .object({
    ...v,
    type: z.literal("mark"),
    t: z.int(),
  })
  .meta({ id: "MarkMessage" });

/** Respuesta a `capture.request`: el frame del ring más cercano a `t_target`. */
export const FrameMessageSchema = z
  .object({
    ...v,
    type: z.literal("frame"),
    t: z.int(),
    tab: z.int(),
    /** JPEG q60, ancho 1280, con los nodos redactados ya tapados (§12). Base64 sin prefijo data:. */
    jpeg_b64: z.string(),
  })
  .meta({ id: "FrameMessage" });

/** Fin de sesión. El daemon pasa a `processing`. */
export const SessionStopMessageSchema = z
  .object({
    ...v,
    type: z.literal("session.stop"),
    t: z.int(),
  })
  .meta({ id: "SessionStopMessage" });

/** Keepalive. No tiene respuesta propia: ver `docs/DECISIONS.md` (D-03). */
export const PingMessageSchema = z
  .object({
    ...v,
    type: z.literal("ping"),
  })
  .meta({ id: "PingMessage" });

export const ClientMessageSchema = z
  .discriminatedUnion("type", [
    HelloMessageSchema,
    SessionStartMessageSchema,
    EventsMessageSchema,
    MarkMessageSchema,
    FrameMessageSchema,
    SessionStopMessageSchema,
    PingMessageSchema,
  ])
  .meta({ id: "ClientMessage", title: "ClientMessage" });

export type ClientMessage = z.infer<typeof ClientMessageSchema>;
export type HelloMessage = z.infer<typeof HelloMessageSchema>;
export type SessionStartMessage = z.infer<typeof SessionStartMessageSchema>;
export type EventsMessage = z.infer<typeof EventsMessageSchema>;
export type MarkMessage = z.infer<typeof MarkMessageSchema>;
export type FrameMessage = z.infer<typeof FrameMessageSchema>;
export type SessionStopMessage = z.infer<typeof SessionStopMessageSchema>;
export type PingMessage = z.infer<typeof PingMessageSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Servidor → cliente
// ─────────────────────────────────────────────────────────────────────────────

/** Handshake aceptado. `session_dir` es absoluto: `~/.qua/sessions/<id>/`. */
export const HelloOkMessageSchema = z
  .object({
    ...v,
    type: z.literal("hello.ok"),
    daemon_version: z.string(),
    session_dir: z.string(),
  })
  .meta({ id: "HelloOkMessage" });

/** Confirma que todo lote con seq ≤ este está en `raw/events.ndjson`. */
export const AckMessageSchema = z
  .object({
    ...v,
    type: z.literal("ack"),
    seq: z.int().nonnegative(),
  })
  .meta({ id: "AckMessage" });

/** Transcripción en vivo para el popup. No es el resultado final. */
export const TranscriptPartialMessageSchema = z
  .object({
    ...v,
    type: z.literal("transcript.partial"),
    utterance: UtteranceSchema,
  })
  .meta({ id: "TranscriptPartialMessage" });

/** Pedido retroactivo de screenshot al ring de la extensión (§5.3, §07 paso 9). */
export const CaptureRequestMessageSchema = z
  .object({
    ...v,
    type: z.literal("capture.request"),
    tab: z.int(),
    t_target: z.int(),
  })
  .meta({ id: "CaptureRequestMessage" });

/** El render terminó. `report_path` es absoluto. */
export const SessionDoneMessageSchema = z
  .object({
    ...v,
    type: z.literal("session.done"),
    report_path: z.string(),
    issues: z.int().nonnegative(),
  })
  .meta({ id: "SessionDoneMessage" });

/** Acciones que `session.control` puede ordenarle al cliente. */
export const SESSION_CONTROL_ACTIONS = ["start", "stop", "mark"] as const;
export type SessionControlAction = (typeof SESSION_CONTROL_ACTIONS)[number];

/**
 * Orden del hotkey global (⌘⇧R / ⌘⇧E) de la app Tauri, reenviada por el daemon al
 * cliente WS conectado (§09, `docs/DECISIONS.md` D-C1-01). Es el único mensaje
 * servidor→cliente que existe para que un proceso externo controle una sesión ya
 * abierta en el navegador — antes de esto, §04 solo tenía cliente→servidor para
 * `session.start`/`session.stop`/`mark`.
 */
export const SessionControlMessageSchema = z
  .object({
    ...v,
    type: z.literal("session.control"),
    action: z.enum(SESSION_CONTROL_ACTIONS),
    /** Wall-clock ms de cuándo el daemon despachó la orden — no es `t` de sesión. */
    t: z.int(),
  })
  .meta({ id: "SessionControlMessage" });

/** Códigos de error conocidos. `code` acepta otros: ver `docs/DECISIONS.md` (D-04). */
export const ERROR_CODES = {
  /** Token ausente, vencido o desconocido. */
  UNAUTHORIZED: "unauthorized",
  /** El header `Origin` no está en la allowlist. */
  ORIGIN_REJECTED: "origin_rejected",
  /** El mensaje no valida contra el esquema. */
  BAD_MESSAGE: "bad_message",
  /** Llegó un `events`/`mark`/`frame` sin `session.start` previo. */
  NO_SESSION: "no_session",
  /** `v` distinto de PROTOCOL_VERSION. */
  VERSION_MISMATCH: "version_mismatch",
  /** El daemon no pudo escribir a disco. */
  STORAGE: "storage",
  /** Falla del pipeline de ASR. La sesión sigue grabando. */
  ASR: "asr",
  /** `POST /control` sin ningún cliente WS conectado para reenviarle la orden. */
  NO_CLIENT: "no_client",
  /** Cualquier otra. */
  INTERNAL: "internal",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export const ErrorMessageSchema = z
  .object({
    ...v,
    type: z.literal("error"),
    code: z.string(),
    message: z.string(),
  })
  .meta({ id: "ErrorMessage" });

export const ServerMessageSchema = z
  .discriminatedUnion("type", [
    HelloOkMessageSchema,
    AckMessageSchema,
    TranscriptPartialMessageSchema,
    CaptureRequestMessageSchema,
    SessionDoneMessageSchema,
    SessionControlMessageSchema,
    ErrorMessageSchema,
  ])
  .meta({ id: "ServerMessage", title: "ServerMessage" });

export type ServerMessage = z.infer<typeof ServerMessageSchema>;
export type HelloOkMessage = z.infer<typeof HelloOkMessageSchema>;
export type AckMessage = z.infer<typeof AckMessageSchema>;
export type TranscriptPartialMessage = z.infer<typeof TranscriptPartialMessageSchema>;
export type CaptureRequestMessage = z.infer<typeof CaptureRequestMessageSchema>;
export type SessionDoneMessage = z.infer<typeof SessionDoneMessageSchema>;
export type SessionControlMessage = z.infer<typeof SessionControlMessageSchema>;
export type ErrorMessage = z.infer<typeof ErrorMessageSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Pairing (§04) — HTTP, no WS
// ─────────────────────────────────────────────────────────────────────────────

/** `POST /pair` con `Origin: chrome-extension://<id>`. */
export const PairRequestSchema = z
  .object({
    code: z.string().regex(/^\d{6}$/),
  })
  .meta({ id: "PairRequest" });

export type PairRequest = z.infer<typeof PairRequestSchema>;

/** Respuesta de `POST /pair`. El token son 32 bytes en hex. */
export const PairResponseSchema = z
  .object({
    token: z.string().regex(/^[0-9a-f]{64}$/),
    daemon_version: z.string(),
  })
  .meta({ id: "PairResponse" });

export type PairResponse = z.infer<typeof PairResponseSchema>;

/** Respuesta de `GET /health` (§09). */
export const HealthResponseSchema = z
  .object({
    ok: z.boolean(),
    daemon_version: z.string(),
    uptime_ms: z.int().nonnegative(),
    /** Id de la sesión en curso, o `null` si está idle. */
    session: z.string().nullable(),
    /** El modelo de whisper está descargado y cargado. */
    model_ready: z.boolean(),
  })
  .meta({ id: "HealthResponse" });

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
