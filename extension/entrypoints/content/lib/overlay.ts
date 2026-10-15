import { miniRing, smallBars } from "../../../shared/ui/ring.js";
import { icon } from "../../../shared/ui/icons.js";
import { clock } from "../../../shared/ui/format.js";
import { isOverlayMessage, type OverlayAction, type OverlayState } from "../../../shared/local/overlay-protocol.js";
import { QUA_UI_ATTR } from "./dom.js";
import type { Teardown } from "./hooks.js";

/**
 * La pastilla de QUA en la página (diseño 2026-10, "En la página"): acompaña la grabación
 * porque el popup se cierra apenas se toca la página. Grafito, para verse sobre cualquier
 * web; el anillo cuenta el estado igual que en el popup. Vive en un shadow DOM cerrado y
 * sus eventos no se registran (`isQuaUi`).
 */

const CSS = `
:host { all: initial; }
.pill { position: fixed; z-index: 2147483647; display: flex; align-items: center; gap: 10px; height: 44px; padding: 0 8px; border-radius: 22px;
  background: #1D1E20; color: #F4F4F1; font: 500 14px/1 "QUA Instrument Sans", system-ui, -apple-system, sans-serif; font-variant-numeric: tabular-nums;
  box-shadow: 0 6px 24px rgba(0,0,0,.18), 0 0 0 1px rgba(255,255,255,.06); cursor: grab; user-select: none; transition: opacity .2s; }
.pill.dragging { cursor: grabbing; transition: none; }
.pill.flash { box-shadow: 0 0 0 2px #1D1E20, 0 0 0 3.5px #F4F4F1, 0 6px 24px rgba(0,0,0,.18); }
.ring { display: inline-flex; width: 28px; height: 28px; }
.bars { display: inline-flex; }
.read { padding-right: 4px; white-space: nowrap; }
.read.muted { color: #B4B6B1; }
.read.red { color: #FF6A5F; }
.sep { width: 1px; height: 24px; background: #45474A; margin: 0 2px; }
button { all: unset; display: inline-flex; align-items: center; justify-content: center; height: 32px; min-width: 32px; border-radius: 16px; color: #F4F4F1; cursor: pointer; font: 600 14px/1 "QUA Instrument Sans", system-ui, sans-serif; }
button:hover { background: #34363A; }
button:focus-visible { outline: 2px solid #F4F4F1; outline-offset: 1px; }
button.text { padding: 0 12px; }
button:disabled { color: #6E7073; cursor: default; background: none; }
@media (prefers-reduced-motion: reduce) { .spin { animation: none !important; } }
@keyframes spin { to { transform: rotate(360deg); } }
.qua-spin { transform-origin: center; transform-box: view-box; animation: spin 1.2s linear infinite; }
`;

const DARK = { ink: "#F4F4F1", faint: "#5C5E61", track: "#45474A" };
type Corner = "br" | "bl" | "tr" | "tl";
const MARGIN = 24;

function ensureFont(doc: Document): void {
  if (doc.getElementById("qua-font")) return;
  const url = (w: number) => chrome.runtime.getURL(`/fonts/instrument-sans-${w}.woff2`);
  const style = doc.createElement("style");
  style.id = "qua-font";
  style.textContent = [500, 600].map((w) => `@font-face{font-family:"QUA Instrument Sans";font-weight:${w};src:url(${url(w)}) format("woff2");font-display:swap}`).join("");
  (doc.head ?? doc.documentElement).appendChild(style);
}

