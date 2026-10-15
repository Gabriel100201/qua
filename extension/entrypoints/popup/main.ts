import "../../shared/ui/fonts.js";
import "./popup.css";
import type { StatusResponse } from "../background/internal-messages.js";
import { bigRing, miniRing } from "../../shared/ui/ring.js";
import { icon, type IconName } from "../../shared/ui/icons.js";
import { $, el, setHtml, show, text } from "../../shared/ui/dom.js";
import { duration, place, when } from "../../shared/ui/format.js";
import { copyReport, downloadSession, localStore, openReport } from "../../shared/local/export.js";
import { popupView, type MicPermission, type PopupView } from "./lib/view.js";

/**
 * Popup de QUA (diseño 2026-10, Penpot "QUA" → Popup). Consulta el estado al SW cada
 * 500 ms y lo pinta con `popupView`; la onda en vivo llega directo del offscreen.
 */

type Resp<T> = T | { ok: false; error: string };

async function send<T>(message: unknown): Promise<Resp<T>> {
  try {
    return (await chrome.runtime.sendMessage(message)) as T;
  } catch (err) {
    return { ok: false, error: `La extensión no responde: ${err instanceof Error ? err.message : String(err)}` };
  }
}

const isErr = (r: unknown): r is { ok: false; error: string } => !!r && typeof r === "object" && (r as { ok?: unknown }).ok === false;

async function micPermission(): Promise<MicPermission> {
  try {
    return (await navigator.permissions.query({ name: "microphone" as PermissionName })).state as MicPermission;
  } catch {
    return "unknown";
  }
}

async function shortcuts(): Promise<Record<string, string>> {
  try {
    const all = await chrome.commands.getAll();
    return Object.fromEntries(all.map((c) => [c.name ?? "", c.shortcut ?? ""]));
  } catch {
    return {};
  }
}

/** "⇧⌘1" / "Ctrl+Shift+1" → teclas sueltas para dibujarlas como teclas. */
export function splitShortcut(s: string): string[] {
  if (!s) return [];
  if (s.includes("+")) return s.split("+").map((k) => (k === "Shift" ? "⇧" : k));
  return [...s];
}

