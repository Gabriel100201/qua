import "../../shared/ui/fonts.js";
import "./options.css";
import { appIcon, miniRing, smallBars } from "../../shared/ui/ring.js";
import { icon, type IconName } from "../../shared/ui/icons.js";
import { $, el, setHtml, show, text } from "../../shared/ui/dom.js";
import { bytes, plural } from "../../shared/ui/format.js";
import { MODEL_STATE_KEY, type ModelState } from "../../shared/local/model-state.js";
import { localStore } from "../../shared/local/export.js";

/** Ajustes (diseño 2026-10, Penpot "QUA" → Ajustes). */

const withIcon = (b: HTMLElement, ic: IconName, label: string) => { b.innerHTML = icon(ic); b.append(label); };

async function renderEngine(): Promise<void> {
  const m = ((await chrome.storage.local.get(MODEL_STATE_KEY))[MODEL_STATE_KEY] as ModelState | undefined) ?? { status: "sin_descargar" };
  const ring = m.status === "listo" ? "idle" : m.status === "descargando" ? "processing" : m.status === "error" ? "error" : "muted";
  setHtml($("#engine-ring"), miniRing(ring, 44, { progress: m.status === "descargando" && m.total ? m.loaded / m.total : undefined }));
  const cpu = m.status === "listo" && m.device === "wasm";
  text($("#engine-title"), m.status === "listo" ? (cpu ? "Whisper small, sin GPU" : "Whisper large-v3-turbo en tu GPU") : m.status === "descargando" ? "Bajando el modelo" : m.status === "error" ? "No se pudo cargar el modelo" : "Todavía no se bajó");
  text($("#engine-detail"), m.status === "listo" ? (cpu ? "Tarda unas 3 veces lo que dure la grabación." : "Procesa 2,5 min de audio en alrededor de 75 s.") : m.status === "descargando" && m.total ? `${bytes(m.loaded)} de ${bytes(m.total)}` : "Se baja solo en la primera grabación (cerca de 1 GB).");
  const del = $<HTMLButtonElement>("#delete-model");
  del.disabled = m.status !== "listo";
}

async function deleteModel(): Promise<void> {
  // transformers.js guarda los pesos en la Cache API del origen de la extensión.
  for (const name of await caches.keys()) if (name.includes("transformers")) await caches.delete(name);
  await chrome.storage.local.set({ [MODEL_STATE_KEY]: { status: "sin_descargar" } satisfies ModelState });
  await renderEngine();
}

async function renderMic(): Promise<PermissionState | "unknown"> {
  let state: PermissionState | "unknown" = "unknown";
  try { state = (await navigator.permissions.query({ name: "microphone" as PermissionName })).state; } catch { /* sin API */ }
  let label = "";
  if (state === "granted") {
    const mics = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput");
    label = mics.find((d) => d.deviceId === "default")?.label.replace(/^(Predeterminado|Default) - /, "") ?? mics[0]?.label ?? "";
  }
  $("#mic-dot").className = `dot ${state === "granted" ? "" : state === "denied" ? "is-err" : "is-wait"}`;
  text($("#mic-state"), state === "granted" ? `Permitido${label ? ` · ${label}` : ""}` : state === "denied" ? "Bloqueado" : "Todavía sin permiso");
  return state;
}

/** "Probar el micrófono": 10 s de la onda en vivo, con el mismo dibujo del producto. */
async function testMic(btn: HTMLButtonElement): Promise<void> {
  btn.disabled = true;
  const bars = $("#mic-bars");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ctx = new AudioContext();
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(an);
    const buf = new Float32Array(an.fftSize);
    const hist: number[] = Array(12).fill(0.05);
    const until = Date.now() + 10_000;
    await new Promise<void>((resolve) => {
      const frame = () => {
        an.getFloatTimeDomainData(buf);
        let s = 0;
        for (const v of buf) s += v * v;
        hist.push(Math.min(1, Math.sqrt(s / buf.length) * 7));
        hist.shift();
        bars.innerHTML = smallBars(hist.map((x) => 0.1 + x * 0.9), "#1D1E20", 24, 6, 2.4);
        if (Date.now() < until) requestAnimationFrame(frame); else resolve();
      };
      frame();
    });
    stream.getTracks().forEach((t) => t.stop());
    await ctx.close();
  } catch {
    text(bars, "No pude abrir el micrófono.");
  }
  bars.innerHTML = "";
  btn.disabled = false;
  void renderMic();
}

async function renderKeys(): Promise<void> {
  const all = await chrome.commands.getAll().catch(() => [] as chrome.commands.Command[]);
  for (const [name, sel] of [["toggle_recording", "#k-rec"], ["drop_mark", "#k-mark"]] as const) {
    const sc = all.find((c) => c.name === name)?.shortcut ?? "";
    const parts = sc ? (sc.includes("+") ? sc.split("+").map((k) => (k === "Shift" ? "⇧" : k)) : [...sc]) : ["sin atajo"];
    const box = $(sel);
    box.replaceChildren(...parts.map((p) => el("span", "qua-key", p)));
  }
}

async function renderSessions(): Promise<void> {
  const [n, size] = await Promise.all([localStore().count(), localStore().approxBytes()]);
  text($("#sessions-count"), n ? plural(n, "sesión", "sesiones") : "Ninguna sesión");
  text($("#sessions-size"), n ? `${bytes(size)}, con audio y capturas` : "Lo que grabes queda acá.");
  $<HTMLButtonElement>("#delete-sessions").disabled = n === 0;
}

async function main(): Promise<void> {
  setHtml($("#app"), appIcon(32));
  for (const s of document.querySelectorAll<HTMLElement>("[data-icon]")) s.innerHTML = icon(s.dataset.icon as IconName);
  withIcon($("#delete-model"), "trash", "Borrar el modelo");
  withIcon($("#mic-test"), "mic", "Probar el micrófono");
  withIcon($("#mic-settings"), "external", "Cambiar el micrófono en Chrome");
  withIcon($("#shortcuts"), "external", "Cambiar atajos en Chrome");
  withIcon($("#delete-sessions"), "trash", "Borrar todas");
  const v = chrome.runtime.getManifest().version;
  $("#version").innerHTML = `QUA ${v} · código abierto en <a href="https://github.com/Gabriel100201/qua" target="_blank" rel="noreferrer">github.com/Gabriel100201/qua</a>`;
  void chrome.runtime.sendMessage({ type: "qua:scheme", dark: matchMedia("(prefers-color-scheme: dark)").matches }).catch(() => undefined);

  $("#delete-model").addEventListener("click", () => void deleteModel());
  $("#mic-test").addEventListener("click", (e) => void testMic(e.currentTarget as HTMLButtonElement));
  $("#mic-settings").addEventListener("click", () => void chrome.tabs.create({ url: "chrome://settings/content/microphone" }));
  $("#shortcuts").addEventListener("click", () => void chrome.tabs.create({ url: "chrome://extensions/shortcuts" }));
  $("#delete-sessions").addEventListener("click", () => show($("#confirm"), true));
  $("#confirm-no").addEventListener("click", () => show($("#confirm"), false));
  $("#confirm-yes").addEventListener("click", () => void localStore().deleteAll().then(() => { show($("#confirm"), false); void renderSessions(); }));

  await Promise.all([renderEngine(), renderMic(), renderKeys(), renderSessions()]);
  chrome.storage.onChanged.addListener((c) => { if (MODEL_STATE_KEY in c) void renderEngine(); });
}

void main();
