import type { Utterance } from "@qua/protocol";
import { LocalStore, type ProcessingProgress } from "../../../shared/local/store.js";
import { processSession, type Frame, type QuaWasm } from "../../../shared/local/process.js";
import type { ModelState } from "../../../shared/local/model-state.js";

/**
 * Lo que hace el offscreen doc cuando el SW le avisa que la sesión terminó (D-L1-01).
 * Las dependencias pesadas (whisper, onnxruntime, qua-wasm) entran por parámetro para
 * poder testear el flujo sin bajar modelos.
 */
export interface LocalProcessorDeps {
  store: LocalStore;
  loadWasm: () => Promise<QuaWasm>;
  transcribe: (
    pcm: Int16Array,
    onState: (s: ModelState) => void,
    onProgress: (stage: "vad" | "asr", done: number, total: number) => void,
  ) => Promise<Utterance[]>;
  readFrames: (fromWall: number, toWall: number) => Promise<Frame[]>;
  onModelState: (s: ModelState) => void;
}

function peak(pcm: Int16Array): number {
  let p = 0;
  for (let i = 0; i < pcm.length; i++) {
    const v = Math.abs(pcm[i] as number);
    if (v > p) p = v;
  }
  return p;
}

export async function processLocalSession(
  deps: LocalProcessorDeps,
  sessionId: string,
  pcm: Int16Array,
  tStop: number,
  endedAt: string,
  captureStats?: Record<string, number>,
): Promise<void> {
  const { store } = deps;
  const row = await store.getSession(sessionId);
  if (!row) throw new Error(`[qua] no encontré la sesión ${sessionId} en IndexedDB`);

  // Las escrituras de progreso no se esperan: si una se pisa con la siguiente no
  // importa, y no tiene sentido frenar a whisper por IndexedDB.
  const progress = (p: ProcessingProgress) => void store.updateSession(sessionId, { progress: p });

  try {
    await store.updateSession(sessionId, {
      status: "processing",
      t_stop: tStop,
      ended_at: endedAt,
      audio_ms: Math.round(pcm.length / 16),
      audio_peak: peak(pcm),
      capture: captureStats,
    });
    const utterances = pcm.length
      ? await deps.transcribe(
          pcm,
          (s) => {
            deps.onModelState(s);
            if (s.status === "descargando") progress({ stage: "modelo", done: s.loaded, total: s.total });
          },
          (stage, done, total) => progress({ stage: stage === "vad" ? "voz" : "transcripcion", done, total }),
        )
      : [];

    const [wasm, events, frames] = await Promise.all([
      deps.loadWasm(),
      store.events(sessionId),
      deps.readFrames(row.meta.t0_wall, tStop),
    ]);
    const out = processSession(wasm, { meta: row.meta, events, utterances, tStop, endedAt, frames }, progress);

    for (const asset of out.assets) await store.putAsset(sessionId, asset.name, asset.bytes);
    await store.updateSession(sessionId, {
      status: "ready",
      progress: undefined,
      report_md: out.reportMd,
      issues_json: out.issuesJson,
      transcript: out.transcript,
      session_json: JSON.stringify(out.session),
      issues: out.session.issues.length,
      assets: out.assets.map((a) => a.name),
    });
    await store.dropEvents(sessionId);
  } catch (err) {
    await store.updateSession(sessionId, { status: "failed", progress: undefined, error: String(err) });
    throw err;
  }
}

/** Frames del ring de §5.3 (`qua-screenshots`, store `frames`, clave `t`) dentro de la sesión. */
export async function readFramesFromRing(fromWall: number, toWall: number, factory: IDBFactory = indexedDB): Promise<Frame[]> {
  // Abrir una base inexistente sin versión la crea vacía en la versión 1, y entonces el
  // `onupgradeneeded` del SW nunca crearía `frames`. Solo se abre si ya existe.
  const existing = await factory.databases?.();
  if (existing && !existing.some((d) => d.name === "qua-screenshots")) return [];
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = factory.open("qua-screenshots");
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  try {
    if (!db.objectStoreNames.contains("frames")) return [];
    return await new Promise<Frame[]>((resolve, reject) => {
      const r = db.transaction("frames", "readonly").objectStore("frames").getAll(IDBKeyRange.bound(fromWall, toWall));
      r.onsuccess = () => resolve(r.result as Frame[]);
      r.onerror = () => reject(r.error);
    });
  } finally {
    db.close();
  }
}
