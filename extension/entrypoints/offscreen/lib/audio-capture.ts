import { AUDIO_SAMPLE_RATE } from "@qua/protocol";
import { GapBuffer } from "./gap-buffer.js";
import { nowMs } from "./clock.js";

/**
 * Solo para los E2E que reproducen una grabación ya procesada como micrófono falso
 * (`WXT_QUA_RAW_MIC=1`, ver e2e/local.e2e.mjs): pasarla otra vez por supresión de
 * ruido y ganancia automática borra tramos de voz enteros (medido en D-L1-02: 15,5 % de
 * diferencia contra 1,0 %). Un micrófono real pasa una sola vez, igual que con `quad`.
 */
const RAW_MIC = import.meta.env?.WXT_QUA_RAW_MIC === "1";

/** Constraints exactas de §5.4 — no tocar sin actualizar la spec. */
export const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    channelCount: 1,
    echoCancellation: false,
    noiseSuppression: !RAW_MIC,
    autoGainControl: !RAW_MIC,
  },
};

/** MIME del archivo de respaldo (§5.4): "MediaRecorder(...) en paralelo para el archivo". */
export const RECORDER_MIME_TYPE = "audio/webm;codecs=opus";

/** Cada cuánto el `MediaRecorder` cierra un chunk vía `ondataavailable`. */
const RECORDER_TIMESLICE_MS = 1000;

/** Nombre con el que se registra el processor en el worklet (§5.4). */
export const PCM_TAP_PROCESSOR_NAME = "pcm-tap";

export interface AudioCaptureDeps {
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  createAudioContext?: () => AudioContext;
  createWorkletNode?: (ctx: AudioContext) => AudioWorkletNode;
  createMediaRecorder?: (stream: MediaStream) => MediaRecorder;
  /** URL del script compilado del worklet (`chrome.runtime.getURL(...)` en producción). */
  workletUrl?: string;
}

export interface AudioCaptureCallbacks {
  /** Un frame binario ya listo para el WS (§04) — o para el `GapBuffer` si está desconectado. */
  onFrame: (bytes: Uint8Array) => void;
  /** Se perdió audio por desborde del buffer de 30 s durante una desconexión (§04). */
  onGap?: (durationMs: number) => void;
  /** Un chunk del archivo de respaldo opus (§5.4). */
  onRecordingChunk?: (blob: Blob) => void;
  onError?: (message: string) => void;
  onStarted?: () => void;
}

export interface StartAudioCaptureOptions {
  /** Origen del reloj de audio (§02, §04) — mismo valor que `session.start.t0_wall`. */
  t0Wall: number;
  startSeq?: number;
}

interface PcmTapFrameMessage {
  type: "qua:pcm-frame";
  bytes: Uint8Array;
}

function isPcmTapFrameMessage(data: unknown): data is PcmTapFrameMessage {
  return !!data && typeof data === "object" && (data as PcmTapFrameMessage).type === "qua:pcm-frame";
}

/**
 * Orquesta §5.4 de punta a punta: `getUserMedia` → `AudioContext` a 16 kHz →
 * `AudioWorkletNode("pcm-tap")` → frames al llamador, más un `MediaRecorder`
 * opus en paralelo para el archivo. Todas las fábricas son inyectables para
 * poder testear sin un navegador real (jsdom no implementa Web Audio).
 *
 * No abre el WebSocket ni sabe de sesiones — eso es del service worker
 * (§5.3, D-11). Esta clase solo entrega bytes y blobs por callback.
 */
export class AudioCapture {
  private readonly deps: AudioCaptureDeps;
  private readonly callbacks: AudioCaptureCallbacks;
  private readonly gapBuffer = new GapBuffer();
  private connected = true;

  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private recorder: MediaRecorder | null = null;

  constructor(deps: AudioCaptureDeps = {}, callbacks: AudioCaptureCallbacks) {
    this.deps = deps;
    this.callbacks = callbacks;
  }

  /**
   * Refleja el estado del WS (§04 "Resiliencia"). Mientras esté en `false`,
   * los frames se acumulan en el `GapBuffer` en vez de salir por `onFrame`.
   * Al volver a `true`, drena el buffer en orden antes de seguir en vivo.
   */
  setConnected(connected: boolean): void {
    this.connected = connected;
    if (connected) {
      for (const frame of this.gapBuffer.drain()) this.callbacks.onFrame(frame);
    }
  }

  /** Cuándo terminó cada paso del arranque (epoch ms), para diagnosticar demoras. */
  timings: Record<string, number> = {};

