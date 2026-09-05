import {
  isStatusPushMessage,
  isTranscriptPartialPushMessage,
  type PopupPushMessage,
  type PopupStatus,
} from "./messages.js";
import type { Utterance } from "@qua/protocol";

export type Unsubscribe = () => void;

/** Estado por defecto mientras no hay respuesta del service worker (ej. recién abierto el popup). */
export const IDLE_STATUS: PopupStatus = { state: "idle", startedAtWall: null, eventsCount: 0, lastError: null };

/**
 * Resultado de un comando (`start`/`stop`/`mark`): `ok:false` trae el motivo real
 * que devolvió el service worker — nunca se descarta en silencio (D-U2-01,
 * docs/DECISIONS.md: EL PECADO ORIGINAL de este pase era exactamente este
 * `catch { return undefined }`, que se comía el `{ok:false,error}` de
 * `background/index.ts` y dejaba al usuario mirando un contador en cero sin ningún
 * síntoma de qué había fallado).
 */
export type CommandResult = { ok: true } | { ok: false; error: string };

/** Forma real de la respuesta de `qua:get-status` (`background/internal-messages.ts`,
 * `StatusResponse`). Duck-typed a propósito: popup y background no comparten tipos
 * (D-G1-03) — solo se verifica en runtime, con tests de cada lado. */
interface BackgroundStatusResponse {
  phase: PopupStatus["state"];
  wsStatus?: "disconnected" | "connecting" | "connected";
  paired?: boolean;
  /** Opcionales para no romper si un service worker viejo (recién actualizado,
   * todavía no reciclado) responde sin estos campos (D-U3-01). */
  startedAtWall?: number | null;
  eventsCount?: number;
}

function isBackgroundStatusResponse(v: unknown): v is BackgroundStatusResponse {
  return isRecord(v) && typeof v.phase === "string";
}

function isCommandResponse(v: unknown): v is { ok: boolean; error?: string } {
  return isRecord(v) && typeof v.ok === "boolean";
}

/**
 * Wrapper de `chrome.runtime` para el popup (§04, §5.3). A diferencia de antes,
 * nunca se traga un fallo: `getStatus()` devuelve `lastError` con el motivo, y
 * `start`/`stop`/`mark` devuelven `CommandResult` en vez de ser fire-and-forget.
 */
export class StatusClient {
  private readonly runtime: typeof chrome.runtime | undefined;

  constructor(runtime?: typeof chrome.runtime) {
    this.runtime = runtime ?? (typeof chrome !== "undefined" ? chrome.runtime : undefined);
  }

  async getStatus(): Promise<PopupStatus> {
    const result = await this.send({ type: "qua:get-status" });
    if (!result.ok) return { ...IDLE_STATUS, lastError: result.error };
    if (!isBackgroundStatusResponse(result.value)) {
      return { ...IDLE_STATUS, lastError: "[qua] el service worker devolvió una respuesta de estado inválida." };
    }
    return {
      state: result.value.phase,
      startedAtWall: result.value.startedAtWall ?? IDLE_STATUS.startedAtWall,
      eventsCount: result.value.eventsCount ?? IDLE_STATUS.eventsCount,
      lastError: null,
      paired: result.value.paired,
      wsStatus: result.value.wsStatus,
    };
  }

  async start(): Promise<CommandResult> {
    return this.sendCommand({ type: "qua:start-session" });
  }

  async stop(): Promise<CommandResult> {
    return this.sendCommand({ type: "qua:stop-session" });
  }

  async mark(): Promise<CommandResult> {
    return this.sendCommand({ type: "qua:trigger-mark" });
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

  private async sendCommand(message: unknown): Promise<CommandResult> {
    const result = await this.send(message);
    if (!result.ok) return result;
    if (isCommandResponse(result.value) && result.value.ok === false) {
      return { ok: false, error: result.value.error ?? "[qua] el service worker devolvió un error sin mensaje." };
    }
    return { ok: true };
  }

  private async send(message: unknown): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
    if (!this.runtime?.sendMessage) {
      return { ok: false, error: "[qua] no se pudo hablar con la extensión: chrome.runtime no está disponible." };
    }
    try {
      const value = await this.runtime.sendMessage(message);
      return { ok: true, value };
    } catch (err) {
      // Sin service worker del otro lado (aún no arrancó, o se reciclò) — antes esto
      // se ignoraba en silencio. Ahora es el mensaje que termina en el popup.
      return { ok: false, error: `[qua] el service worker no responde: ${errorMessage(err)}` };
    }
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object";
}
