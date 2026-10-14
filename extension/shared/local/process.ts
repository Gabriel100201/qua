import type { Event, Session, Utterance } from "@qua/protocol";
import type { LocalSessionMeta, ProcessingProgress } from "./store.js";

/**
 * Fin de sesión del modo local (D-L1-01): lo mismo que `finalize` de `quad` (ws.rs) +
 * `render_session`, pero con el disco reemplazado por IndexedDB y con las capturas que
 * el daemon nunca llegó a usar (D-G1-01): acá la sesión entera está en el navegador,
 * así que el frame más cercano a cada issue está disponible.
 */

/** Las funciones de qua-wasm que usa este módulo. */
export interface QuaWasm {
  finalize(inputJson: string): string;
  render(sessionJson: string): string;
  /** `viewportW`: ancho del viewport en px CSS; la escala sale del ancho real del frame. */
  crop(jpeg: Uint8Array, rectJson: string, viewportW: number): Uint8Array;
}

export interface Frame {
  t: number;
  tab: number;
  jpegB64: string;
}

export interface ProcessInput {
  meta: LocalSessionMeta;
  events: Event[];
  utterances: Utterance[];
  tStop: number;
  endedAt: string;
  frames: Frame[];
  configToml?: string;
}

export interface ProcessOutput {
  session: Session;
  reportMd: string;
  issuesJson: string;
  transcript: string;
  assets: { name: string; bytes: Uint8Array }[];
}

/** Un frame más lejos que esto del momento del issue muestra otra cosa: mejor sin captura. */
export const MAX_FRAME_DISTANCE_MS = 3000;
/** Mismo umbral que `render_screenshots` de `quad`. */
const SCREENSHOT_MIN_CONFIDENCE = 0.5;

interface FinalizeOut {
  session: Session;
  captures: { issue_id: string; tab: number; t_target: number }[];
}

function fromB64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function closestFrame(frames: Frame[], tab: number, tWall: number): Frame | undefined {
  let best: Frame | undefined;
  for (const f of frames) {
    if (f.tab !== tab) continue;
    if (!best || Math.abs(f.t - tWall) < Math.abs(best.t - tWall)) best = f;
  }
  return best && Math.abs(best.t - tWall) <= MAX_FRAME_DISTANCE_MS ? best : undefined;
}

export function processSession(
  wasm: QuaWasm,
  input: ProcessInput,
  onProgress?: (p: ProcessingProgress) => void,
): ProcessOutput {
  onProgress?.({ stage: "reporte", done: 0, total: 1 });
  const out = JSON.parse(
    wasm.finalize(
      JSON.stringify({
        meta: input.meta,
        events: input.events,
        utterances: input.utterances,
        t_stop: input.tStop,
        ended_at: input.endedAt,
        config_toml: input.configToml ?? "",
      }),
    ),
  ) as FinalizeOut;

  const session = out.session;
  const assets: ProcessOutput["assets"] = [];
  for (const capture of out.captures) {
    const issue = session.issues.find((i) => i.id === capture.issue_id);
    const rect = issue?.anchor.target?.rect;
    if (!issue || !rect || issue.anchor.confidence < SCREENSHOT_MIN_CONFIDENCE) continue;
    const frame = closestFrame(input.frames, capture.tab, input.meta.t0_wall + capture.t_target);
    if (!frame) continue;
    try {
      const png = wasm.crop(fromB64(frame.jpegB64), JSON.stringify(rect), session.env.viewport.w);
      const name = `${issue.id}.png`;
      assets.push({ name, bytes: png });
      issue.evidence.screenshot = `assets/${name}`;
    } catch {
      // Un frame corrupto deja al issue sin captura, no a la sesión sin reporte.
    }
  }

  const rendered = JSON.parse(wasm.render(JSON.stringify(session))) as {
    report_md: string;
    issues_json: string;
    transcript: string;
  };
  onProgress?.({ stage: "reporte", done: 1, total: 1 });
  return {
    session,
    reportMd: rendered.report_md,
    issuesJson: rendered.issues_json,
    transcript: rendered.transcript,
    assets,
  };
}
