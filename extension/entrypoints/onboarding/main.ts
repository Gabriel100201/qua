import "../../shared/ui/fonts.js";
import "./onboarding.css";
import { appIcon, bigRing, miniRing, smallBars } from "../../shared/ui/ring.js";
import { icon } from "../../shared/ui/icons.js";
import { $, el, setHtml, show, text } from "../../shared/ui/dom.js";
import { bytes } from "../../shared/ui/format.js";
import { MODEL_STATE_KEY, type ModelState } from "../../shared/local/model-state.js";

/**
 * Primera vez (diseño 2026-10, Penpot "QUA" → Primera vez, pantallas 0 a 7). Pasos de
 * verdad, en orden: micrófono → modelo de voz → fijar en la barra → grabar. Cada uno se
 * detecta solo cuando se puede (permiso concedido, modelo listo, extensión fijada).
 */

type Mic = "ask" | "prompting" | "denied" | "done";
interface State {
  step: 0 | 1 | 2 | 3;
  mic: Mic;
  model: ModelState;
  gpu: boolean | null;
  pinned: boolean;
}

const STEPS = ["Micrófono", "Modelo de voz", "Fijar en la barra", "Grabar"];
const st: State = { step: 0, mic: "ask", model: { status: "sin_descargar" }, gpu: null, pinned: false };

async function micState(): Promise<PermissionState | "unknown"> {
  try {
    return (await navigator.permissions.query({ name: "microphone" as PermissionName })).state;
  } catch {
    return "unknown";
  }
}

async function requestMic(): Promise<void> {
  st.mic = "prompting";
  render();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    st.mic = "done";
    st.step = 1;
    void startModel();
  } catch {
    st.mic = "denied";
  }
  render();
}

