import {
  isPreloadModelMessage,
  isProcessSessionMessage,
  isStartCaptureMessage,
  isStopCaptureMessage,
  type OffscreenInboundMessage,
  type OffscreenOutboundMessage,
} from "./lib/messages.js";
import { AudioCapture, type AudioCaptureDeps } from "./lib/audio-capture.js";
import { PcmStore } from "./lib/pcm-store.js";
import { processLocalSession, readFramesFromRing, type LocalProcessorDeps } from "./lib/local-processor.js";
import { LocalStore } from "../../shared/local/store.js";

export interface StartOffscreenOptions {
  deps?: AudioCaptureDeps;
  /** Inyectable para tests: por defecto usa `chrome.runtime`. */
  runtime?: typeof chrome.runtime;
  /** Motor local (whisper + qua-wasm). Por defecto se importa a demanda: es pesado y
   * los tests de captura no lo necesitan. */
  processor?: () => Promise<Omit<LocalProcessorDeps, "onModelState">>;
}

export type Teardown = () => void;

async function defaultProcessor(): Promise<Omit<LocalProcessorDeps, "onModelState">> {
  const engine = await import("../../shared/local/engine.js");
  return {
    store: new LocalStore(),
    loadWasm: engine.loadQuaWasm,
    transcribe: engine.transcribe,
    readFrames: (from, to) => readFramesFromRing(from, to),
  };
}

/**
 * Offscreen doc del modo local (§5.4 + D-L1-01). Captura el micrófono como siempre,
 * pero en vez de mandar los frames al SW para el WebSocket los guarda acá
 * (`PcmStore`): el audio nunca sale de este documento. Al fin de la sesión el SW
 * manda `qua:process-session` y el procesamiento entero corre acá, que es el único
 * contexto de la extensión con WebGPU y sin el límite de vida del service worker.
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

  const pcm = new PcmStore();
  // Nivel del micrófono para la onda del popup y de la pastilla: RMS de cada frame de
  // 20 ms, y cada 100 ms se mandan los últimos 5 (las 5 barras de cada lado del anillo).
  let recent: number[] = [];
  let lastLevelSent = 0;
  const onLevel = (bytes: Uint8Array) => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let sum = 0;
    const n = (bytes.byteLength - 13) >> 1;
    for (let i = 0; i < n; i++) { const v = view.getInt16(13 + i * 2, true) / 32768; sum += v * v; }
    recent.push(Math.min(1, Math.sqrt(sum / Math.max(1, n)) * 7));
    if (recent.length > 5) recent = recent.slice(-5);
    const now = Date.now();
    if (now - lastLevelSent >= 100 && recent.length === 5) { lastLevelSent = now; send({ type: "qua:level", levels: recent } as never); }
  };
  const capture = new AudioCapture(opts.deps ?? {}, {
    onFrame: (bytes) => { pcm.push(bytes); onLevel(bytes); },
    onError: (message) => send({ type: "qua:capture-error", message }),
    onStarted: () => send({ type: "qua:capture-started" }),
  });

  let startMsgWall = 0;
  let engine: Promise<Omit<LocalProcessorDeps, "onModelState">> | undefined;
  const getEngine = () => (engine ??= (opts.processor ?? defaultProcessor)());
  const onModelState = (state: unknown) => send({ type: "qua:model-state", state });

  async function preload(): Promise<void> {
    const loaded = await getEngine();
    void loaded.loadWasm();
    const { loadAsr } = await import("../../shared/local/engine.js");
    await loadAsr(onModelState);
  }

  const listener = (message: unknown) => {
    const msg = message as OffscreenInboundMessage;
    if (isStartCaptureMessage(msg)) {
      pcm.clear();
      startMsgWall = Date.now();
      void capture.start({ t0Wall: msg.t0Wall, startSeq: msg.startSeq });
    } else if (isStopCaptureMessage(msg)) {
      capture.stop();
    } else if (isPreloadModelMessage(msg)) {
      // Mientras el usuario graba, whisper se baja/carga en paralelo: al detener, casi
      // siempre ya está listo. Un fallo acá no corta nada — se reintenta al procesar.
      if (!opts.processor) void preload().catch(() => undefined);
    } else if ((msg as { type?: string }).type === "qua:copy") {
      // Portapapeles desde la notificación: el SW no tiene documento (reason CLIPBOARD).
      const ta = document.createElement("textarea");
      ta.value = (msg as unknown as { text: string }).text;
      document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
      send({ type: "qua:copied" } as never);
    } else if (isProcessSessionMessage(msg)) {
      capture.stop();
      const audio = pcm.pcm();
      const stats = { ...pcm.stats, ...capture.timings, startMsgWall, stopWall: Date.now() };
      void getEngine()
        .then((deps) =>
          processLocalSession({ ...deps, onModelState }, msg.sessionId, audio, msg.tStop, msg.endedAt, stats),
        )
        .then(
          () => send({ type: "qua:process-done", sessionId: msg.sessionId, ok: true }),
          (err: unknown) => send({ type: "qua:process-done", sessionId: msg.sessionId, ok: false, error: String(err) }),
        )
        .finally(() => pcm.clear());
    }
  };

  runtime.onMessage.addListener(listener);
  return () => {
    runtime.onMessage.removeListener(listener);
    capture.stop();
  };
}
