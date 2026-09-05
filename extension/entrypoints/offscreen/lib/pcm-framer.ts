import { AUDIO_FRAME, AUDIO_SAMPLE_RATE, encodeAudioFrame } from "@qua/protocol";

/**
 * f32 (rango [-1, 1], como entrega todo `AudioWorkletProcessor`) → i16 (§04).
 *
 * Escala asimétrica estándar de PCM de 16 bits: el lado negativo usa 0x8000
 * (32768) y el positivo 0x7fff (32767), porque el rango de un i16 con signo
 * no es simétrico (-32768..32767). Con esa escala, dividir un i16 por 32768
 * (lado negativo) y volver a multiplicar por 32768 recupera el valor exacto
 * — es lo que verifica el test contra la fixture dorada de `fixtures/audio-frame.json`.
 */
export function f32ToI16Sample(sample: number): number {
  const clamped = sample > 1 ? 1 : sample < -1 ? -1 : sample;
  const scaled = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  const rounded = Math.round(scaled);
  return rounded > 32767 ? 32767 : rounded < -32768 ? -32768 : rounded;
}

export interface PcmFramerOptions {
  /**
   * `t_ms` del primer frame que se emita (§04: "desde t0_wall"). El offscreen
   * doc lo calcula una sola vez al arrancar la captura, como
   * `wallNowAlIniciar - t0_wall` (mismo origen que `performance.timeOrigin +
   * performance.now()` que usa el content script, §02).
   */
  startTMs?: number;
  /** `seq` del primer frame. Por defecto 0. */
  startSeq?: number;
  /** Solo para tests: simular un `AudioContext` con otro sample rate. */
  sampleRateHz?: number;
}

/**
 * Acumula bloques f32 de `AudioWorkletProcessor.process()` (típicamente 128
 * muestras por llamada — no coincide con las 320 de un frame de §04) y emite
 * frames binarios completos ya codificados con `encodeAudioFrame` de
 * `@qua/protocol` (fuente de verdad del layout — esta clase no reimplementa
 * el empaquetado de bytes, solo decide qué muestras van en cada frame).
 *
 * El `t_ms` de cada frame se deriva contando muestras emitidas y dividiendo
 * por el sample rate, no leyendo el reloj de pared en cada frame: a 16 kHz
 * fijo (la `AudioContext` se crea con `sampleRate: 16000`, §5.4) el tiempo
 * transcurrido es exactamente `muestras / 16000` segundos, sin el jitter que
 * tendría leer `performance.now()` dentro de `AudioWorkletGlobalScope` en
 * cada frame.
 */
export class PcmFramer {
  private readonly pending: number[] = [];
  private readonly startTMs: number;
  private readonly sampleRateHz: number;
  private seq: number;
  private samplesEmitted = 0;

  constructor(opts: PcmFramerOptions = {}) {
    this.seq = opts.startSeq ?? 0;
    this.startTMs = opts.startTMs ?? 0;
    this.sampleRateHz = opts.sampleRateHz ?? AUDIO_SAMPLE_RATE;
  }

  /** Próximo `seq` que se va a usar — para que el llamador pueda persistir el corte en un reconnect. */
  get nextSeq(): number {
    return this.seq;
  }

  /** Recibe un bloque f32 mono y devuelve 0+ frames binarios completos (§04), en orden. */
  push(chunk: Float32Array): Uint8Array[] {
    for (let i = 0; i < chunk.length; i++) {
      this.pending.push(f32ToI16Sample(chunk[i]!));
    }

    const frames: Uint8Array[] = [];
    while (this.pending.length >= AUDIO_FRAME.SAMPLES_PER_FRAME) {
      const samples = Int16Array.from(this.pending.splice(0, AUDIO_FRAME.SAMPLES_PER_FRAME));
      const t_ms = this.startTMs + Math.round((this.samplesEmitted / this.sampleRateHz) * 1000);
      frames.push(encodeAudioFrame({ seq: this.seq, t_ms, samples }));
      this.seq += 1;
      this.samplesEmitted += AUDIO_FRAME.SAMPLES_PER_FRAME;
    }
    return frames;
  }
}
