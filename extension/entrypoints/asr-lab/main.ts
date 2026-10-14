import * as ort from "onnxruntime-web";
import { env, pipeline } from "@huggingface/transformers";
import initQuaWasm, { segment } from "../../shared/qua-wasm/qua_wasm.js";
import quaWasmUrl from "../../shared/qua-wasm/qua_wasm_bg.wasm?url";
import { sileroProbabilities } from "../../shared/local/silero.js";
import { transcribeSession, type AsrPipeline } from "../../shared/local/transcribe.js";

/**
 * Laboratorio de ASR (solo desarrollo, D-L1-02): corre el pipeline local sobre un PCM
 * dado con distintas combinaciones de dispositivo/precisión, dentro de Chrome y con
 * WebGPU de verdad, para comparar contra whisper.cpp sin pasar por el micrófono.
 */
for (const target of [ort.env, env.backends.onnx]) {
  if (!target?.wasm) continue;
  target.wasm.wasmPaths = chrome.runtime.getURL("ort/");
  target.wasm.numThreads = 1;
}
env.allowLocalModels = false;

interface LabConfig {
  model: string;
  device: "webgpu" | "wasm";
  dtype: string | Record<string, string>;
  returnTimestamps: boolean;
}

async function run(cfg: LabConfig, pcmB64: string) {
  await initQuaWasm({ module_or_path: quaWasmUrl });
  const bin = atob(pcmB64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const pcm = new Int16Array(bytes.buffer);
  const silero = await fetch(chrome.runtime.getURL("vad/silero_vad.onnx")).then((r) => r.arrayBuffer());

  const t0 = performance.now();
  const asr = (await pipeline("automatic-speech-recognition", cfg.model, {
    device: cfg.device,
    dtype: cfg.dtype as never,
  })) as unknown as AsrPipeline & { tokenizer: { model: { tokens_to_ids: Map<string, number> } } };
  const tLoad = performance.now() - t0;
  const ids = asr.tokenizer.model.tokens_to_ids;
  const wrapped: AsrPipeline = (audio, opts) => asr(audio, { ...opts, return_timestamps: cfg.returnTimestamps });

  const t1 = performance.now();
  const utterances = await transcribeSession(pcm, {
    vadProbabilities: (p) => sileroProbabilities(ort as never, new Uint8Array(silero), p),
    segment,
    asr: wrapped,
    noSpeechTokenId: ids.get("<|nospeech|>") ?? ids.get("<|nocaptions|>"),
  });
  return { loadMs: tLoad, runMs: performance.now() - t1, audioMs: (pcm.length / 16000) * 1000, utterances };
}

(window as unknown as { lab: unknown }).lab = { run };
document.title = "lab-ready";
