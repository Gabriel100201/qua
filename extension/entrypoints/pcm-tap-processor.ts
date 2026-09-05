// AudioWorkletProcessor "pcm-tap" (parrafo 5.4).
//
// Corre en AudioWorkletGlobalScope, un hilo de audio separado del hilo del
// offscreen doc. Los tipos minimos de ese scope estan en
// offscreen/lib/audio-worklet-globals.d.ts (TypeScript no los trae en
// lib.dom). Ver docs/DECISIONS.md, D-13 y D-G1-07.
//
// G1: este archivo tiene que ser su propio entrypoint de WXT de nivel
// superior (un solo segmento de ruta bajo entrypoints/) para que wxt build
// lo compile a un .js servible: WXT no reconoce entrypoints en subcarpetas
// mas profundas, asi que vivia sin compilarse y addModule fallaba con
// "Network error" en cuanto se probo de punta a punta.
//
// Un "unlisted script" de WXT exporta defineUnlistedScript({ main() {...} }),
// y WXT importa este archivo en Node para leer esa config antes de
// empaquetarlo para el navegador. Por eso la clase que extiende
// AudioWorkletProcessor tiene que quedar adentro de main(): a nivel de
// modulo, ese global no existe en Node y revienta al importar.
//
// No importa PCM_TAP_PROCESSOR_NAME de offscreen/lib/audio-capture.ts a
// proposito (aunque el valor tiene que coincidir): cruzar el import metería
// el modulo entero de AudioCapture en el bundle del worklet.

import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import { PcmFramer } from "./offscreen/lib/pcm-framer.js";

const PCM_TAP_PROCESSOR_NAME = "pcm-tap";

interface PcmTapInitMessage {
  type: "qua:pcm-tap-init";
  startTMs: number;
  startSeq?: number;
}

function isPcmTapInitMessage(data: unknown): data is PcmTapInitMessage {
  return !!data && typeof data === "object" && (data as PcmTapInitMessage).type === "qua:pcm-tap-init";
}

export default defineUnlistedScript(() => {
  if (typeof AudioWorkletProcessor === "undefined") return;

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
      return true;
    }
  }

  registerProcessor(PCM_TAP_PROCESSOR_NAME, PcmTapProcessor);
});
