import { browser } from "wxt/browser";

/**
 * El ícono de QUA en la barra de Chrome (diseño 2026-10, "Marca en Chrome"): el mismo
 * anillo chico, que cambia con el estado sin abrir nada. Inactivo = anillo y punto;
 * grabando = punto rojo; procesando = el anillo se llena; listo = cantidad de issues en
 * el badge hasta que se abre el popup.
 *
 * El service worker no puede rasterizar SVG, así que se dibuja con Canvas 2D.
 */

export type ActionState =
  | { kind: "idle" }
  | { kind: "opening" }
  | { kind: "recording" }
  | { kind: "processing"; progress: number }
  | { kind: "ready"; issues: number };

const RED = "#E0352B";

/** Lo que usa `draw` de un CanvasRenderingContext2D (para testear sin canvas). */
export interface Ctx2D {
  clearRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  arc(x: number, y: number, r: number, a0: number, a1: number): void;
  stroke(): void;
  fill(): void;
  setLineDash(segments: number[]): void;
  lineWidth: number;
  lineCap: CanvasLineCap;
  strokeStyle: string;
  fillStyle: string;
}

export function palette(dark: boolean) {
  return dark ? { ink: "#E8E8E4", faint: "#6E7073", track: "#4A4C4F" } : { ink: "#1D1E20", faint: "#B4B6B1", track: "#D9DAD6" };
}

export function draw(ctx: Ctx2D, size: number, state: ActionState, dark = false): void {
  const { ink, faint, track } = palette(dark);
  const c = size / 2;
  const r = size / 2 - Math.max(1.4, size * 0.11);
  const sw = Math.max(1.6, size / 9);
  const top = -Math.PI / 2;
  ctx.clearRect(0, 0, size, size);
  ctx.lineCap = "round";
  ctx.lineWidth = sw;
  const ring = (color: string, dash: number[] = []) => {
    ctx.setLineDash(dash);
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  };
  const dot = (color: string, rr: number) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(c, c, rr, 0, Math.PI * 2);
    ctx.fill();
  };
  switch (state.kind) {
    case "idle":
    case "ready":
      ring(ink);
      dot(ink, size * 0.14);
      break;
    case "recording":
      ring(ink);
      dot(RED, size * 0.22);
      break;
    case "opening":
      ring(faint, [0.1, size / 5]);
      ctx.strokeStyle = ink;
      ctx.beginPath();
      ctx.arc(c, c, r, top - 0.35, top + 1.4);
      ctx.stroke();
      break;
    case "processing": {
      ring(track);
      const p = Math.max(0.06, Math.min(1, state.progress));
      ctx.strokeStyle = ink;
      ctx.beginPath();
      ctx.arc(c, c, r, top, top + p * Math.PI * 2);
      ctx.stroke();
      break;
    }
  }
}

let current = "";

/** Aplica el estado al ícono de la extensión (no hace nada si no cambió). */
export async function setActionState(state: ActionState, dark: boolean): Promise<void> {
  const key = JSON.stringify([state, dark]);
  if (key === current || typeof OffscreenCanvas === "undefined") return;
  current = key;
  const imageData: Record<string, ImageData> = {};
  for (const size of [16, 32]) {
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    draw(ctx as unknown as Ctx2D, size, state, dark);
    imageData[String(size)] = ctx.getImageData(0, 0, size, size);
  }
  try {
    await browser.action.setIcon({ imageData });
    if (state.kind === "ready" && state.issues > 0) {
      await browser.action.setBadgeBackgroundColor({ color: dark ? "#E8E8E4" : "#1D1E20" });
      await browser.action.setBadgeTextColor?.({ color: dark ? "#1D1E20" : "#FFFFFF" });
      await browser.action.setBadgeText({ text: String(state.issues) });
    } else {
      await browser.action.setBadgeText({ text: "" });
    }
    const title = { idle: "QUA", opening: "QUA: abriendo el micrófono", recording: "QUA: grabando", processing: "QUA: procesando", ready: "QUA: reporte listo" }[state.kind];
    await browser.action.setTitle({ title });
  } catch {
    current = "";
  }
}
