/**
 * El anillo: el elemento que cuenta el estado de QUA en todas las superficies (diseño
 * 2026-10, Penpot "QUA", página Sistema). Mismo dibujo que la marca: anillo + punto
 * central + la onda de voz que lo atraviesa. Genera SVG como string para usarlo igual en
 * el popup, las páginas de la extensión y el shadow DOM de la pastilla.
 *
 * La geometría es la de `assets/generate.py` y la del diseño; no inventar valores acá.
 */

export const INK = "#1D1E20";
export const GRAY = "#6B6D70";
export const FAINT = "#C4C6C1";
export const TRACK = "#D9DAD6";
export const RED = "#E0352B";
export const SCREEN = "#F4F4F1";

/** Alturas de las barras de afuera, del borde hacia el anillo (se espejan del otro lado). */
const OUTER = [0.22, 0.42, 0.78, 1.0, 0.58];
const W = 300;
const H = 170;
const CX = 150;
const CY = 85;
const R = 56;

export type RingState = "idle" | "opening" | "recording" | "processing" | "download" | "ready" | "error";

export interface RingOptions {
  /** recording: alturas de las 5 barras de cada lado, 0..1 (nivel del micrófono). */
  levels?: number[];
  /** recording: ángulos (grados, 0 = arriba) de las muescas de cada marca. */
  marks?: number[];
  /** processing / download: avance 0..1 del arco. */
  progress?: number;
  /** processing: etapa actual (0 voz, 1 texto, 2 reporte). */
  stage?: number;
  /** ready: ángulos de los puntos, uno por issue. */
  issues?: number[];
}

const f = (n: number) => n.toFixed(2);

