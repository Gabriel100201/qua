import { AUDIO_FRAME } from "@qua/protocol";

/**
 * Buffer en memoria del offscreen doc para cuando el WS está caído (§04
 * "Resiliencia"): "Buffer en memoria en el offscreen doc de hasta 30 s. Si se
 * desborda, se descarta lo más viejo y se emite un evento `audio_gap` con la
 * duración perdida."
 *
 * Cada frame dura `AUDIO_FRAME.FRAME_MS` (20 ms) — no hace falta parsear el
 * frame para saber su duración, es una constante del protocolo.
 */
export interface GapBufferOptions {
  /** Tope en ms de audio bufferizado. Por defecto 30 000 (§04). */
  capacityMs?: number;
}

export class GapBuffer {
  private readonly capacityFrames: number;
  private readonly frames: Uint8Array[] = [];
  /** ms de audio descartado desde la última vez que se drenó/consultó. */
  private droppedMs = 0;

  constructor(opts: GapBufferOptions = {}) {
    const capacityMs = opts.capacityMs ?? 30_000;
    this.capacityFrames = Math.max(1, Math.floor(capacityMs / AUDIO_FRAME.FRAME_MS));
  }

  /** Cuántos frames hay bufferizados ahora mismo. */
  get size(): number {
    return this.frames.length;
  }

  /** Agrega un frame. Si se pasa de la capacidad, descarta el más viejo. */
  push(frame: Uint8Array): void {
    this.frames.push(frame);
    if (this.frames.length > this.capacityFrames) {
      this.frames.shift();
      this.droppedMs += AUDIO_FRAME.FRAME_MS;
    }
  }

  /**
   * Saca y devuelve todos los frames bufferizados, en orden, y limpia el
   * buffer. Pensado para cuando el WS reconecta y hay que reenviar todo lo
   * juntado durante la caída.
   */
  drain(): Uint8Array[] {
    return this.frames.splice(0, this.frames.length);
  }

  /**
   * Ms de audio perdido por desborde desde la última llamada a este método
   * (o desde que se creó el buffer). Devuelve 0 si no se perdió nada — el
   * llamador solo debería emitir `audio_gap` cuando esto es > 0.
   */
  takeDroppedMs(): number {
    const ms = this.droppedMs;
    this.droppedMs = 0;
    return ms;
  }
}