let modelStarted = false;
async function startModel(): Promise<void> {
  const stored = (await chrome.storage.local.get(MODEL_STATE_KEY))[MODEL_STATE_KEY] as ModelState | undefined;
  if (stored?.status === "listo") {
    st.model = stored;
    if (st.step === 1) st.step = 2;
    render();
    return;
  }
  if (modelStarted) return;
  modelStarted = true;
  const gpu = (navigator as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  st.gpu = gpu ? (await gpu.requestAdapter().catch(() => null)) != null : false;
  render();
  try {
    const { loadAsr } = await import("../../shared/local/engine.js");
    await loadAsr((s) => {
      st.model = s;
      void chrome.storage.local.set({ [MODEL_STATE_KEY]: s });
      render();
    });
    if (st.step === 1) st.step = 2;
  } catch (err) {
    st.model = { status: "error", message: String(err) };
    modelStarted = false;
  }
  render();
}

async function checkPinned(): Promise<void> {
  try {
    const s = await (chrome.action as unknown as { getUserSettings(): Promise<{ isOnToolbar: boolean }> }).getUserSettings();
    if (s.isOnToolbar && !st.pinned) {
      st.pinned = true;
      if (st.step === 2) st.step = 3;
      render();
    }
  } catch {
    // Chrome viejo sin getUserSettings: el paso se cierra con "Ya lo fijé".
  }
}

function pct(m: ModelState): number {
  return m.status === "descargando" && m.total > 0 ? Math.round((m.loaded / m.total) * 100) : m.status === "listo" ? 100 : 0;
}

function leftFor(): { art: string; title: string; body: string } {
  const intro = { title: "Preparemos QUA", body: "Son cuatro pasos y se hacen una sola vez." };
  if (st.step === 0) {
    if (st.mic === "denied") return { art: bigRing("error"), title: "Chrome bloqueó el micrófono", body: "Sin micrófono QUA igual registra clicks y errores, pero no lo que decís." };
    return { art: bigRing(st.mic === "prompting" ? "opening" : "idle"), ...intro };
  }
  if (st.step === 1) return { art: bigRing("download", { progress: pct(st.model) / 100 }), ...intro };
  if (st.step === 2) return { art: bigRing("idle"), title: "Tenelo a mano", body: "Fijado en la barra ves el estado sin abrir nada: el punto se pone rojo mientras graba." };
  return { art: bigRing("ready", { issues: [24, 61, 95, 150, 203, 262, 318] }), title: "Listo", body: "Abrí la página que quieras revisar, tocá el anillo y hablá sobre lo que ves." };
}

function okLine(label: string): HTMLElement {
  const p = el("p", "ok");
  p.innerHTML = icon("check");
  p.append(label);
  return p;
}

function btn(label: string, ic: Parameters<typeof icon>[0] | null, primary: boolean, onClick: () => void): HTMLButtonElement {
  const b = el("button", `qua-btn${primary ? " is-primary" : ""}`);
  b.type = "button";
  if (ic) b.innerHTML = icon(ic);
  b.append(label);
  b.addEventListener("click", onClick);
  return b;
}

async function shortcutParts(name: string): Promise<string[]> {
  try {
    const c = (await chrome.commands.getAll()).find((x) => x.name === name)?.shortcut ?? "";
    return c.includes("+") ? c.split("+").map((k) => (k === "Shift" ? "⇧" : k)) : [...c];
  } catch {
    return [];
  }
}

let keysCache: { rec: string[]; mark: string[] } | null = null;

function stepBody(i: number): HTMLElement | null {
  const body = el("div", "body");
  if (i === 0) {
    if (st.mic === "ask") {
      body.prepend(el("p", "sub", "Para escucharte mientras probás. Nada de lo que digas sale de tu navegador."));
      body.append(btn("Dar permiso al micrófono", "mic", true, () => void requestMic()));
    } else if (st.mic === "prompting") {
      body.append(el("p", "sub", "Elegí Permitir en el cartel de Chrome."));
    } else if (st.mic === "denied") {
      body.append(el("p", "sub", "Tocá el candado de la barra de direcciones y activá Micrófono."));
      const mock = el("div", "mock");
      mock.innerHTML = `<div class="mock-bar"><span class="lock">${icon("lock")}</span></div><div class="mock-row">${icon("mic")}<span>Micrófono</span><span class="sw"></span></div>`;
      body.append(mock, btn("Probar de nuevo", "retry", false, () => void requestMic()));
    }
    return body;
  }
  if (i === 1) {
    body.append(el("p", "sub", "Whisper corre en tu GPU: el audio nunca sale de Chrome."));
    if (st.gpu === false) {
      const card = el("div", "note-card");
      card.innerHTML = icon("cpu-warn");
      card.append(el("span", "", "Este equipo no tiene WebGPU. Uso un modelo más chico: tarda unas 3 veces lo que dure la grabación y se equivoca un poco más."));
      body.append(card);
    }
    if (st.model.status === "error") {
      body.append(el("p", "sub qua-red", "No pude bajar el modelo. Revisá la conexión."), btn("Reintentar", "retry", true, () => void startModel()));
      return body;
    }
    const p = el("div", "progress");
    const n = pct(st.model);
    p.innerHTML = miniRing("processing", 28, { progress: Math.max(0.04, n / 100) });
    const txt = el("div");
    txt.append(el("div", "pct qua-num", `${n} %`));
    const m = st.model;
    txt.append(el("div", "det", m.status === "descargando" && m.total ? `${bytes(m.loaded)} de ${bytes(m.total)} · podés seguir abajo mientras baja` : "Preparando la descarga"));
    p.append(txt);
    const go = el("button", "qua-link", "Seguir mientras baja");
    go.type = "button";
    go.addEventListener("click", () => { st.step = 2; render(); });
    body.append(p, go);
    return body;
  }
  if (i === 2) {
    body.append(el("p", "sub", "Abrí el rompecabezas de Chrome y tocá el chinche al lado de QUA."));
    const mock = el("div", "mock");
    mock.innerHTML = `<div class="mock-bar"><span class="omni"></span><span class="puz">${icon("puzzle")}</span></div><div class="mock-row mock-menu" style="width:220px">${appIcon(16)}<span>QUA</span><span class="pin">${icon("pin")}</span></div>`;
    const done = el("button", "qua-link", "Ya lo fijé");
    done.type = "button";
    done.addEventListener("click", () => { st.pinned = true; st.step = 3; render(); });
    body.append(mock, done);
    return body;
  }
  if (i === 3) {
    body.append(el("p", "sub", "Desde el popup o con el atajo, aunque Chrome no esté al frente:"));
    for (const [label, keys] of [["graba y detiene", keysCache?.rec ?? []], ["marca un momento", keysCache?.mark ?? []]] as const) {
      const line = el("div", "keys-line");
      const k = el("span", "qua-keys");
      for (const part of keys.length ? keys : ["sin atajo"]) k.append(el("span", "qua-key", part));
      line.append(k, label);
      body.append(line);
    }
    return body;
  }
  return null;
}

function render(): void {
  const list = $("#steps");
  list.replaceChildren();
  STEPS.forEach((name, i) => {
    const li = el("li", "step");
    const err = i === 0 && st.mic === "denied" && st.step === 0;
    li.classList.add(i < st.step ? "is-done" : i === st.step ? (err ? "is-error" : "is-current") : "is-pending");
    li.append(el("span", "node"), el("h2", "", name));
    if (i < st.step) {
      li.append(okLine(i === 0 ? "Permitido" : i === 1 ? (st.model.status === "listo" ? (st.model.device === "wasm" ? "Listo, sin GPU" : "Listo, en tu GPU") : `Bajando ${pct(st.model)} %`) : "Fijado"));
    } else if (i === st.step) {
      const b = stepBody(i);
      if (b) li.append(b);
    }
    list.append(li);
  });
  const left = leftFor();
  setHtml($("#art"), left.art);
  text($("#left-title"), left.title);
  text($("#left-body"), left.body);
  show($("#chrome-prompt"), st.step === 0 && st.mic === "prompting");
}

function showSetup(): void {
  show($("#welcome"), false);
  show($("#setup"), true);
  render();
}

async function main(): Promise<void> {
  setHtml($("#welcome-icon"), appIcon(48));
  setHtml($("#sc-ring"), miniRing("recording", 28));
  setHtml($("#sc-bars"), smallBars([0.3, 0.7, 1, 0.55, 0.8, 0.35]));
  setHtml($("#sc-ready"), miniRing("ready", 28, { n: 7 }));
  document.querySelector(".cp-ic")!.innerHTML = icon("mic");
  void chrome.runtime.sendMessage({ type: "qua:scheme", dark: matchMedia("(prefers-color-scheme: dark)").matches }).catch(() => undefined);
  keysCache = { rec: await shortcutParts("toggle_recording"), mark: await shortcutParts("drop_mark") };

  // Retomar donde corresponda: mic ya concedido, modelo ya bajado.
  const mic = await micState();
  if (mic === "granted") { st.mic = "done"; st.step = 1; }
  else if (mic === "denied") st.mic = "denied";
  const stored = (await chrome.storage.local.get(MODEL_STATE_KEY))[MODEL_STATE_KEY] as ModelState | undefined;
  if (stored) st.model = stored;
  if (st.step === 1 && stored?.status === "listo") st.step = 2;
  if (st.step >= 1) void startModel();

  // El permiso puede cambiar desde el candado de Chrome: avanzar solo.
  try {
    const perm = await navigator.permissions.query({ name: "microphone" as PermissionName });
    perm.onchange = () => {
      if (perm.state === "granted" && st.step === 0) { st.mic = "done"; st.step = 1; void startModel(); render(); }
    };
  } catch { /* sin Permissions API */ }
  setInterval(() => void checkPinned(), 1000);

  $("#start").addEventListener("click", showSetup);
  // Desde el popup ("Dar permiso al micrófono") se entra directo al paso del micrófono.
  if (location.hash === "#microfono" || st.step > 0) showSetup();
  else show($("#welcome"), true);
}

void main();
