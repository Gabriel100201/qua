/**
 * Audio de la sesión en memoria (modo local, D-L1-01): lo que en `quad` era
 * `raw/audio.pcm`. Cada frame de §04 trae su `t_ms` desde `t0_wall`, así que se
 * escribe en su posición del reloj de la sesión y no "en orden de llegada": si el
 * micrófono tardó en arrancar o hubo un hueco, el audio igual queda alineado con los
 * eventos del DOM, que es lo que el correlador necesita.
 *
 * 16 kHz mono i16 son 32 KB/s: una hora son ~115 MB, holgado para un documento.
 */

const HEADER_BYTES = 13; // magic u8 · seq u32le · t_ms u64le (§04)
const MAGIC = 0xa0;
const SAMPLES_PER_MS = 16;

export class PcmStore {
  private buf = new Int16Array(16000 * 60);
  private length = 0;
  /** Diagnóstico de captura: queda en la sesión para poder explicar un reporte sin voz. */
  stats = { frames: 0, firstTMs: -1, lastTMs: -1, firstArrivalWall: 0, lastArrivalWall: 0 };

  /** Agrega un frame binario de §04. Ignora lo que no tenga el magic correcto. */
  push(frame: Uint8Array): void {
    if (frame.byteLength < HEADER_BYTES || frame[0] !== MAGIC) return;
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    const tMs = Number(view.getBigUint64(5, true));
    const samples = (frame.byteLength - HEADER_BYTES) >> 1;
    const at = tMs * SAMPLES_PER_MS;
    const now = Date.now();
    if (this.stats.frames === 0) {
      this.stats.firstTMs = tMs;
      this.stats.firstArrivalWall = now;
    }
    this.stats.frames += 1;
    this.stats.lastTMs = tMs;
    this.stats.lastArrivalWall = now;
    this.ensure(at + samples);
    for (let i = 0; i < samples; i++) this.buf[at + i] = view.getInt16(HEADER_BYTES + i * 2, true);
    this.length = Math.max(this.length, at + samples);
  }

  /** Copia del audio hasta la última muestra recibida. */
  pcm(): Int16Array {
    return this.buf.slice(0, this.length);
  }

  durationMs(): number {
    return Math.floor(this.length / SAMPLES_PER_MS);
  }

  clear(): void {
    this.buf = new Int16Array(16000 * 60);
    this.length = 0;
    this.stats = { frames: 0, firstTMs: -1, lastTMs: -1, firstArrivalWall: 0, lastArrivalWall: 0 };
  }

  private ensure(size: number): void {
    if (size <= this.buf.length) return;
    let next = this.buf.length;
    while (next < size) next *= 2;
    const grown = new Int16Array(next);
    grown.set(this.buf.subarray(0, this.length));
    this.buf = grown;
  }
}
