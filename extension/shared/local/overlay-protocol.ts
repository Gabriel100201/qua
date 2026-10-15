/**
 * Mensajes entre el service worker y la pastilla que el content script dibuja en la
 * página mientras se graba (diseño 2026-10, "En la página").
 */

export type OverlayState =
  | { kind: "hidden" }
  | { kind: "opening" }
  | { kind: "recording"; startedAtWall: number; marks: number }
  | { kind: "processing"; label: string; progress: number }
  | { kind: "ready"; issues: number; sessionId: string }
  | { kind: "error"; message: string };

/** SW → pestaña. */
export type OverlayMessage =
  | { type: "qua:overlay"; state: OverlayState }
  | { type: "qua:overlay-level"; levels: number[] };

/** Pestaña → SW: lo que se toca en la pastilla. */
export interface OverlayAction {
  type: "qua:overlay-action";
  action: "mark" | "stop" | "open-report" | "fix-mic";
  sessionId?: string;
}

export function isOverlayMessage(m: unknown): m is OverlayMessage {
  const t = (m as { type?: string } | null)?.type;
  return t === "qua:overlay" || t === "qua:overlay-level";
}

export function isOverlayAction(m: unknown): m is OverlayAction {
  return (m as { type?: string } | null)?.type === "qua:overlay-action";
}

/** Texto de la pastilla mientras procesa, desde la etapa guardada en la sesión. */
export function processingLabel(p?: { stage: string; done: number; total: number }): string {
  if (!p) return "Procesando";
  if (p.stage === "modelo") return `Bajando el modelo ${p.total ? Math.round((p.done / p.total) * 100) : 0} %`;
  if (p.stage === "voz") return "Buscando dónde hablaste";
  if (p.stage === "transcripcion") return `Transcribiendo ${p.done} de ${p.total}`;
  return "Armando el reporte";
}

/** Avance 0..1 de todo el procesamiento: voz 0-⅓, texto ⅓-⅔, reporte ⅔-1 (como el anillo). */
export function processingProgress(p?: { stage: string; done: number; total: number }): number {
  if (!p) return 0.05;
  const frac = p.total > 0 ? Math.min(1, p.done / p.total) : 0;
  if (p.stage === "modelo") return frac;
  if (p.stage === "voz") return frac / 3;
  if (p.stage === "transcripcion") return 1 / 3 + frac / 3;
  return 2 / 3 + frac / 3;
}