function pt(a: number, r = R, cx = CX, cy = CY): [number, number] {
  const t = ((a - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(t), cy + r * Math.sin(t)];
}

function arc(a0: number, a1: number, r = R, cx = CX, cy = CY): string {
  const span = Math.max(0.01, Math.min(359.99, a1 - a0));
  const [x0, y0] = pt(a0, r, cx, cy);
  const [x1, y1] = pt(a0 + span, r, cx, cy);
  return `M${f(x0)},${f(y0)} A${r},${r} 0 ${span > 180 ? 1 : 0} 1 ${f(x1)},${f(y1)}`;
}

function bars(color: string, heights: number[] | null, inner: boolean, innerColor?: string): string {
  const unit = R * 0.9;
  const step = R * 0.3;
  const hs = heights ?? [...OUTER].reverse();
  let out = "";
  for (const side of [-1, 1]) {
    if (inner) {
      const x = CX + side * R * 0.5;
      const h = unit * 0.32;
      out += `<line x1="${f(x)}" y1="${f(CY - h / 2)}" x2="${f(x)}" y2="${f(CY + h / 2)}" stroke="${innerColor ?? color}" stroke-width="2.6" stroke-linecap="round"/>`;
    }
    const start = CX + side * (R + step * 0.85);
    hs.forEach((k, i) => {
      const x = start + side * i * step;
      const h = Math.max(3, unit * k);
      out += `<line class="qua-bar" x1="${f(x)}" y1="${f(CY - h / 2)}" x2="${f(x)}" y2="${f(CY + h / 2)}" stroke="${color}" stroke-width="2.6" stroke-linecap="round"/>`;
    });
  }
  return out;
}

const svg = (body: string, cls = "") =>
  `<svg class="qua-ring ${cls}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">${body}</svg>`;
const ring = (color: string, extra = "") =>
  `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="${color}" stroke-width="2.4" ${extra}/>`;
const dot = (color: string, r = 8) => `<circle cx="${CX}" cy="${CY}" r="${r}" fill="${color}"/>`;

/** Las tres paradas del procesamiento sobre el anillo: voz (0°), texto (120°), reporte (240°). */
function stops(stage: number): string {
  return [0, 120, 240]
    .map((a, i) => {
      const [x, y] = pt(a);
      if (i < stage) return `<circle cx="${f(x)}" cy="${f(y)}" r="5" fill="${INK}"/>`;
      if (i === stage)
        return `<circle cx="${f(x)}" cy="${f(y)}" r="6" fill="${SCREEN}" stroke="${INK}" stroke-width="2.4"/><circle cx="${f(x)}" cy="${f(y)}" r="2.4" fill="${INK}"/>`;
      return `<circle cx="${f(x)}" cy="${f(y)}" r="5" fill="${SCREEN}" stroke="${FAINT}" stroke-width="2.2"/>`;
    })
    .join("");
}

/** El anillo grande (popup, primera vez, ajustes). */
export function bigRing(state: RingState, o: RingOptions = {}): string {
  switch (state) {
    case "idle":
      return svg(bars(FAINT, null, true, INK) + ring(INK) + dot(INK), "is-idle");
    case "opening":
      return svg(
        bars(TRACK, Array(5).fill(0.06), false) +
          ring(FAINT, 'stroke-dasharray="2 7" stroke-linecap="round"') +
          `<g class="qua-spin"><path d="${arc(-20, 70)}" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/></g>` +
          `<circle cx="${CX}" cy="${CY}" r="7" fill="none" stroke="${GRAY}" stroke-width="2"/>`,
        "is-opening",
      );
    case "recording": {
      const marks = (o.marks ?? [])
        .map((a) => {
          const [x0, y0] = pt(a, R + 5);
          const [x1, y1] = pt(a, R + 12);
          return `<line x1="${f(x0)}" y1="${f(y0)}" x2="${f(x1)}" y2="${f(y1)}" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>`;
        })
        .join("");
      return svg(
        bars(INK, o.levels ?? [0.35, 0.8, 0.5, 1.0, 0.62], true) +
          ring(INK) +
          marks +
          `<circle class="qua-halo" cx="${CX}" cy="${CY}" r="17" fill="${RED}" fill-opacity="0.14"/>` +
          dot(RED, 9),
        "is-recording",
      );
    }
    case "processing": {
      const stage = o.stage ?? 0;
      const p = Math.max(0, Math.min(1, o.progress ?? 0));
      const end = stage * 120 + p * 120;
      return svg(
        ring(TRACK) +
          (end > 0.5 ? `<path d="${arc(0, end)}" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>` : "") +
          stops(stage),
        "is-processing",
      );
    }
    case "download": {
      const end = 360 * Math.max(0, Math.min(1, o.progress ?? 0));
      const [ex, ey] = pt(end);
      return svg(
        ring(TRACK) +
          (end > 0.5
            ? `<path d="${arc(0, end)}" fill="none" stroke="${INK}" stroke-width="2.6" stroke-dasharray="0.1 6.5" stroke-linecap="round"/><circle cx="${f(ex)}" cy="${f(ey)}" r="4.2" fill="${INK}"/>`
            : ""),
        "is-download",
      );
    }
    case "ready":
      return svg(
        bars(TRACK, null, false) +
          ring(INK) +
          (o.issues ?? [])
            .map((a, i) => {
              const [x, y] = pt(a);
              return `<circle class="qua-issue" style="--i:${i}" cx="${f(x)}" cy="${f(y)}" r="5.2" fill="${INK}" stroke="${SCREEN}" stroke-width="2.4"/>`;
            })
            .join(""),
        "is-ready",
      );
    case "error":
      return svg(
        `<path d="${arc(32, 352)}" fill="none" stroke="${RED}" stroke-width="2.4" stroke-linecap="round"/>` +
          `<circle cx="${CX}" cy="${CY}" r="7" fill="none" stroke="${RED}" stroke-width="2"/>` +
          bars(TRACK, Array(5).fill(0.06), false),
        "is-error",
      );
  }
}

export type MiniState = "idle" | "recording" | "opening" | "processing" | "ready" | "muted" | "error";

/**
 * El anillo chico: barra de Chrome (16), historial (28), pastilla (28), ajustes (44).
 * `n` = cantidad de issues en "ready" (se dibujan como mucho 12 puntos).
 */
export function miniRing(state: MiniState, d = 28, opts: { n?: number; progress?: number; ink?: string; faint?: string; track?: string } = {}): string {
  const ink = opts.ink ?? INK;
  const faint = opts.faint ?? FAINT;
  const track = opts.track ?? TRACK;
  const c = d / 2;
  const r = d / 2 - 2.2;
  const sw = Math.max(1.6, d / 14);
  const P = (a: number) => pt(a, r, c, c);
  const A = (a0: number, a1: number) => arc(a0, a1, r, c, c);
  const ring = `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${ink}" stroke-width="${f(sw)}"/>`;
  let body = "";
  switch (state) {
    case "idle":
      body = ring + `<circle cx="${c}" cy="${c}" r="${f(d * 0.13)}" fill="${ink}"/>`;
      break;
    case "recording":
      body = ring + `<circle cx="${c}" cy="${c}" r="${f(d * 0.2)}" fill="${RED}"/>`;
      break;
    case "opening":
      body =
        `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${faint}" stroke-width="${f(sw)}" stroke-dasharray="1 ${f(d / 9)}" stroke-linecap="round"/>` +
        `<g class="qua-spin"><path d="${A(-20, 80)}" fill="none" stroke="${ink}" stroke-width="${f(sw)}" stroke-linecap="round"/></g>`;
      break;
    case "processing": {
      const end = 360 * Math.max(0.05, Math.min(1, opts.progress ?? 0.55));
      body = `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${track}" stroke-width="${f(sw)}"/><path d="${A(0, end)}" fill="none" stroke="${ink}" stroke-width="${f(sw)}" stroke-linecap="round"/>`;
      break;
    }
    case "ready": {
      const n = Math.max(0, Math.min(12, opts.n ?? 0));
      if (n === 0) {
        body = ring + `<circle cx="${c}" cy="${c}" r="${f(d * 0.13)}" fill="${ink}"/>`;
        break;
      }
      body = `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${faint}" stroke-width="${f(Math.max(1.2, sw * 0.7))}"/>`;
      for (let i = 0; i < n; i++) {
        const [x, y] = P((i * 360) / n + 15);
        body += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(Math.max(2.2, d * 0.1))}" fill="${ink}"/>`;
      }
      break;
    }
    case "muted":
      body = `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${faint}" stroke-width="${f(sw)}"/><path d="M${f(c - r * 0.7)},${f(c + r * 0.7)} L${f(c + r * 0.7)},${f(c - r * 0.7)}" stroke="${faint}" stroke-width="${f(sw)}" stroke-linecap="round"/>`;
      break;
    case "error":
      body = `<path d="${A(32, 352)}" fill="none" stroke="${RED}" stroke-width="${f(sw)}" stroke-linecap="round"/>`;
      break;
  }
  return `<svg class="qua-mini" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${d} ${d}" width="${d}" height="${d}" aria-hidden="true">${body}</svg>`;
}