export function installOverlay(doc: Document = document): Teardown {
  if (typeof chrome === "undefined" || !chrome.runtime?.onMessage) return () => undefined;
  const host = doc.createElement("qua-pill");
  host.setAttribute(QUA_UI_ATTR, "");
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `<style>${CSS}</style><div class="pill" hidden></div>`;
  const pill = root.querySelector<HTMLDivElement>(".pill")!;
  let mounted = false;
  let state: OverlayState = { kind: "hidden" };
  let levels = [0.3, 0.7, 1, 0.55, 0.8, 0.35];
  let lastMarks = 0;
  let corner: Corner = "br";
  let tick: ReturnType<typeof setInterval> | undefined;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  const cornerKey = `qua:pill-corner:${location.host}`;

  const send = (action: OverlayAction["action"], sessionId?: string) =>
    chrome.runtime.sendMessage({ type: "qua:overlay-action", action, sessionId } satisfies OverlayAction).catch(() => undefined);

  function place(): void {
    const r = pill.getBoundingClientRect();
    const w = doc.documentElement.clientWidth;
    const h = doc.documentElement.clientHeight;
    pill.style.left = `${corner.endsWith("l") ? MARGIN : w - r.width - MARGIN}px`;
    pill.style.top = `${corner.startsWith("t") ? MARGIN : h - r.height - MARGIN}px`;
  }

  function mount(): void {
    if (mounted) return;
    ensureFont(doc);
    doc.documentElement.appendChild(host);
    mounted = true;
  }

  function ring(): string {
    const s = state.kind;
    const k = s === "recording" ? "recording" : s === "opening" ? "opening" : s === "processing" ? "processing" : s === "ready" ? "ready" : s === "error" ? "error" : "idle";
    return miniRing(k, 28, { ...DARK, n: state.kind === "ready" ? state.issues : 0, progress: state.kind === "processing" ? state.progress : undefined });
  }

  function render(): void {
    clearTimeout(hideTimer);
    if (state.kind === "hidden") { pill.hidden = true; return; }
    mount();
    pill.hidden = false;
    const parts: string[] = [`<span class="ring">${ring()}</span>`];
    if (state.kind === "recording" || state.kind === "opening") {
      parts.push(`<span class="bars">${smallBars(state.kind === "opening" ? Array(6).fill(0.08) : levels, state.kind === "opening" ? "#5C5E61" : "#F4F4F1")}</span>`);
    }
    if (state.kind === "opening") parts.push(`<span class="read muted">Abriendo el mic</span>`);
    if (state.kind === "recording") parts.push(`<span class="read" data-clock>${clock(Date.now() - state.startedAtWall)}</span>`);
    if (state.kind === "processing") parts.push(`<span class="read">${state.label}</span>`);
    if (state.kind === "ready") parts.push(`<span class="read">${state.issues === 1 ? "1 issue" : `${state.issues} issues`}</span><button class="text" data-act="open-report">Ver reporte</button>`);
    if (state.kind === "error") parts.push(`<span class="read red">${state.message}</span><button class="text" data-act="fix-mic">Arreglar</button>`);
    if (state.kind === "recording" || state.kind === "opening") {
      const dis = state.kind === "opening" ? " disabled" : "";
      parts.push(`<span class="sep"></span><button data-act="mark" title="Marcar un momento" aria-label="Marcar"${dis}>${icon("flag")}</button><button data-act="stop" title="Detener" aria-label="Detener">${icon("stop")}</button>`);
    }
    pill.innerHTML = parts.join("");
    place();
    // Marca nueva: la pastilla destella 600 ms y dice "Marca N".
    if (state.kind === "recording" && state.marks > lastMarks) {
      pill.classList.add("flash");
      const read = pill.querySelector("[data-clock]");
      if (read) read.textContent = `Marca ${state.marks}`;
      setTimeout(() => pill.classList.remove("flash"), 600);
    }
    if (state.kind === "recording") lastMarks = state.marks;
    if (state.kind === "ready") hideTimer = setTimeout(() => { state = { kind: "hidden" }; render(); }, 8000);
  }

  pill.addEventListener("click", (e) => {
    const b = (e.target as Element).closest("button");
    if (!b || b.disabled || moved) return;
    const act = b.dataset.act as OverlayAction["action"];
    send(act, state.kind === "ready" ? state.sessionId : undefined);
    // Detener responde al toque; el service worker confirma con el estado real.
    if (act === "stop") { state = { kind: "processing", label: "Deteniendo", progress: 0 }; render(); }
  });

  // Arrastrable a cualquier esquina; recuerda la esquina por sitio.
  let drag: { dx: number; dy: number } | null = null;
  let moved = false;
  pill.addEventListener("pointerdown", (e) => {
    if ((e.target as Element).closest("button")) { moved = false; return; }
    const r = pill.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    moved = false;
    pill.setPointerCapture(e.pointerId);
    pill.classList.add("dragging");
  });
  pill.addEventListener("pointermove", (e) => {
    if (!drag) return;
    moved = true;
    pill.style.left = `${e.clientX - drag.dx}px`;
    pill.style.top = `${e.clientY - drag.dy}px`;
  });
  pill.addEventListener("pointerup", () => {
    if (!drag) return;
    drag = null;
    pill.classList.remove("dragging");
    const r = pill.getBoundingClientRect();
    const w = doc.documentElement.clientWidth;
    const h = doc.documentElement.clientHeight;
    corner = `${r.top + r.height / 2 < h / 2 ? "t" : "b"}${r.left + r.width / 2 < w / 2 ? "l" : "r"}` as Corner;
    place();
    void chrome.storage?.local?.set({ [cornerKey]: corner }).catch(() => undefined);
  });
  const onResize = () => { if (mounted && !pill.hidden) place(); };
  window.addEventListener("resize", onResize);

  const onMessage = (m: unknown) => {
    if (!isOverlayMessage(m)) return;
    if (m.type === "qua:overlay-level") {
      if (state.kind !== "recording") return;
      // 5 niveles del micrófono → 6 barras (la última repite la primera, como un eco).
      levels = [...m.levels, m.levels[0] ?? 0].map((x) => 0.15 + x * 0.85);
      const bars = pill.querySelector(".bars");
      if (bars) bars.innerHTML = smallBars(levels, "#F4F4F1");
      return;
    }
    state = m.state;
    render();
  };
  chrome.runtime.onMessage.addListener(onMessage);

  // Si un aviso del service worker se pierde (Chrome lo recicló, la pestaña estaba en
  // segundo plano), la pastilla no puede quedar mostrando un estado viejo: se resincroniza.
  const hello = () => {
    try {
      void Promise.resolve(chrome.runtime.sendMessage?.({ type: "qua:overlay-hello" })).then((r: { state?: OverlayState } | undefined) => {
        if (!r?.state || JSON.stringify(r.state) === JSON.stringify(state)) return;
        if (r.state.kind === "recording" && state.kind === "recording") { state = r.state; return; }
        state = r.state;
        render();
      }).catch(() => undefined);
    } catch { /* contexto sin runtime (tests) o extensión recargada */ }
  };
  let ticks = 0;

  // El reloj corre en la pastilla sin esperar mensajes.
  tick = setInterval(() => {
    if (state.kind !== "hidden" && state.kind !== "ready" && ++ticks % 8 === 0) hello();
    if (state.kind !== "recording") return;
    const read = pill.querySelector("[data-clock]");
    if (read && !pill.classList.contains("flash")) read.textContent = clock(Date.now() - state.startedAtWall);
  }, 250);

  // Una pestaña recién cargada pregunta si hay algo que mostrar (navegó mientras graba).
  void chrome.storage?.local?.get(cornerKey).then((v) => { if (v[cornerKey]) corner = v[cornerKey] as Corner; }).catch(() => undefined);
  hello();

  return () => {
    chrome.runtime.onMessage.removeListener(onMessage);
    window.removeEventListener("resize", onResize);
    clearInterval(tick);
    clearTimeout(hideTimer);
    host.remove();
  };
}