export function startPopup(): void {
  const ring = $<HTMLButtonElement>("#ring");
  const reading = $("#reading");
  const caption = $("#caption");
  const controls = $("#controls");
  const errorBox = $("#error");
  const glyphs = { mic: $("#g-mic"), engine: $("#g-engine"), tab: $("#g-tab") };
  setHtml(glyphs.mic, icon("mic") + '<i class="dot"></i>');
  setHtml(glyphs.engine, icon("engine") + '<i class="dot"></i>');
  setHtml(glyphs.tab, icon("tab") + '<i class="dot"></i>');
  setHtml($("#open-history"), icon("clock"));
  setHtml($("#close-history"), icon("back"));
  setHtml($("#open-settings"), icon("gear"));

  let status: StatusResponse | null = null;
  let mic: MicPermission = "unknown";
  let view: PopupView | null = null;
  let levels: number[] | undefined;
  let keys: Record<string, string> = {};
  let controlsKey = "";
  let busy = false;

  const fail = (message: string | null) => {
    errorBox.textContent = message ?? "";
    show(errorBox, !!message);
  };

  async function act(fn: () => Promise<unknown>): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      const r = await fn();
      fail(isErr(r) ? r.error : null);
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    } finally {
      busy = false;
      void refresh();
    }
  }

  function button(label: string, ic: IconName | null, kind: "" | "is-primary" | "is-icon", onClick: () => void, disabled = false): HTMLButtonElement {
    const b = el("button", `qua-btn ${kind}`);
    b.type = "button";
    if (ic) b.insertAdjacentHTML("afterbegin", icon(ic));
    if (label && kind !== "is-icon") b.append(label);
    else if (label) { b.title = label; b.setAttribute("aria-label", label); }
    if (!ic && kind !== "is-icon") b.classList.add("is-center");
    b.disabled = disabled;
    b.addEventListener("click", onClick);
    return b;
  }

  function renderControls(v: PopupView): void {
    const key = `${v.controls}|${v.sessionId ?? ""}|${JSON.stringify(keys)}`;
    if (key === controlsKey) return;
    controlsKey = key;
    controls.replaceChildren();
    switch (v.controls) {
      case "shortcut": {
        const k = splitShortcut(keys.toggle_recording ?? "");
        if (!k.length) { controls.append(el("p", "note", "Sin atajo: configuralo en Ajustes")); break; }
        const wrap = el("span", "qua-keys");
        for (const part of k) wrap.append(el("span", "qua-key", part));
        controls.append(wrap);
        break;
      }
      case "opening":
      case "recording":
        controls.append(
          button("Marcar", "flag", "", () => void act(() => send({ type: "qua:trigger-mark" })), v.controls === "opening"),
          button("Detener", "stop", "is-primary", () => void act(() => send({ type: "qua:stop-session" }))),
        );
        break;
      case "close-ok":
        controls.append(el("p", "note", "Podés cerrar esto: te aviso cuando termine"));
        break;
      case "ready":
        controls.append(
          button("Copiar reporte", "copy", "is-primary", () => void act(async () => {
            await copyReport(v.sessionId!);
            const b = controls.querySelector(".is-primary");
            if (b) { b.lastChild!.textContent = "Copiado"; setTimeout(() => { controlsKey = ""; render(); }, 1400); }
          })),
          button("Ver reporte", "external", "is-icon", () => openReport(v.sessionId!)),
          button("Descargar", "download", "is-icon", () => void act(() => downloadSession(v.sessionId!))),
        );
        break;
      case "grant-mic":
        controls.append(button("Dar permiso al micrófono", "mic", "is-primary", () => void chrome.tabs.create({ url: chrome.runtime.getURL("/onboarding.html#microfono") })));
        break;
      case "retry":
        controls.append(button("Reintentar", "retry", "is-primary", () => void act(() => send({ type: "qua:retry", sessionId: v.sessionId }))));
        break;
      case "history":
        controls.append(button("Ver sesiones anteriores", "clock", "", () => void openHistory()));
        break;
    }
  }

  function render(): void {
    if (!status) return;
    view = popupView(status, mic, Date.now());
    const v = view;
    text($("#place"), v.place || "Pestaña sin página");
    for (const k of ["mic", "engine", "tab"] as const) {
      const g = glyphs[k];
      g.title = v.tips[k];
      g.setAttribute("aria-label", v.tips[k]);
      const dot = g.querySelector(".dot")!;
      dot.className = `dot is-${v.glyphs[k]}`;
    }
    if ("mini" in v.ring) {
      ring.classList.add("is-mini");
      setHtml(ring, miniRing("muted", 44));
    } else {
      ring.classList.remove("is-mini");
      setHtml(ring, bigRing(v.ring.state, v.kind === "recording" && levels ? { ...v.ring.opts, levels } : v.ring.opts));
    }
    ring.disabled = !v.ringAction;
    if (v.ringAction) ring.dataset.action = v.ringAction; else delete ring.dataset.action;
    ring.setAttribute("aria-label", v.ringAction === "stop" ? "Detener la grabación" : v.ringAction === "start" ? "Grabar" : v.reading);
    text(reading, v.reading);
    reading.className = `reading qua-num is-${v.readingTone}`;
    text(caption, v.caption);
    renderControls(v);
  }

  async function refresh(seen = false): Promise<void> {
    const r = await send<StatusResponse>({ type: "qua:get-status", seen });
    if (isErr(r)) { fail(r.error); return; }
    status = r;
    if (r.lastError && r.phase !== "idle") fail(null);
    render();
  }

  ring.addEventListener("click", () => {
    const a = ring.dataset.action;
    if (a === "start") void act(() => send({ type: "qua:start-session" }));
    else if (a === "stop") void act(() => send({ type: "qua:stop-session" }));
  });

  // La onda en vivo: el offscreen manda los niveles del micrófono cada 100 ms.
  chrome.runtime.onMessage.addListener((m: unknown) => {
    if ((m as { type?: string })?.type === "qua:level" && view?.kind === "recording") {
      levels = (m as { levels: number[] }).levels.map((x) => 0.12 + x * 0.88);
      render();
    }
  });

  // ---- Historial ----
  async function openHistory(): Promise<void> {
    show($("#view-main"), false);
    show($("#view-history"), true);
    const list = $("#history");
    list.replaceChildren();
    const sessions = await localStore().listSessions(20);
    if (!sessions.length) { list.append(el("li", "empty", "Todavía no grabaste ninguna sesión.")); return; }
    for (const s of sessions) {
      const li = el("li");
      const n = s.issues ?? 0;
      const mini = s.status === "ready" ? miniRing("ready", 28, { n }) : s.status === "failed" ? miniRing("error", 28) : s.status === "processing" ? miniRing("processing", 28) : miniRing("idle", 28);
      li.insertAdjacentHTML("afterbegin", mini);
      const where = el("div", "where");
      where.append(el("div", "d", place(s.meta.base_url)), el("div", "m", `${when(s.meta.t0_wall)} · ${duration(s.duration_ms ?? (s.t_stop ? s.t_stop - s.meta.t0_wall : 0))}`));
      const count = el("span", `n${n ? "" : " is-zero"}`, s.status === "ready" ? (n ? String(n) : "sin issues") : s.status === "failed" ? "falló" : "…");
      const copy = el("button", "act");
      copy.type = "button";
      copy.title = "Copiar reporte";
      copy.innerHTML = icon("copy");
      copy.disabled = s.status !== "ready";
      copy.addEventListener("click", (e) => { e.stopPropagation(); void copyReport(s.id).then(() => (copy.innerHTML = icon("check"))); });
      li.append(where, count, copy);
      li.addEventListener("click", () => s.status === "ready" && openReport(s.id));
      list.append(li);
    }
  }
  $("#open-history").addEventListener("click", () => void openHistory());
  $("#close-history").addEventListener("click", () => { show($("#view-history"), false); show($("#view-main"), true); });
  $("#open-settings").addEventListener("click", () => void chrome.runtime.openOptionsPage());

  // Tema del sistema → el SW elige el ícono de la barra que se ve sobre ella.
  void send({ type: "qua:scheme", dark: matchMedia("(prefers-color-scheme: dark)").matches });

  void (async () => {
    [mic, keys] = await Promise.all([micPermission(), shortcuts()]);
    await refresh(true);
  })();
  setInterval(() => void refresh(), 500);
  setInterval(() => { if (view?.kind === "recording") render(); }, 250);
}
