import {
  isStatusPushMessage,
  isTranscriptPartialPushMessage,
  type PopupPushMessage,
  type PopupStatus,
} from "./messages.js";
import type { Utterance } from "@qua/protocol";

export type Unsubscribe = () => void;

/** Estado por defecto mientras no hay respuesta del service worker (ej. recién abierto el popup). */
export const IDLE_STATUS: PopupStatus = { state: "idle", startedAtWall: null, eventsCount: 0 };

/**
 * Wrapper de `chrome.runtime` para el popup (§04, §5.3). Nunca tira: si el
 * service worker no responde (recién instalado, contexto invalidado), las
 * promesas resuelven a un valor por defecto en vez de rechazar — el popup no
 * debería romperse por eso.
 */
export class StatusClient {
  private readonly runtime: typeof chrome.runtime | undefined;

  constructor(runtime?: typeof chrome.runtime) {
    this.runtime = runtime ?? (typeof chrome !== "undefined" ? chrome.runtime : undefined);
  }

  async getStatus(): Promise<PopupStatus> {
    const response = await this.send({ type: "qua:get-status" });
    return isRecord(response) ? { ...IDLE_STATUS, ...response } : IDLE_STATUS;
  }

  start(): void {
    void this.send({ type: "qua:start-session" });
  }

  stop(): void {
    void this.send({ type: "qua:stop-session" });
  }

  mark(): void {
    void this.send({ type: "qua:trigger-mark" });
  }

  /** Escucha pushes de estado en vivo mientras el popup esté abierto. */
  onStatus(cb: (status: PopupStatus) => void): Unsubscribe {
    return this.onPush((msg) => {
      if (isStatusPushMessage(msg)) cb(msg.status);
    });
  }

  /** Escucha `transcript.partial` relayado en vivo (§04, para el transcript del popup). */
  onTranscript(cb: (utterance: Utterance) => void): Unsubscribe {
    return this.onPush((msg) => {
      if (isTranscriptPartialPushMessage(msg)) cb(msg.utterance);
    });
  }

  private onPush(cb: (msg: PopupPushMessage) => void): Unsubscribe {
    if (!this.runtime?.onMessage) return () => {};
    const listener = (message: unknown) => cb(message as PopupPushMessage);
    this.runtime.onMessage.addListener(listener);
    return () => this.runtime!.onMessage.removeListener(listener);
  }

  private async send(message: unknown): Promise<unknown> {
    if (!this.runtime?.sendMessage) return undefined;
    try {
      return await this.runtime.sendMessage(message);
    } catch {
      // Sin service worker del otro lado (aún no arrancó, o se reciclò) — se ignora.
      return undefined;
    }
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object";
}
