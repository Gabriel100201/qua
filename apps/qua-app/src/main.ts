import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openPath } from "@tauri-apps/plugin-opener";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

const app = document.getElementById("app")!;

type HealthResponse = {
  ok: boolean;
  daemon_version: string;
  uptime_ms: number;
  session: string | null;
  model_ready: boolean;
};

type SessionSummary = {
  id: string;
  base_url: string;
  started_at: string;
  duration_s: number | null;
  issue_count: number | null;
  dir: string;
};

// Ruteo mínimo por hash — una sola ventana webview reutilizada por las tres vistas
// de §09 (onboarding, pairing, sesiones). No hace falta más para un alcance "mínimo".
function router() {
  const hash = location.hash.replace(/^#\//, "") || "onboarding";
  switch (hash) {
    case "pairing":
      return renderPairing();
    case "sessions":
      return renderSessions();
    default:
      return renderOnboarding();
  }
}

window.addEventListener("hashchange", router);
window.addEventListener("DOMContentLoaded", router);

// ---------- Onboarding ----------

async function renderOnboarding() {
  app.innerHTML = `
    <h1>Onboarding</h1>

    <h2>Modelo de ASR</h2>
    <div class="row">
      <button id="btn-download">Descargar modelo</button>
      <span id="model-status" class="pill">chequeando…</span>
    </div>
    <div class="progress"><div id="model-progress" style="width:0%"></div></div>
    <div id="model-log" class="meta"></div>

    <h2>Permiso de micrófono</h2>
    <div class="row">
      <button id="btn-mic">Pedir permiso</button>
      <span id="mic-status" class="pill">desconocido</span>
    </div>

    <h2>qua doctor</h2>
    <div class="row"><button id="btn-doctor">Correr diagnóstico</button></div>
    <pre id="doctor-out"></pre>
  `;

  const modelStatus = document.getElementById("model-status")!;
  const modelProgress = document.getElementById(
    "model-progress",
  ) as HTMLDivElement;
  const modelLog = document.getElementById("model-log")!;

  invoke<{ present: boolean; path: string }>("model_status")
    .then((s) => {
      modelStatus.textContent = s.present ? "descargado" : "falta";
    })
    .catch((e) => (modelStatus.textContent = `error: ${e}`));

  document.getElementById("btn-download")!.addEventListener("click", () => {
    modelStatus.textContent = "descargando…";
    invoke("download_model").catch((e) => {
      modelLog.textContent = `error: ${e}`;
    });
  });

  await listen<{ downloaded: number; total: number }>(
    "model-download-progress",
    (ev) => {
      const { downloaded, total } = ev.payload;
      const pct = total > 0 ? Math.round((downloaded / total) * 100) : 0;
      modelProgress.style.width = `${pct}%`;
      modelLog.textContent = `${(downloaded / 1e6).toFixed(1)} MB / ${(total / 1e6).toFixed(1)} MB`;
    },
  );
  await listen<string>("model-download-done", () => {
    modelStatus.textContent = "descargado";
  });
  await listen<string>("model-download-error", (ev) => {
    modelStatus.textContent = "error";
    modelLog.textContent = ev.payload;
  });

  const micStatus = document.getElementById("mic-status")!;
  document.getElementById("btn-mic")!.addEventListener("click", async () => {
    micStatus.textContent = "pidiendo…";
    try {
      const result = await invoke<string>("request_mic_permission");
      micStatus.textContent = result;
    } catch (e) {
      micStatus.textContent = `error: ${e}`;
    }
  });

  const doctorOut = document.getElementById("doctor-out")!;
  document
    .getElementById("btn-doctor")!
    .addEventListener("click", async () => {
      doctorOut.textContent = "corriendo…";
      try {
        doctorOut.textContent = await invoke<string>("run_doctor");
      } catch (e) {
        doctorOut.textContent = `error: ${e}`;
      }
    });
}

// ---------- Pairing ----------

async function renderPairing() {
  app.innerHTML = `
    <h1>Pairing con la extensión</h1>
    <p class="meta">Pegá este código en la página de opciones de la extensión de Chrome.
    Vence a los 60 s.</p>
    <div class="code6" id="code">------</div>
    <div class="row"><button id="btn-refresh">Generar nuevo código</button></div>
  `;

  const codeEl = document.getElementById("code")!;

  async function start() {
    codeEl.textContent = "------";
    try {
      const res = await invoke<{ code: string; expires_in_ms: number }>(
        "pairing_start",
      );
      codeEl.textContent = res.code;
      setTimeout(() => {
        if (codeEl.textContent === res.code) codeEl.textContent = "------";
      }, res.expires_in_ms);
    } catch (e) {
      codeEl.textContent = "error";
      console.error(e);
    }
  }

  document.getElementById("btn-refresh")!.addEventListener("click", start);
  await start();
}

// ---------- Sesiones ----------

async function renderSessions() {
  app.innerHTML = `
    <h1>Sesiones</h1>
    <div class="row"><span id="health" class="pill">daemon: …</span></div>
    <div style="display:flex; gap:16px; align-items:flex-start;">
      <ul class="session-list" id="list" style="min-width:260px;"></ul>
      <div style="flex:1; min-width:0;">
        <div class="row" id="actions" style="display:none;">
          <button id="btn-reprocess">reprocess</button>
          <button id="btn-refine">refine</button>
          <button id="btn-reveal">revelar en Finder</button>
          <button id="btn-copy">copiar ruta</button>
          <audio id="player" controls style="display:none;"></audio>
        </div>
        <pre id="report">Elegí una sesión.</pre>
      </div>
    </div>
  `;

  invoke<HealthResponse>("daemon_health")
    .then((h) => {
      document.getElementById("health")!.textContent =
        `daemon: ok (v${h.daemon_version}, ${h.session ? "grabando " + h.session : "idle"})`;
    })
    .catch(() => {
      document.getElementById("health")!.textContent = "daemon: sin responder";
    });

  const list = document.getElementById("list")!;
  const report = document.getElementById("report")!;
  const actions = document.getElementById("actions")!;
  let selected: SessionSummary | null = null;

  let sessions: SessionSummary[] = [];
  try {
    sessions = await invoke<SessionSummary[]>("list_sessions");
  } catch (e) {
    list.innerHTML = `<li class="meta">error: ${e}</li>`;
    return;
  }

  if (sessions.length === 0) {
    list.innerHTML = `<li class="meta">Todavía no hay sesiones.</li>`;
  }

  for (const s of sessions) {
    const li = document.createElement("li");
    li.className = "session-item";
    li.innerHTML = `<div>${s.id}</div><div class="meta">${s.base_url} · ${s.issue_count ?? "?"} issues</div>`;
    li.addEventListener("click", async () => {
      document
        .querySelectorAll(".session-item")
        .forEach((el) => el.classList.remove("active"));
      li.classList.add("active");
      selected = s;
      actions.style.display = "flex";
      report.textContent = "cargando…";
      try {
        report.textContent = await invoke<string>("read_report", {
          id: s.id,
        });
      } catch (e) {
        report.textContent = `(sin report.md todavía) ${e}`;
      }
      const player = document.getElementById("player") as HTMLAudioElement;
      try {
        const audioPath = await invoke<string | null>("session_audio_path", {
          id: s.id,
        });
        if (audioPath) {
          player.src = convertFileSrc(audioPath);
          player.style.display = "block";
        } else {
          player.style.display = "none";
        }
      } catch {
        player.style.display = "none";
      }
    });
    list.appendChild(li);
  }

  document.getElementById("btn-reprocess")!.addEventListener("click", () => {
    if (selected) invoke("reprocess_session", { id: selected.id });
  });
  document.getElementById("btn-refine")!.addEventListener("click", () => {
    if (selected) invoke("refine_session", { id: selected.id });
  });
  document.getElementById("btn-reveal")!.addEventListener("click", () => {
    if (selected) openPath(selected.dir);
  });
  document.getElementById("btn-copy")!.addEventListener("click", () => {
    if (selected) writeText(selected.dir);
  });
}
