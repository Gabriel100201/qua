import type { StatusResponse } from "../../background/internal-messages.js";
import type { RingOptions, RingState } from "../../../shared/ui/ring.js";
import { angleFor, spreadAngles } from "../../../shared/ui/ring.js";
import { clock, duration, place, plural } from "../../../shared/ui/format.js";

/**
 * Qué muestra el popup para cada estado (diseño 2026-10, Penpot "QUA" → Popup, estados
 * 1 a 10). Función pura: del estado del SW y el permiso del micrófono a una descripción
 * de la vista. El DOM la pinta en `main.ts`.
 */

export type GlyphState = "ok" | "wait" | "err";
export type Controls = "shortcut" | "recording" | "opening" | "close-ok" | "ready" | "grant-mic" | "retry" | "history";
export type ViewKind =
  | "idle" | "opening" | "recording" | "processing" | "download" | "ready" | "mic-denied" | "failed" | "not-recordable";

export interface PopupView {
  kind: ViewKind;
  place: string;
  ring: { state: RingState; opts: RingOptions } | { mini: "muted" };
  reading: string;
  readingTone: "ink" | "placeholder" | "red" | "title";
  caption: string;
  controls: Controls;
  /** El anillo es el botón de grabar/detener en estos estados. */
  ringAction: "start" | "stop" | null;
  glyphs: { mic: GlyphState; engine: GlyphState; tab: GlyphState };
  tips: { mic: string; engine: string; tab: string };
  sessionId?: string;
}

export type MicPermission = "granted" | "prompt" | "denied" | "unknown";

/** Mientras pasaron menos de 30 min desde que terminó, el popup abre en "Reporte listo". */
const READY_WINDOW_MS = 30 * 60_000;

export function popupView(s: StatusResponse, mic: MicPermission, now: number): PopupView {
  const latest = s.latest ?? null;
  const updatedAt = latest?.updatedAt;
  const tabUrl = s.tab?.url ?? "";
  const recordable = s.tab?.recordable ?? false;
  const model = s.model?.status ?? "sin_descargar";

  const glyphs = {
    mic: (mic === "denied" ? "err" : mic === "granted" ? "ok" : "wait") as GlyphState,
    engine: (model === "listo" ? "ok" : model === "error" ? "err" : "wait") as GlyphState,
    tab: (recordable ? "ok" : "err") as GlyphState,
  };
  const tips = {
    mic: { ok: "Micrófono: permitido", wait: "Micrófono: Chrome todavía no lo permitió", err: "Micrófono: bloqueado" }[glyphs.mic],
    engine:
      model === "listo" ? (s.model?.device === "wasm" ? "Motor de voz: listo, sin GPU (más lento)" : "Motor de voz: listo en tu GPU")
      : model === "descargando" ? "Motor de voz: bajando"
      : model === "error" ? "Motor de voz: no se pudo cargar"
      : "Motor de voz: se baja en la primera grabación",
    tab: recordable ? "Pestaña: se puede grabar" : "Pestaña: Chrome no deja grabar acá",
  };
  const base = { place: place(tabUrl), glyphs, tips };

  // Grabando (o abriendo el mic).
  if (s.phase === "recording" || s.phase === "starting") {
    const elapsed = s.startedAtWall ? now - s.startedAtWall : 0;
    if (s.lastError && /micr[oó]fono/i.test(s.lastError)) {
      return { ...base, kind: "mic-denied", ring: { state: "error", opts: {} }, reading: "Sin micrófono", readingTone: "red", caption: "Grabo clicks y errores, pero no tu voz", controls: "grant-mic", ringAction: "stop" };
    }
    if (!s.micReady) {
      return { ...base, kind: "opening", ring: { state: "opening", opts: {} }, reading: "00:00", readingTone: "placeholder", caption: "Abriendo el micrófono. Esperá para hablar", controls: "opening", ringAction: "stop" };
    }
    const marks = (s.marks ?? []).map((m) => angleFor(m % 60_000, 60_000));
    return {
      ...base,
      kind: "recording",
      ring: { state: "recording", opts: { marks } },
      reading: clock(elapsed),
      readingTone: "ink",
      caption: (s.marks?.length ?? 0) ? plural(s.marks!.length, "marca", "marcas") : "Hablá sobre lo que ves",
      controls: "recording",
      ringAction: "stop",
    };
  }

  // Procesando la última sesión.
  if (latest?.status === "processing") {
    const p = latest.progress;
    if (p?.stage === "modelo") {
      const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
      return { ...base, kind: "download", ring: { state: "download", opts: { progress: pct / 100 } }, reading: `${pct} %`, readingTone: "ink", caption: "Bajando el modelo de voz. Solo pasa una vez", controls: "close-ok", ringAction: null, sessionId: latest.id };
    }
    const stage = !p || p.stage === "voz" ? 0 : p.stage === "transcripcion" ? 1 : 2;
    const frac = p && p.total ? p.done / p.total : 0;
    const reading = stage === 1 && p ? `${p.done} de ${p.total}` : stage === 0 ? "Escuchando" : "Armando";
    const caption = stage === 0 ? "Buscando dónde hablaste" : stage === 1 ? "Transcribiendo lo que dijiste" : "Anclando cada cosa a su elemento";
    return { ...base, kind: "processing", ring: { state: "processing", opts: { stage, progress: frac } }, reading, readingTone: "ink", caption, controls: "close-ok", ringAction: null, sessionId: latest.id };
  }

  // Falló el procesamiento: el audio quedó guardado.
  if (latest?.status === "failed" && (!updatedAt || now - updatedAt < READY_WINDOW_MS)) {
    return { ...base, glyphs: { ...glyphs, engine: "err" }, kind: "failed", ring: { state: "error", opts: {} }, reading: "No pude transcribir", readingTone: "red", caption: "La grabación quedó guardada", controls: "retry", ringAction: null, sessionId: latest.id };
  }

  // Micrófono bloqueado, antes de grabar.
  if (mic === "denied") {
    return { ...base, kind: "mic-denied", ring: { state: "error", opts: {} }, reading: "Sin micrófono", readingTone: "red", caption: "Chrome bloqueó el permiso para QUA", controls: "grant-mic", ringAction: recordable ? "start" : null };
  }

  // Reporte recién terminado.
  if (latest?.status === "ready" && (!updatedAt || now - updatedAt < READY_WINDOW_MS)) {
    const n = latest.issues ?? 0;
    const dur = latest.durationMs ?? 0;
    const issues = spreadAngles((latest.issueTimes ?? []).map((t) => angleFor(t, dur)));
    return {
      ...base,
      kind: "ready",
      ring: { state: "ready", opts: { issues } },
      reading: n ? plural(n, "issue", "issues") : "Sin issues",
      readingTone: "ink",
      caption: `${place(latest.baseUrl ?? "")} en ${duration(dur)}`,
      controls: "ready",
      ringAction: recordable ? "start" : null,
      sessionId: latest.id,
    };
  }

  if (!recordable) {
    return { ...base, kind: "not-recordable", ring: { mini: "muted" }, reading: "Acá no se puede grabar", readingTone: "title", caption: "Chrome no deja que las extensiones vean sus páginas internas ni la Web Store. Abrí la web que querés revisar.", controls: "history", ringAction: null };
  }

  return { ...base, kind: "idle", ring: { state: "idle", opts: {} }, reading: "00:00", readingTone: "placeholder", caption: "Tocá el anillo para grabar", controls: "shortcut", ringAction: "start" };
}
