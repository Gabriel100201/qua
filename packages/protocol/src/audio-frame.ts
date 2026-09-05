import { AUDIO_FRAME } from "./constants.js";

/** Un frame binario de audio ya decodificado (§04). */
export interface AudioFrame {
  seq: number;
  /** ms desde `t0_wall`. */
  t_ms: number;
  /** Exactamente `AUDIO_FRAME.SAMPLES_PER_FRAME` muestras i16. */
  samples: Int16Array;
}

export class AudioFrameError extends Error {
  override name = "AudioFrameError";
}

/**
 * Escribe un frame con el layout de §04.
 *
 * `t_ms` puede superar 2^53 solo si la sesión dura ~285 000 años, así que se
 * escribe vía BigInt pero se acepta como `number`.
 */
export function encodeAudioFrame(frame: AudioFrame): Uint8Array {
  if (frame.samples.length !== AUDIO_FRAME.SAMPLES_PER_FRAME) {
    throw new AudioFrameError(
      `Se esperaban ${AUDIO_FRAME.SAMPLES_PER_FRAME} muestras, llegaron ${frame.samples.length}`,
    );
  }
  const buf = new Uint8Array(AUDIO_FRAME.TOTAL_BYTES);
  const view = new DataView(buf.buffer);
  view.setUint8(AUDIO_FRAME.OFFSET_MAGIC, AUDIO_FRAME.MAGIC);
  view.setUint32(AUDIO_FRAME.OFFSET_SEQ, frame.seq, true);
  view.setBigUint64(AUDIO_FRAME.OFFSET_T_MS, BigInt(frame.t_ms), true);
  for (let i = 0; i < AUDIO_FRAME.SAMPLES_PER_FRAME; i++) {
    view.setInt16(
      AUDIO_FRAME.OFFSET_SAMPLES + i * AUDIO_FRAME.BYTES_PER_SAMPLE,
      frame.samples[i]!,
      true,
    );
  }
  return buf;
}

/** Lee un frame. Tira `AudioFrameError` si el magic o el tamaño no cierran. */
export function decodeAudioFrame(bytes: Uint8Array): AudioFrame {
  if (bytes.length !== AUDIO_FRAME.TOTAL_BYTES) {
    throw new AudioFrameError(
      `Se esperaban ${AUDIO_FRAME.TOTAL_BYTES} bytes, llegaron ${bytes.length}`,
    );
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = view.getUint8(AUDIO_FRAME.OFFSET_MAGIC);
  if (magic !== AUDIO_FRAME.MAGIC) {
    throw new AudioFrameError(
      `Magic inesperado: 0x${magic.toString(16)} (se esperaba 0x${AUDIO_FRAME.MAGIC.toString(16)})`,
    );
  }
  const samples = new Int16Array(AUDIO_FRAME.SAMPLES_PER_FRAME);
  for (let i = 0; i < AUDIO_FRAME.SAMPLES_PER_FRAME; i++) {
    samples[i] = view.getInt16(
      AUDIO_FRAME.OFFSET_SAMPLES + i * AUDIO_FRAME.BYTES_PER_SAMPLE,
      true,
    );
  }
  return {
    seq: view.getUint32(AUDIO_FRAME.OFFSET_SEQ, true),
    t_ms: Number(view.getBigUint64(AUDIO_FRAME.OFFSET_T_MS, true)),
    samples,
  };
}

/** `true` si el buffer arranca con el magic de audio. Barato: no parsea nada más. */
export function isAudioFrame(bytes: Uint8Array): boolean {
  return bytes.length > 0 && bytes[0] === AUDIO_FRAME.MAGIC;
}
