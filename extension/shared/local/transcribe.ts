import type { Utterance } from "@qua/protocol";

/**
 * §06.1 en el navegador (D-L1-01): VAD silero → segmentador de `qua-core` (WASM) →
 * whisper vía transformers.js → `Utterance[]` con la misma forma que produce `quad`.
 *
 * Todo lo que depende del entorno entra por parámetro (`deps`), así el mismo código
 * corre en el offscreen doc (onnxruntime-web, WebGPU) y en Node contra sesiones
 * reales (onnxruntime-node) para medir calidad y paridad.
 */

export interface Segment {
  t_offset_ms: number;
  start_sample: number;
  len: number;
}

/** Lo que devuelve el pipeline `automatic-speech-recognition` de transformers.js. */
export interface AsrOutput {
  text: string;
  chunks?: { timestamp: [number, number | null]; text: string }[];
}

/** Firma del pipeline de transformers.js (solo lo que se usa). */
export type AsrPipeline = (audio: Float32Array, opts: Record<string, unknown>) => Promise<AsrOutput>;

export interface TranscribeDeps {
  /** Probabilidad de silero por chunk de 512 muestras (`sileroProbabilities`). */
  vadProbabilities: (pcm: Int16Array) => Promise<Float32Array>;
  /** `segment()` de qua-wasm: devuelve JSON con los segmentos. */
  segment: (pcm: Int16Array, probs: Float32Array, asrToml: string) => string;
  asr: AsrPipeline;
  /** Id del token `<|nospeech|>` del tokenizer, para `no_speech_prob`. */
  noSpeechTokenId?: number;
}

export interface TranscribeOptions {
  asrToml?: string;
  /** Idioma para whisper (nombre largo de transformers.js). */
  language?: string;
  onProgress?: (stage: "vad" | "asr", done: number, total: number) => void;
}

/**
 * Registra, paso a paso de la generación, el log-prob del token elegido y la
 * probabilidad de `<|nospeech|>` en el primer paso. Es lo que `whisper.cpp` le da a
 * `quad` como `avg_logprob` / `no_speech_prob`, y lo que el filtro de ruido del
 * correlador (§07 paso 2) usa para descartar alucinaciones sobre silencio o ruido.
 *
 * Va al final de la lista de logits processors de transformers.js, así que ve los
 * logits ya procesados: con decodificación greedy, el token elegido es su argmax.
 */
export function createScoreRecorder(noSpeechTokenId?: number) {
  const logprobs: number[] = [];
  let noSpeechProb: number | undefined;

  const processor = (_inputIds: unknown, logits: { data: Float32Array; dims: number[] }) => {
    const data = logits.data;
    const vocab = logits.dims.at(-1) ?? data.length;
    let max = -Infinity;
    for (let i = 0; i < vocab; i++) if ((data[i] as number) > max) max = data[i] as number;
    let sum = 0;
    for (let i = 0; i < vocab; i++) {
      const v = data[i] as number;
      if (v !== -Infinity) sum += Math.exp(v - max);
    }
    const lse = max + Math.log(sum);
    logprobs.push(max - lse);
    if (noSpeechProb === undefined && noSpeechTokenId !== undefined) {
      const v = data[noSpeechTokenId] as number;
      noSpeechProb = v === -Infinity ? 0 : Math.exp(v - lse);
    }
    return logits;
  };

  return {
    processor,
    /** Promedio sobre los tokens de texto (sin el EOT final), como whisper.cpp. */
    result(): { avgLogprob: number; noSpeechProb: number } {
      const text = logprobs.length > 1 ? logprobs.slice(0, -1) : logprobs;
      const avg = text.length ? text.reduce((a, b) => a + b, 0) / text.length : 0;
      return { avgLogprob: avg, noSpeechProb: Math.min(1, Math.max(0, noSpeechProb ?? 0)) };
    },
  };
}

export async function transcribeSession(
  pcm: Int16Array,
  deps: TranscribeDeps,
  opts: TranscribeOptions = {},
): Promise<Utterance[]> {
  const probs = await deps.vadProbabilities(pcm);
  opts.onProgress?.("vad", 1, 1);
  const segments = JSON.parse(deps.segment(pcm, probs, opts.asrToml ?? "")) as Segment[];

  const utterances: Utterance[] = [];
  for (const [i, seg] of segments.entries()) {
    opts.onProgress?.("asr", i, segments.length);
    const audio = new Float32Array(seg.len);
    for (let k = 0; k < seg.len; k++) audio[k] = ((pcm[seg.start_sample + k] ?? 0) as number) / 32768;

    const recorder = createScoreRecorder(deps.noSpeechTokenId);
    const out = await deps.asr(audio, {
      language: opts.language ?? "spanish",
      task: "transcribe",
      return_timestamps: true,
      // El VAD corta a 25 s como máximo (§06.1), así que nunca hace falta ventanear.
      chunk_length_s: 0,
      logits_processor: [recorder.processor],
    });
    const text = out.text.trim();
    if (!text) continue;

    // Mismos límites que `quad`: whisper.cpp termina la utterance en el final del
    // segmento del VAD (medido sobre sesiones reales, ±12 ms), no en el timestamp que
    // predice el modelo, que cae 400-600 ms antes. Usar el predicho agranda los huecos
    // entre utterances y el paso 1 del correlador (`merge_gap_ms`) deja de fusionar
    // frases que `quad` sí fusiona.
    const first = out.chunks?.[0]?.timestamp[0];
    const segEnd = seg.t_offset_ms + Math.round((seg.len / 16000) * 1000);
    const t_start = first != null ? Math.min(segEnd, seg.t_offset_ms + Math.round(first * 1000)) : seg.t_offset_ms;
    const t_end = segEnd;
    const { avgLogprob, noSpeechProb } = recorder.result();

    utterances.push({
      id: `u${String(utterances.length + 1).padStart(2, "0")}`,
      t_start,
      t_end: Math.max(t_start, t_end),
      text,
      lang: "es",
      // transformers.js no da timestamps por palabra sin un modelo con cross-attention
      // exportada; el correlador no los usa (solo `transcript.txt` los ignora también).
      words: [],
      avg_logprob: avgLogprob,
      no_speech_prob: noSpeechProb,
      marked: false,
    });
  }
  opts.onProgress?.("asr", segments.length, segments.length);
  return utterances;
}
