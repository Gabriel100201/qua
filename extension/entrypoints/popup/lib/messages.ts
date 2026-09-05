import type { Utterance } from "@qua/protocol";

/**
 * Contrato interno popup ↔ service worker. El popup nunca ve el WS ni el
 * offscreen doc directamente (§02 arquitectura) — todo pasa por el service
 * worker (A2, en curso, ver `docs/DECISIONS.md` D-11).
 */

/** Subconjunto observable de la FSM de §5.3 (`idle → starting → recording → stopping → idle`). */
export const POPUP_SESSION_STATES = ["idle", "starting", "recording", "stopping"] as const;
export type PopupSessionState = (typeof POPUP_SESSION_STATES)[number];

export interface PopupStatus {
  state: PopupSessionState;
  /** epoch ms (mismo reloj que `nowMs`, §02) en que arrancó la grabación en curso, o `null` si no hay ninguna. */
  startedAtWall: number | null;
  /** Contador de eventos de sesión ya confirmados (`ack`, §04) — no incluye audio. */
  eventsCount: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Popup → service worker
// ─────────────────────────────────────────────────────────────────────────────

export interface GetStatusRequest {
  type: "qua:get-status";
}

export interface StartSessionRequest {
  type: "qua:start-session";
}

export interface StopSessionRequest {
  type: "qua:stop-session";
}

/** El popup no construye el `Event` `mark` — eso es del content script (D-09 de A1). Solo pide que se dispare. */
export interface TriggerMarkRequest {
  type: "qua:trigger-mark";
}

export type PopupRequest = GetStatusRequest | StartSessionRequest | StopSessionRequest | TriggerMarkRequest;

// ─────────────────────────────────────────────────────────────────────────────
// Service worker → popup (push, mientras el popup esté abierto)
// ─────────────────────────────────────────────────────────────────────────────

export interface StatusPushMessage {
  type: "qua:status";
  status: PopupStatus;
}

/** Relay de `transcript.partial` (§04) tal cual llega del daemon. */
export interface TranscriptPartialPushMessage {
  type: "qua:transcript-partial";
  utterance: Utterance;
}

export type PopupPushMessage = StatusPushMessage | TranscriptPartialPushMessage;

export function isStatusPushMessage(msg: unknown): msg is StatusPushMessage {
  return isRecord(msg) && msg.type === "qua:status" && isRecord(msg.status);
}

export function isTranscriptPartialPushMessage(msg: unknown): msg is TranscriptPartialPushMessage {
  return isRecord(msg) && msg.type === "qua:transcript-partial" && isRecord(msg.utterance);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object";
}
