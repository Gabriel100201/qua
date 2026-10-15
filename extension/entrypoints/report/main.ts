import "../../shared/ui/fonts.js";
import "./report.css";
import type { Issue, Session } from "@qua/protocol";
import { appIcon } from "../../shared/ui/ring.js";
import { icon } from "../../shared/ui/icons.js";
import { $, el, setHtml, show, text } from "../../shared/ui/dom.js";
import { clock, duration, place } from "../../shared/ui/format.js";
import { copyReport, downloadSession, getSession, localStore } from "../../shared/local/export.js";
import { CATEGORY, cue, describe, issueMd, split, stamp } from "./lib/issues.js";

/** Visor del reporte (diseño 2026-10, Penpot "QUA" → Reporte). */
async function main(): Promise<void> {
  setHtml($("#app"), appIcon(32));
  $("#to-sessions").addEventListener("click", () => void chrome.action.openPopup?.().catch(() => undefined));
  const id = new URLSearchParams(location.search).get("id") ?? (await localStore().latestSession())?.id;
  const row = id ? await getSession(id) : undefined;
  if (!row?.session_json) {
    show($("#missing"), true);
    return;
  }
  const session = JSON.parse(row.session_json) as Session;
  const dur = row.duration_ms ?? session.duration_ms ?? 0;
  document.title = `${place(row.meta.base_url)}: reporte de QUA`;
  text($("#where"), place(row.meta.base_url));
  const d = new Date(row.meta.t0_wall);
  const fecha = d.toLocaleDateString("es-AR", { day: "numeric", month: "long" });
  const hora = d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });
  const vp = session.env.viewport;
  text($("#context"), `${fecha}, ${hora}. Duró ${duration(dur)}. Chrome ${session.env.chrome.split(".")[0]} en una pantalla de ${vp.w} × ${vp.h}.`);

  // Acciones
  const copyAll = $<HTMLButtonElement>("#copy-all");
  copyAll.innerHTML = icon("copy") + "Copiar reporte";
  copyAll.addEventListener("click", () => void copyReport(row.id).then(() => {
    copyAll.lastChild!.textContent = "Copiado";
    setTimeout(() => (copyAll.lastChild!.textContent = "Copiar reporte"), 1400);
  }));
  setHtml($("#download"), icon("download"));
  $("#download").addEventListener("click", () => void downloadSession(row.id));

  // Capturas: assets/iNN.png → blob URL
  const shots = new Map<string, string>();
  for (const a of await localStore().assets(row.id)) shots.set(`assets/${a.name}`, URL.createObjectURL(new Blob([a.bytes as BlobPart], { type: "image/png" })));

  const { anchored, unanchored } = split(session.issues);

  // Línea de tiempo
  const track = $("#track");
  const pos = (t: number) => `${dur > 0 ? Math.min(100, Math.max(0, (t / dur) * 100)) : 0}%`;
  for (const m of row.mark_times ?? []) { const mk = el("span", "mk"); mk.style.left = pos(m); track.append(mk); }
  const points = new Map<string, HTMLButtonElement>();
  anchored.forEach((i) => {
    const b = el("button", "pt");
    b.type = "button";
    b.style.left = pos(i.t);
    b.title = `${stamp(i.t)}: ${i.text.slice(0, 80)}`;
    b.addEventListener("click", () => document.getElementById(`issue-${i.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
    points.set(i.id, b);
    track.append(b);
  });
  const ticks = $("#ticks");
  for (let k = 0; k <= 4; k++) { const s = el("span", "", clock((dur * k) / 4)); s.style.left = `${k * 25}%`; ticks.append(s); }

  // Filtros por tipo (solo los que aparecen)
  let filter: string | null = null;
  const counts = new Map<string, number>();
  for (const i of anchored) counts.set(i.category, (counts.get(i.category) ?? 0) + 1);
  const filters = $("#filters");
  const renderFilters = () => {
    filters.replaceChildren();
    const chip = (key: string | null, label: string, n: number, ic?: Parameters<typeof icon>[0]) => {
      const b = el("button", `chip${filter === key ? " is-on" : ""}`);
      b.type = "button";
      if (ic) b.innerHTML = icon(ic);
      b.append(label, el("span", "c", String(n)));
      b.addEventListener("click", () => { filter = key; renderFilters(); renderIssues(); });
      filters.append(b);
    };
    chip(null, "Todos", anchored.length);
    for (const [k, n] of counts) chip(k, CATEGORY[k]?.label ?? k, n, CATEGORY[k]?.icon);
  };

  const list = $("#issues");
  const renderIssues = () => {
    list.replaceChildren();
    for (const i of anchored.filter((x) => !filter || x.category === filter)) list.append(card(i));
    if (!anchored.length) list.append(el("li", "qua-gray", "No quedó ningún issue anclado a un elemento o una ruta."));
  };

  function card(i: Issue): HTMLLIElement {
    const li = el("li", "issue");
    li.id = `issue-${i.id}`;
    const shot = i.evidence.screenshot ? shots.get(i.evidence.screenshot) : undefined;
    if (!shot) li.classList.add("no-shot");
    const left = el("div");
    const meta = el("div", "meta");
    meta.append(el("span", "qua-num", stamp(i.t)));
    const cat = el("span", "cat");
    cat.innerHTML = icon(CATEGORY[i.category]?.icon ?? "flag");
    cat.append(CATEGORY[i.category]?.label ?? i.category);
    const copy = el("button", "copy");
    copy.type = "button";
    copy.title = "Copiar este issue";
    copy.setAttribute("aria-label", "Copiar este issue");
    copy.innerHTML = icon("copy");
    copy.addEventListener("click", () => void navigator.clipboard.writeText(issueMd(i, row!.meta.base_url)).then(() => { copy.innerHTML = icon("check"); setTimeout(() => (copy.innerHTML = icon("copy")), 1400); }));
    meta.append(cat, copy);
    left.append(meta, el("p", "said", `“${i.text}”`));
    const t = i.anchor.target;
    const anchor = el("div", "anchor");
    anchor.innerHTML = icon("anchor");
    anchor.append(el("code", "sel", i.anchor.kind === "element" && t ? t.sel : (i.anchor.url ? new URL(i.anchor.url).pathname : "Toda la sesión")));
    left.append(anchor);
    const parts = [t ? describe(t) : null, cue(i)].filter(Boolean).join(" ");
    if (parts) left.append(el("p", "el", parts));
    li.append(left);
    if (shot) {
      const fig = el("div", "shot");
      const img = el("img");
      img.src = shot;
      img.alt = t ? describe(t) ?? "Captura del elemento" : "Captura";
      fig.append(img);
      li.append(fig);
    }
    li.addEventListener("mouseenter", () => { points.get(i.id)?.classList.add("is-on"); li.classList.add("is-on"); });
    li.addEventListener("mouseleave", () => { points.get(i.id)?.classList.remove("is-on"); li.classList.remove("is-on"); });
    return li;
  }

  renderFilters();
  renderIssues();

  if (unanchored.length) {
    show($("#unanchored-wrap"), true);
    const ul = $("#unanchored");
    for (const i of unanchored) {
      const li = el("li");
      li.append(el("span", "t", stamp(i.t)), el("span", "", `“${i.text}”`));
      ul.append(li);
    }
  }
  text($("#transcript"), row.transcript ?? "");
}

void main();