/** Ícono de app: cuadrado grafito, anillo claro, punto y las barras de adentro (desde 32 px). */
export function appIcon(d: number): string {
  const c = d / 2;
  const R2 = d * 0.3;
  const sw = Math.max(1.4, d * 0.045);
  let body = `<rect width="${d}" height="${d}" rx="${f(d * 0.22)}" fill="${INK}"/><circle cx="${c}" cy="${c}" r="${f(R2)}" fill="none" stroke="${SCREEN}" stroke-width="${f(sw)}"/><circle cx="${c}" cy="${c}" r="${f(d * 0.075)}" fill="${SCREEN}"/>`;
  if (d >= 32) {
    const h = d * 0.16;
    for (const side of [-1, 1]) {
      const x = c + side * R2 * 0.52;
      body += `<line x1="${f(x)}" y1="${f(c - h / 2)}" x2="${f(x)}" y2="${f(c + h / 2)}" stroke="${SCREEN}" stroke-width="${f(sw * 1.05)}" stroke-linecap="round"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${d} ${d}" width="${d}" height="${d}" aria-hidden="true">${body}</svg>`;
}

/** Onda chica de 6 barras (pastilla, ajustes). `levels` 0..1. */
export function smallBars(levels: number[], color = INK, h = 20, step = 5, sw = 2): string {
  const w = step * (levels.length - 1) + sw * 2;
  const lines = levels
    .map((k, i) => {
      const half = Math.max(1.5, (k * h) / 2);
      return `<line x1="${sw + i * step}" y1="${f(h / 2 - half + 1)}" x2="${sw + i * step}" y2="${f(h / 2 + half - 1)}" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"/>`;
    })
    .join("");
  return `<svg class="qua-bars" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">${lines}</svg>`;
}

/**
 * Ángulo sobre el anillo para un instante de la sesión: el reloj de la sesión es la
 * vuelta entera. Así los puntos de los issues y las muescas de las marcas quedan donde
 * pasaron.
 */
export function angleFor(tMs: number, durationMs: number): number {
  if (durationMs <= 0) return 0;
  return (Math.max(0, Math.min(1, tMs / durationMs)) * 360) % 360;
}

/** Separa puntos que caerían encimados (mínimo `gap` grados), sin cambiar el orden. */
export function spreadAngles(angles: number[], gap = 14): number[] {
  const out: number[] = [];
  for (const a of [...angles].sort((x, y) => x - y)) {
    const prev = out.at(-1);
    out.push(prev !== undefined && a - prev < gap ? prev + gap : a);
  }
  return out.map((a) => a % 360);
}
