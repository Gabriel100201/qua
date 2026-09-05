/**
 * `AudioWorkletProcessor` "pcm-tap" (§5.4).
 *
 * Corre en `AudioWorkletGlobalScope`, un hilo de audio en tiempo real
 * separado del hilo del offscreen doc — TypeScript no trae los tipos de ese
 * scope en `lib.dom` (a diferencia de `AudioWorkletNode`, que sí es parte de
 * la API del hilo principal), así que se declaran acá los mínimos que se
 * usan. Ver `docs/DECISIONS.md` D-13.
 *
 * Este archivo se compila aparte (no se importa desde el hilo principal) y
 * se carga vía `audioContext.audioWorklet.addModule(url)` — el wiring de
 * bundling con WXT (que este archivo termine como su propio `.js` servible)
 * es del scaffold compartido con A2/G1, mismo patrón que D-09.
 */

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}

declare function registerProcessor(
  name: string,
  ctor: new () => AudioWorkletProcessor,
): void;

import { PcmFramer } from "../lib/pcm-framer.js";
import { PCM_TAP_PROCESSOR_NAME } from "../lib/audio-capture.js";

interface PcmTapInitMessage {
  type: "qua:pcm-tap-init";
  /** `t_ms` del primer frame, ya calculado respecto de `t0_wall` por el hilo principal (§04). */
  startTMs: number;
  startSeq?: number;
}

function isPcmTapInitMessage(data: unknown): data is PcmTapInitMessage {
  return !!data && typeof data === "object" && (data as PcmTapInitMessage).type === "qua:pcm-tap-init";
}

/**
 * f32 → i16 en frames de 320 muestras (§5.4). El framer no sabe nada de
 * `AudioWorkletGlobalScope`: toda la lógica de empaquetado vive en
 * `PcmFramer` (testeada aparte, sin necesitar un navegador real) — este
 * archivo es solo el pegamento con el hilo de audio.
 */
class PcmTapProcessor extends AudioWorkletProcessor {
  private framer: PcmFramer | null = null;

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent) => {
      const data = event.data as unknown;
      if (isPcmTapInitMessage(data)) {
        this.framer = new PcmFramer({ startTMs: data.startTMs, startSeq: data.startSeq ?? 0 });
      }
    };
  }

  override process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (channel && channel.length > 0 && this.framer) {
      for (const frame of this.framer.push(channel)) {
        this.port.postMessage({ type: "qua:pcm-frame", bytes: frame }, [frame.buffer]);
      }
    }
    // `true` mantiene vivo el processor mientras dure la captura (§5.4).
    return true;
  }
}

if (typeof AudioWorkletProcessor !== "undefined") {
  registerProcessor(PCM_TAP_PROCESSOR_NAME, PcmTapProcessor);
}