  async start(opts: StartAudioCaptureOptions): Promise<void> {
    const getUserMedia = this.deps.getUserMedia ?? defaultGetUserMedia;
    this.timings = { startCalled: Date.now() };

    // El micrófono y el worklet no dependen uno del otro: se preparan en paralelo. Medido
    // en D-L1-02, cargar el worklet puede tardar segundos en una máquina cargada, y todo
    // lo que se diga antes de que termine se pierde.
    const worklet = this.prepareWorklet().then(
      () => null,
      (err: unknown) => err,
    );

    try {
      this.stream = await getUserMedia(MIC_CONSTRAINTS);
      this.timings.gotMic = Date.now();
    } catch (err) {
      await worklet;
      this.closeContext();
      this.callbacks.onError?.(`getUserMedia falló: ${errorMessage(err)}`);
      return;
    }

    const workletError = await worklet;
    try {
      if (workletError) throw workletError;
      this.connectWorklet(opts);
    } catch (err) {
      this.releaseMic();
      this.callbacks.onError?.(`AudioWorklet falló: ${errorMessage(err)}`);
      return;
    }

    this.startRecorder();
    this.callbacks.onStarted?.();
  }

  private async prepareWorklet(): Promise<void> {
    const createAudioContext = this.deps.createAudioContext ?? defaultCreateAudioContext;
    const workletUrl = this.deps.workletUrl ?? defaultWorkletUrl();
    this.ctx = createAudioContext();
    this.timings.ctxState = this.ctx.state === "running" ? 1 : 0;
    await this.ctx.audioWorklet.addModule(workletUrl);
    this.timings.workletLoaded = Date.now();
  }

  private connectWorklet(opts: StartAudioCaptureOptions): void {
    const createWorkletNode = this.deps.createWorkletNode ?? defaultCreateWorkletNode;
    const source = this.ctx!.createMediaStreamSource(this.stream!);
    this.node = createWorkletNode(this.ctx!);
    this.node.port.onmessage = (event: MessageEvent) => this.handleWorkletMessage(event);
    // El worklet cuenta muestras, no lee el reloj (ver `pcm-framer.ts`): acá se
    // calcula una sola vez el offset `t_ms` del primer frame respecto de
    // `t0_wall` (§04), con el mismo reloj que usa el content script (§02).
    this.node.port.postMessage({
      type: "qua:pcm-tap-init",
      startTMs: nowMs() - opts.t0Wall,
      startSeq: opts.startSeq ?? 0,
    });
    // No hace falta escuchar el audio: el tap solo lee, nunca se conecta a destination.
    source.connect(this.node);
  }

  private startRecorder(): void {
    const createMediaRecorder = this.deps.createMediaRecorder ?? defaultCreateMediaRecorder;
    try {
      this.recorder = createMediaRecorder(this.stream!);
      this.recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) this.callbacks.onRecordingChunk?.(event.data);
      };
      this.recorder.start(RECORDER_TIMESLICE_MS);
    } catch (err) {
      // "En paralelo" (§5.4): si el archivo de respaldo falla, el PCM en vivo sigue igual.
      this.callbacks.onError?.(`MediaRecorder falló: ${errorMessage(err)}`);
    }
  }

  private handleWorkletMessage(event: MessageEvent): void {
    const data = event.data as unknown;
    if (!isPcmTapFrameMessage(data)) return;

    if (this.connected) {
      this.callbacks.onFrame(data.bytes);
    } else {
      this.gapBuffer.push(data.bytes);
    }
    const droppedMs = this.gapBuffer.takeDroppedMs();
    if (droppedMs > 0) this.callbacks.onGap?.(droppedMs);
  }

  stop(): void {
    if (this.recorder && this.recorder.state !== "inactive") {
      this.recorder.stop();
    }
    this.recorder = null;

    this.node?.disconnect();
    this.node = null;

    this.releaseMic();
    this.closeContext();
  }

  private closeContext(): void {
    void this.ctx?.close().catch(() => {
      // El AudioContext ya puede estar cerrado — no hay nada que hacer.
    });
    this.ctx = null;
  }

  private releaseMic(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }
}

function defaultGetUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia(constraints);
}

function defaultCreateAudioContext(): AudioContext {
  return new AudioContext({ sampleRate: AUDIO_SAMPLE_RATE });
}

function defaultCreateWorkletNode(ctx: AudioContext): AudioWorkletNode {
  return new AudioWorkletNode(ctx, PCM_TAP_PROCESSOR_NAME);
}

function defaultCreateMediaRecorder(stream: MediaStream): MediaRecorder {
  return new MediaRecorder(stream, { mimeType: RECORDER_MIME_TYPE });
}

function defaultWorkletUrl(): string {
  // G1 (D-G1-07): `entrypoints/pcm-tap-processor.ts` es su propio entrypoint de WXT
  // (nivel superior, no `offscreen/worklet/...` — WXT no compila rutas anidadas).
  if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
    return chrome.runtime.getURL("pcm-tap-processor.js");
  }
  return "pcm-tap-processor.js";
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
