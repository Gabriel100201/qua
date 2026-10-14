/**
 * Silero VAD v5 sobre onnxruntime (D-L1-01). Replica exactamente la llamada de
 * `voice_activity_detector` 0.2 que usa `quad`: entrada `[1, 512]` sin contexto previo,
 * estado `[2, 1, 128]` que arranca en cero y se arrastra entre chunks, y `sr` escalar.
 * Mismo modelo (`silero_vad.onnx` del crate) → mismas probabilidades → mismos segmentos.
 *
 * Recibe el módulo de onnxruntime por parámetro: la extensión pasa `onnxruntime-web` y
 * los tests y el banco de pruebas pasan `onnxruntime-node`, con el mismo código.
 */

export const SILERO_CHUNK = 512;
const SAMPLE_RATE = 16000;

/** Lo mínimo de la API de onnxruntime que se usa acá (web y node la comparten). */
export interface OrtLike {
  InferenceSession: { create(model: Uint8Array | ArrayBuffer | string, opts?: unknown): Promise<OrtSession> };
  Tensor: new (type: string, data: Float32Array | BigInt64Array, dims: number[]) => OrtTensor;
}
interface OrtTensor {
  data: unknown;
}
interface OrtSession {
  run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>;
}

/**
 * Probabilidad de habla para cada chunk de 512 muestras desde el inicio del audio. El
 * último chunk incompleto no se evalúa, igual que el `AudioFrontend` de `quad`, que solo
 * empuja chunks completos al segmentador.
 */
export async function sileroProbabilities(
  ort: OrtLike,
  model: Uint8Array | ArrayBuffer | string,
  pcm: Int16Array,
  onProgress?: (done: number, total: number) => void,
): Promise<Float32Array> {
  const session = await ort.InferenceSession.create(model);
  const total = Math.floor(pcm.length / SILERO_CHUNK);
  const probs = new Float32Array(total);
  let state = new ort.Tensor("float32", new Float32Array(2 * 128), [2, 1, 128]);
  const sr = new ort.Tensor("int64", BigInt64Array.from([BigInt(SAMPLE_RATE)]), []);
  const input = new Float32Array(SILERO_CHUNK);

  for (let c = 0; c < total; c++) {
    const base = c * SILERO_CHUNK;
    // Misma conversión que `i16_to_f32` de `qua-core` (s / 32768).
    for (let i = 0; i < SILERO_CHUNK; i++) input[i] = (pcm[base + i] as number) / 32768;
    const out = await session.run({
      input: new ort.Tensor("float32", input.slice(), [1, SILERO_CHUNK]),
      state,
      sr,
    });
    probs[c] = (out.output!.data as Float32Array)[0] as number;
    state = out.stateN!;
    if (onProgress && c % 200 === 0) onProgress(c, total);
  }
  onProgress?.(total, total);
  return probs;
}
