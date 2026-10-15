import type { Issue, TargetRef } from "@qua/protocol";

/** Mismo umbral que `report.md` (qua-protocol `UNANCHORED_CONFIDENCE`). */
export const UNANCHORED_CONFIDENCE = 0.35;

export const CATEGORY: Record<string, { label: string; icon: "bug" | "layout" | "type" | "engine" | "flag" }> = {
  bug: { label: "Bug", icon: "bug" },
  ui: { label: "Interfaz", icon: "layout" },
  copy: { label: "Textos", icon: "type" },
  perf: { label: "Rendimiento", icon: "engine" },
  idea: { label: "Idea", icon: "flag" },
};

export function split(issues: Issue[]): { anchored: Issue[]; unanchored: Issue[] } {
  const byT = [...issues].sort((a, b) => a.t - b.t);
  return { anchored: byT.filter((i) => i.anchor.confidence >= UNANCHORED_CONFIDENCE), unanchored: byT.filter((i) => i.anchor.confidence < UNANCHORED_CONFIDENCE) };
}

/** "00:04" / "1:02:41" para un t de la sesión. */
export function stamp(t: number): string {
  const s = Math.max(0, Math.floor(t / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const TAG: Record<string, string> = { button: "botón", a: "enlace", input: "campo", select: "selector", textarea: "campo de texto", img: "imagen", svg: "ícono" };
const ws = (s: string) => s.split(/\s+/).filter(Boolean).join(" ");

/** La misma frase legible que `report.md` (`human_description` de qua-core). */
export function describe(t: TargetRef): string | null {
  const tag = TAG[t.tag] ?? `<${t.tag}>`;
  if (t.text) return `El ${tag} que dice “${ws(t.text)}”.`;
  if (t.name) return `El ${tag} con nombre accesible “${t.name}”.`;
  if (t.ancestorText) return `El ${tag} sin texto propio, dentro de “${ws(t.ancestorText)}”.`;
  if (t.role) return `El ${tag} con rol ${t.role}.`;
  return null;
}

/** La evidencia de tiempo como frase: "Click, 0,7 s antes de hablar." */
export function cue(i: Issue): string | null {
  const r = i.anchor.reason.find((x) => /^(click|hover|focus|input)/.test(x));
  if (!r) return null;
  const m = /^(\w+)\s*(−|-)?([\d.]+)s/.exec(r);
  if (!m) return null;
  const kind = { click: "Click", hover: "Hover", focus: "Foco", input: "Escribiste" }[m[1] as "click"] ?? m[1];
  const secs = Number(m[3]).toFixed(1).replace(".", ",");
  return m[1] === "hover" ? `${kind} de ${secs} s.` : `${kind}, ${secs} s antes de hablar.`;
}

/** Un issue como markdown, para pegarlo solo (mismo vocabulario que report.md). */
export function issueMd(i: Issue, pageUrl?: string): string {
  const lines = [`## ${CATEGORY[i.category]?.label ?? i.category} · ${i.severity}`, `**Dicho** (${stamp(i.t)}) — "${i.text}"`];
  const t = i.anchor.target;
  if (i.anchor.kind === "element" && t) {
    lines.push(`**Ancla** \`${t.sel}\` · confianza ${i.anchor.confidence.toFixed(2)}`);
    const d = describe(t);
    if (d) lines.push(`**Elemento** ${d}`);
    if (t.classes) lines.push(`**Clases** \`${t.classes}\``);
  }
  const url = i.anchor.url ?? pageUrl;
  if (url) lines.push(`**Ruta** ${url}`);
  return lines.join("\n");
}
