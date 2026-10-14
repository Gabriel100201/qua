/**
 * Contrato interno offscreen doc ↔ service worker (§5.4). No es el protocolo
 * de §04 (eso viaja por WS entre la extensión y el daemon) — son mensajes de
 * `chrome.runtime` entre dos contextos de la propia extensión.
 *
 * El service worker (A2, en curso al escribir esto — ver `docs/DECISIONS.md`
 * D-11) es quien tiene el WebSocket. El offscreen doc nunca abre el WS
 * directamente: junta bytes ya empaquetados con el layout de §04 y se los
 * pasa al service worker, que los manda tal cual por el canal binario.
 */

/** SW → offscreen. Arranca `getUserMedia` + worklet + `MediaRecorder` (§5.4). */
export interface StartCaptureMessage {
  type: "qua:start-capture";
  /** Origen del reloj de audio (§02) — mismo valor que `session.start.t0_wall`. */
  t0Wall: number;
  /** `seq` inicial del primer frame (0 salvo que se esté retomando tras un recover). */
  startSeq?: number;
}

/** SW → offscreen. Suelta el micrófono y detiene el `MediaRecorder`. */
export interface StopCaptureMessage {
  type: "qua:stop-capture";
}

/**
 * SW → offscreen. Refleja si el WS está conectado. Mientras `connected` es
 * `false`, el offscreen doc bufferea frames en memoria (hasta 30 s, §04
 * "Resiliencia") en vez de tirarlos al vacío.
 */
export interface ConnectionStateMessage {
  type: "qua:connection-state";
  connected: boolean;
}

/**
 * SW → offscreen (modo local, D-L1-01). Fin de sesión: el offscreen suelta el mic y
 * procesa ahí mismo (VAD + whisper + correlador + render), con el audio que ya tiene
 * en memoria y los eventos y capturas que el SW dejó en IndexedDB.
 */
export interface ProcessSessionMessage {
  type: "qua:process-session";
  sessionId: string;
  tStop: number;
  endedAt: string;
}

/** SW → offscreen. Empezar a bajar/cargar whisper sin esperar al fin de la sesión. */
export interface PreloadModelMessage {
  type: "qua:preload-model";
}

export type OffscreenInboundMessage =
  | StartCaptureMessage
  | StopCaptureMessage
  | ConnectionStateMessage
  | ProcessSessionMessage
  | PreloadModelMessage;

/** Offscreen → SW. Un frame binario ya codificado con el layout de §04, listo para el WS. */
export interface AudioFrameMessage {
  type: "qua:audio-frame";
  bytes: Uint8Array;
}

/**
 * Offscreen → SW. El buffer de 30 s se llenó durante una desconexión y hubo
 * que descartar audio viejo (§04 "Resiliencia"). El SW arma el `Event`
 * `audio_gap` — el offscreen doc no construye `Event`s de §03, esa
 * responsabilidad es del content script / service worker (ver D-11).
 */
export interface AudioGapMessage {
  type: "qua:audio-gap";
  duration_ms: number;
}

/** Offscreen → SW. La captura arrancó: mic concedido, worklet corriendo. */
export interface CaptureStartedMessage {
  type: "qua:capture-started";
}

/** Offscreen → SW. `getUserMedia` u otro paso de arranque falló. */
export interface CaptureErrorMessage {
  type: "qua:capture-error";
  message: string;
}

/**
 * Offscreen → SW. El archivo de respaldo (`MediaRecorder` opus, §5.4) cerró
 * un chunk. Ver D-12: todavía no hay un mensaje de §04 para subir este
 * archivo al daemon, así que por ahora solo se entrega al SW para que decida
 * qué hacer (guardarlo, exponerlo a `qua doctor`, etc.).
 */
export interface RecordingChunkMessage {
  type: "qua:recording-chunk";
  blob: Blob;
}

/** Offscreen → SW. Terminó de procesar (bien o mal); el SW ya puede cerrar el documento. */
export interface ProcessDoneMessage {
  type: "qua:process-done";
  sessionId: string;
  ok: boolean;
  error?: string;
}

