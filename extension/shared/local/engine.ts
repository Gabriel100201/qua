import * as ort from "onnxruntime-web";
import { env, pipeline } from "@huggingface/transformers";
import initQuaWasm, { crop, finalize, render, segment } from "../qua-wasm/qua_wasm.js";
import quaWasmUrl from "../qua-wasm/qua_wasm_bg.wasm?url";
import { sileroProbabilities } from "./silero.js";
import { transcribeSession, type AsrPipeline } from "./transcribe.js";
import type { Utterance } from "@qua/protocol";
import type { QuaWasm } from "./process.js";

/**
 * Motor local del offscreen doc (D-L1-01): carga silero, whisper y qua-wasm una sola
 * vez y los deja vivos mientras exista el documento. Todo se sirve desde el paquete
 * de la extensión salvo los pesos de whisper, que se bajan de Hugging Face la primera
 * vez y quedan en la Cache API del origen de la extensión.
 */

/**
 * Con WebGPU, el mismo whisper que usa `quad` (large-v3-turbo). Sin GPU, turbo en WASM
 * tarda 16 veces la duración del audio; small queda en ~3 veces con 2,6 % de diferencia.
 * Ver D-L1-04.
 */
export const GPU_MODEL = "onnx-community/whisper-large-v3-turbo";
export const CPU_MODEL = "onnx-community/whisper-small";

export type { ModelState } from "./model-state.js";
import type { ModelState } from "./model-state.js";

const runtimeUrl = (path: string) =>
  typeof chrome !== "undefined" && chrome.runtime?.getURL ? chrome.runtime.getURL(path) : `/${path}`;

let wasmReady: Promise<QuaWasm> | undefined;
/** Todos los que esperan el modelo reciben el progreso, no solo el primero que lo pidió:
 * la precarga arranca al grabar y el procesamiento se engancha después a la misma carga. */
const stateListeners = new Set<(s: ModelState) => void>();
const broadcast = (s: ModelState) => stateListeners.forEach((l) => l(s));
let asrReady: Promise<{ asr: AsrPipeline; noSpeechTokenId?: number; device: "webgpu" | "wasm" }> | undefined;

function configureOrt(): void {
  // MV3 no permite cargar código remoto: los binarios de onnxruntime van dentro del
  // paquete. Sin aislamiento de origen no hay SharedArrayBuffer, así que un hilo.
  for (const target of [ort.env, env.backends.onnx]) {
    if (!target?.wasm) continue;
    target.wasm.wasmPaths = runtimeUrl("ort/");
    target.wasm.numThreads = 1;
  }
  env.allowLocalModels = false;
  env.useBrowserCache = true;
}

export function loadQuaWasm(): Promise<QuaWasm> {
  wasmReady ??= initQuaWasm({ module_or_path: quaWasmUrl }).then(() => ({ finalize, render, crop }));
  return wasmReady;
}

async function hasWebGpu(): Promise<boolean> {
  const gpu = (navigator as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return false;
  try {
    return (await gpu.requestAdapter()) != null;
  } catch {
    return false;
  }
}

/**
 * Carga whisper. Con WebGPU: turbo con encoder fp16 + decoder q4 (la combinación que
 * recomienda transformers.js). Sin WebGPU: small q8 en WASM.
 */
export function loadAsr(
  onState: (s: ModelState) => void,
): Promise<{ asr: AsrPipeline; noSpeechTokenId?: number; device: "webgpu" | "wasm" }> {
  stateListeners.add(onState);
  asrReady ??= (async () => {
    configureOrt();
    const device: "webgpu" | "wasm" = (await hasWebGpu()) ? "webgpu" : "wasm";
    const model = device === "webgpu" ? GPU_MODEL : CPU_MODEL;
    const files = new Map<string, { loaded: number; total: number }>();
    const asr = (await pipeline("automatic-speech-recognition", model, {
      device,
      dtype: device === "webgpu" ? { encoder_model: "fp16", decoder_model_merged: "q4" } : "q8",
      progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
        if (p.status !== "progress" || !p.file) return;
        files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
        let loaded = 0;
        let total = 0;
        for (const f of files.values()) {
          loaded += f.loaded;
          total += f.total;
        }
        broadcast({ status: "descargando", loaded, total });
      },
    })) as unknown as AsrPipeline & { tokenizer: { model: { tokens_to_ids: Map<string, number> } } };
    const ids = asr.tokenizer.model.tokens_to_ids;
    broadcast({ status: "listo", device });
    return { asr, noSpeechTokenId: ids.get("<|nospeech|>") ?? ids.get("<|nocaptions|>"), device };
  })().catch((err: unknown) => {
    asrReady = undefined;
    broadcast({ status: "error", message: String(err) });
    throw err;
  });
  return asrReady!.finally(() => stateListeners.delete(onState));
}

let sileroModel: Promise<ArrayBuffer> | undefined;

export async function transcribe(
  pcm: Int16Array,
  onState: (s: ModelState) => void,
  onProgress: (stage: "vad" | "asr", done: number, total: number) => void,
): Promise<Utterance[]> {
  configureOrt();
  await loadQuaWasm();
  sileroModel ??= fetch(runtimeUrl("vad/silero_vad.onnx")).then((r) => r.arrayBuffer());
  const [model, { asr, noSpeechTokenId }] = await Promise.all([sileroModel, loadAsr(onState)]);
  return transcribeSession(
    pcm,
    {
      vadProbabilities: (p) =>
        sileroProbabilities(ort as never, new Uint8Array(model), p, (d, t) => onProgress("vad", d, t)),
      segment,
      asr,
      noSpeechTokenId,
    },
    { onProgress },
  );
}
