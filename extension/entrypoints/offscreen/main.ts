import {
  isConnectionStateMessage,
  isStartCaptureMessage,
  isStopCaptureMessage,
  type OffscreenInboundMessage,
  type OffscreenOutboundMessage,
} from "./lib/messages.js";
import { AudioCapture, type AudioCaptureDeps } from "./lib/audio-capture.js";

export interface StartOffscreenOptions {
  deps?: AudioCaptureDeps;
  /** Inyectable para tests: por defecto usa `chrome.runtime`. */
  runtime?: typeof chrome.runtime;
}

export type Teardown = () => void;

/**
 * Instala el listener de `chrome.runtime.onMessage` que recibe las órdenes
 * del service worker (§5.4, ver `lib/messages.ts`) y arranca/para
 * `AudioCapture` en consecuencia. Framework-agnóstico a propósito, mismo
 * patrón que `content/main.ts` (A1): el wiring real de WXT (manifest,
 * `chrome.offscreen.createDocument`) es del scaffold compartido, ver
 * `docs/DECISIONS.md` D-11.
 */
export function startQuaOffscreen(opts: StartOffscreenOptions = {}): Teardown {
  const runtime = opts.runtime ?? (typeof chrome !== "undefined" ? chrome.runtime : undefined);
  if (!runtime?.onMessage) return () => {};

  const send = (message: OffscreenOutboundMessage): void => {
    try {
      const maybePromise = runtime.sendMessage(message) as unknown;
      if (maybePromise && typeof (maybePromise as Promise<unknown>).catch === "function") {
        (maybePromise as Promise<unknown>).catch(() => {
          // El service worker puede no estar escuchando todavía — se ignora.
        });
      }
    } catch {
      // Contexto de extensión invalidado — nunca debe tirar hacia acá.
    }
  };

  const capture = new AudioCapture(opts.deps ?? {}, {
    onFrame: (bytes) => send({ type: "qua:audio-frame", bytes }),
    onGap: (duration_ms) => send({ type: "qua:audio-gap", duration_ms }),
    onRecordingChunk: (blob) => send({ type: "qua:recording-chunk", blob }),
    onError: (message) => send({ type: "qua:capture-error", message }),
    onStarted: () => send({ type: "qua:capture-started" }),
  });

  const listener = (message: unknown) => {
    const msg = message as OffscreenInboundMessage;
    if (isStartCaptureMessage(msg)) {
      void capture.start({ t0Wall: msg.t0Wall, startSeq: msg.startSeq });
    } else if (isStopCaptureMessage(msg)) {
      capture.stop();
    } else if (isConnectionStateMessage(msg)) {
      capture.setConnected(msg.connected);
    }
  };

  runtime.onMessage.addListener(listener);
  return () => {
    runtime.onMessage.removeListener(listener);
    capture.stop();
  };
}