/** Offscreen → SW. Estado del modelo de whisper — el offscreen no tiene `chrome.storage`. */
export interface ModelStateMessage {
  type: "qua:model-state";
  state: unknown;
}

export type OffscreenOutboundMessage =
  | ProcessDoneMessage
  | ModelStateMessage
  | AudioFrameMessage
  | AudioGapMessage
  | CaptureStartedMessage
  | CaptureErrorMessage
  | RecordingChunkMessage;

export function isStartCaptureMessage(msg: unknown): msg is StartCaptureMessage {
  return isRecord(msg) && msg.type === "qua:start-capture" && typeof msg.t0Wall === "number";
}

export function isStopCaptureMessage(msg: unknown): msg is StopCaptureMessage {
  return isRecord(msg) && msg.type === "qua:stop-capture";
}

export function isConnectionStateMessage(msg: unknown): msg is ConnectionStateMessage {
  return isRecord(msg) && msg.type === "qua:connection-state" && typeof msg.connected === "boolean";
}

export function isProcessSessionMessage(msg: unknown): msg is ProcessSessionMessage {
  return isRecord(msg) && msg.type === "qua:process-session" && typeof msg.sessionId === "string";
}

export function isPreloadModelMessage(msg: unknown): msg is PreloadModelMessage {
  return isRecord(msg) && msg.type === "qua:preload-model";
}

export function isProcessDoneMessage(msg: unknown): msg is ProcessDoneMessage {
  return isRecord(msg) && msg.type === "qua:process-done" && typeof msg.sessionId === "string";
}

export function isModelStateMessage(msg: unknown): msg is ModelStateMessage {
  return isRecord(msg) && msg.type === "qua:model-state";
}

/**
 * Guardas del lado service worker (§5.4, G1): los mensajes que el offscreen doc
 * manda hacia arriba. Simétricas a las de arriba, que son las que el offscreen doc
 * usa para validar lo que le llega del service worker.
 *
 * `msg.bytes` NO llega como `Uint8Array` del otro lado: `chrome.runtime.sendMessage`
 * no preserva typed arrays (los serializa como objeto plano `{0: n, 1: n, ...}`,
 * sin `Array.isArray` ni `.length` — comprobado en vivo con una sesión real, ver
 * D-G1-08 en `docs/DECISIONS.md`). Por eso acá solo se valida `type`, y
 * `toAudioFrameBytes` reconstruye el `Uint8Array` de verdad en el punto de uso.
 */
export function isAudioFrameMessage(msg: unknown): msg is AudioFrameMessage {
  return isRecord(msg) && msg.type === "qua:audio-frame" && !!msg.bytes && typeof msg.bytes === "object";
}

/** Reconstruye el `Uint8Array` de un `AudioFrameMessage` ya deserializado — ver la
 * guarda de arriba para por qué no llega como `Uint8Array` de entrada. */
export function toAudioFrameBytes(msg: AudioFrameMessage): Uint8Array {
  if (msg.bytes instanceof Uint8Array) return msg.bytes;
  return Uint8Array.from(Object.values(msg.bytes as unknown as Record<string, number>));
}

export function isAudioGapMessage(msg: unknown): msg is AudioGapMessage {
  return isRecord(msg) && msg.type === "qua:audio-gap" && typeof msg.duration_ms === "number";
}

export function isCaptureStartedMessage(msg: unknown): msg is CaptureStartedMessage {
  return isRecord(msg) && msg.type === "qua:capture-started";
}

export function isCaptureErrorMessage(msg: unknown): msg is CaptureErrorMessage {
  return isRecord(msg) && msg.type === "qua:capture-error" && typeof msg.message === "string";
}

export function isRecordingChunkMessage(msg: unknown): msg is RecordingChunkMessage {
  return isRecord(msg) && msg.type === "qua:recording-chunk";
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object";
}
