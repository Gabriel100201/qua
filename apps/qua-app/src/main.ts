import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

const app = document.getElementById("app")!;

type HealthResponse = {
  ok: boolean;
  daemon_version: string;
  uptime_ms: number;
  session: string | null;
  model_ready: boolean;
};

type SessionStatus = "recording" | "processing" | "ready" | "failed" | "interrupted";

type SessionSummary = {
  id: string;
  base_url: string;
  started_at: string;
  status: SessionStatus;
  title: string | null;
  project: string | null;
  duration_ms: number | null;
  issue_count: number | null;
  unanchored_count: number;
  categories: Record<string, number>;
  has_refined: boolean;
  dir: string;
};

type Issue = {
  id: string;
  t: number;
  text: string;
  category: string;
  severity: string;
  anchor: {
    kind: "element" | "route" | "session";
    url?: string;
    confidence: number;
    reason?: string[];
    target?: { sel: string; tag: string; name?: string; text?: string };
  };
};

// Lo que una vista deja corriendo (polling, timers) y hay que cortar al cambiar de ruta.
let leaveView: (() => void) | null = null;

// Ruteo mínimo por hash — una sola ventana webview reutilizada por las tres vistas
// de §09 (onboarding, pairing, sesiones). No hace falta más para un alcance "mínimo".
function router() {
  leaveView?.();
  leaveView = null;
  const hash = location.hash.replace(/^#\//, "") || "onboarding";
  document.querySelectorAll<HTMLAnchorElement>(".tabs a").forEach((a) => {
    a.classList.toggle("active", a.getAttribute("href") === `#/${hash}`);
  });
  app.className = `view-${hash}`;
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
    <h1>QUA está casi listo</h1>
    <p>El daemon ya se inicia y se supervisa solo. No hace falta abrir una terminal ni editar <code>config.toml</code>.</p>
    <p class="callout"><strong>Build sin firmar:</strong> si macOS bloqueó la app, abrila con clic derecho → Abrir o habilitala en Configuración del Sistema → Privacidad y seguridad.</p>

    <h2>1. Instalar la extensión de Chrome</h2>
    <ol>
      <li>Abrí <code>chrome://extensions</code>.</li>
      <li>Activá <strong>Modo de desarrollador</strong>.</li>
      <li>Elegí <strong>Cargar descomprimida</strong> y seleccioná esta carpeta:</li>
    </ol>
    <div class="path-row"><code id="extension-path">buscando…</code><button id="btn-copy-extension">Copiar ruta</button></div>
    <p class="callout"><strong>Importante:</strong> después de instalar la extensión, recargá la pestaña que quieras grabar. El popup también te lo va a recordar con un botón visible.</p>

    <h2>2. Modelo de voz</h2>
    <div class="row">
      <button id="btn-download">Descargar modelo</button>
      <span id="model-status" class="pill">chequeando…</span>
    </div>
    <div class="progress"><div id="model-progress" style="width:0%"></div></div>
    <div id="model-log" class="meta"></div>

    <h2>3. Permiso de micrófono</h2>
    <div class="row">
      <button id="btn-mic">Pedir permiso</button>
      <span id="mic-status" class="pill">desconocido</span>
    </div>

    <h2>4. Verificación</h2>
    <div class="row"><button id="btn-doctor">Correr diagnóstico</button></div>
    <pre id="doctor-out"></pre>
  `;

  const extensionPath = document.getElementById("extension-path")!;
  invoke<string>("extension_path").then((path) => { extensionPath.textContent = path; }).catch((e) => { extensionPath.textContent = `error: ${e}`; });
  document.getElementById("btn-copy-extension")!.addEventListener("click", () => writeText(extensionPath.textContent ?? ""));

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

const ICON = {
  copy: `<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8"/></svg>`,
  check: `<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`,
  redo: `<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14.5-4M4 4v4h4M4 13a8 8 0 0 0 14.5 4M20 20v-4h-4"/></svg>`,
  spark: `<svg viewBox="0 0 24 24"><path d="M12 3.5l1.8 5.2 5.2 1.8-5.2 1.8L12 17.5l-1.8-5.2L5 10.5l5.2-1.8zM18.5 16.5v4M16.5 18.5h4"/></svg>`,
  folder: `<svg viewBox="0 0 24 24"><path d="M3.5 7A2.5 2.5 0 0 1 6 4.5h3.5l2 2.5H18A2.5 2.5 0 0 1 20.5 9.5v7A2.5 2.5 0 0 1 18 19H6a2.5 2.5 0 0 1-2.5-2.5z"/></svg>`,
  clock: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
  calendar: `<svg viewBox="0 0 24 24"><rect x="4" y="5.5" width="16" height="14.5" rx="2.5"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/></svg>`,
  target: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>`,
  route: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18"/></svg>`,
  mic: `<svg viewBox="0 0 24 24"><rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/></svg>`,
  warn: `<svg viewBox="0 0 24 24"><path d="M12 4.5l8.5 14.5h-17zM12 10v4.5M12 16.8v.2"/></svg>`,
  external: `<svg viewBox="0 0 24 24"><path d="M13.5 5H19v5.5M19 5l-8.5 8.5M10 6.5H6.5A1.5 1.5 0 0 0 5 8v9.5A1.5 1.5 0 0 0 6.5 19H16a1.5 1.5 0 0 0 1.5-1.5V14"/></svg>`,
  inbox: `<svg viewBox="0 0 24 24"><path d="M4 13.5l2.5-8h11l2.5 8v5H4zM4 13.5h4.5l1 2h5l1-2H20"/></svg>`,
};

const CATEGORY: Record<string, { label: string; color: string }> = {
  ui: { label: "UI", color: "var(--det)" },
  bug: { label: "Bug", color: "var(--trig)" },
  perf: { label: "Performance", color: "var(--human)" },
  copy: { label: "Texto", color: "var(--data)" },
  idea: { label: "Idea", color: "var(--ia)" },
};
const SEVERITY: Record<string, string> = { low: "baja", med: "media", high: "alta" };
const AVATAR_COLORS = ["#58b9cc", "#b392ff", "#f2b451", "#3ecf8e", "#ff6d5a", "#7aa2ff"];

function esc(value: unknown): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function siteOf(rawUrl: string): { host: string; path: string } {
  try {
    const u = new URL(rawUrl);
    return { host: u.host.replace(/^www\./, ""), path: u.pathname === "/" ? "" : u.pathname };
  } catch {
    return { host: rawUrl, path: "" };
  }
}

function avatar(host: string): string {
  let hash = 0;
  for (const ch of host) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const color = AVATAR_COLORS[hash % AVATAR_COLORS.length];
  const letter = (host.replace(/^localhost.*/, "L")[0] ?? "?").toUpperCase();
  return `<span class="avatar" style="--c:${color}">${esc(letter)}</span>`;
}

function sessionName(s: SessionSummary): string {
  return s.title || s.project || siteOf(s.base_url).host;
}

function dayLabel(date: Date): string {
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(new Date()) - startOf(date)) / 86_400_000);
  if (days === 0) return "Hoy";
  if (days === 1) return "Ayer";
  const opts: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long" };
  if (date.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
  const label = date.toLocaleDateString("es", opts);
  return label[0].toUpperCase() + label.slice(1);
}

function clockTime(date: Date): string {
  return date.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
}

function duration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const sec = total % 60;
  if (m >= 60) return `${Math.floor(m / 60)} h ${m % 60} min`;
  return m > 0 ? `${m} min ${sec} s` : `${sec} s`;
}

function stopwatch(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function issuesLabel(n: number): string {
  return n === 1 ? "1 comentario" : `${n} comentarios`;
}

function statusBadge(s: SessionSummary): string {
  switch (s.status) {
    case "recording":
      return `<span class="badge rec"><i class="pulse"></i>Grabando <b data-elapsed="${esc(s.started_at)}"></b></span>`;
    case "processing":
      return `<span class="badge proc"><i class="spinner"></i>Procesando…</span>`;
    case "failed":
      return `<span class="badge warn">Sin procesar</span>`;
    case "interrupted":
      return `<span class="badge off">Interrumpida</span>`;
    default: {
      const n = s.issue_count ?? 0;
      return `<span class="badge ${n > 0 ? "ok" : "off"}">${n > 0 ? issuesLabel(n) : "Sin comentarios"}</span>`;
    }
  }
}

function categoryChips(categories: Record<string, number>): string {
  return Object.entries(categories)
    .map(([key, n]) => {
      const cat = CATEGORY[key] ?? { label: key, color: "var(--mute)" };
      return `<span class="chip" style="--c:${cat.color}"><i></i>${n} ${esc(cat.label)}</span>`;
    })
    .join("");
}

function issueCard(issue: Issue, index: number): string {
  const cat = CATEGORY[issue.category] ?? { label: issue.category, color: "var(--mute)" };
  const anchored = issue.anchor.confidence >= 0.35;
  const pct = Math.round(issue.anchor.confidence * 100);
  const target = issue.anchor.target;
  const where =
    issue.anchor.kind === "element" && target
      ? `<div class="anchor">${ICON.target}<div><span class="anchor-name">${esc(target.name || target.text || `<${target.tag}>`)}</span><code>${esc(target.sel)}</code></div></div>`
      : issue.anchor.url
        ? `<div class="anchor">${ICON.route}<div><span class="anchor-name">Página</span><code>${esc(siteOf(issue.anchor.url).path || "/")}</code></div></div>`
        : "";
  return `
    <article class="issue" style="--c:${cat.color}">
      <header>
        <span class="issue-n">${String(index + 1).padStart(2, "0")}</span>
        <span class="chip" style="--c:${cat.color}"><i></i>${esc(cat.label)}</span>
        <span class="sev sev-${esc(issue.severity)}">Severidad ${esc(SEVERITY[issue.severity] ?? issue.severity)}</span>
        <span class="issue-t">${ICON.clock}${stopwatch(issue.t)}</span>
      </header>
      <blockquote>${esc(issue.text)}</blockquote>
      ${where}
      <footer>
        ${
          anchored
            ? `<span class="conf"><span class="conf-bar"><i style="width:${pct}%"></i></span>Confianza ${pct}%</span>`
            : `<span class="badge off">Sin anclar a un elemento</span>`
        }
      </footer>
    </article>`;
}

async function renderSessions() {
  app.innerHTML = `
    <aside class="sessions-side">
      <div class="side-head"><h1>Sesiones</h1><span id="count" class="meta"></span></div>
      <div class="session-list" id="list"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>
    </aside>
    <section class="detail" id="detail"></section>
  `;

  const list = document.getElementById("list")!;
  const detail = document.getElementById("detail")!;
  const count = document.getElementById("count")!;

  let sessions: SessionSummary[] = [];
  let selectedId: string | null = null;
  let tab: "issues" | "report" | "refined" = "issues";
  let listKey = "";
  let detailKey = "";
  let alive = true;
  // Reprocess/refine en curso, por sesión: los lanza esta ventana, no el daemon.
  const busy = new Map<string, "reprocess" | "refine">();

  const emptyDetail = (icon: string, title: string, text: string, extra = "") =>
    `<div class="empty">${icon}<h2>${title}</h2><p>${text}</p>${extra}</div>`;

  function renderList() {
    count.textContent = sessions.length ? `${sessions.length}` : "";
    if (sessions.length === 0) {
      list.innerHTML = `<div class="empty small">${ICON.inbox}<p>Todavía no hay sesiones. Grabá la primera desde el popup de la extensión.</p></div>`;
      return;
    }
    let html = "";
    let lastDay = "";
    for (const s of sessions) {
      const date = new Date(s.started_at);
      const day = dayLabel(date);
      if (day !== lastDay) {
        html += `<div class="day">${esc(day)}</div>`;
        lastDay = day;
      }
      const site = siteOf(s.base_url);
      html += `
        <button type="button" class="session-item${s.id === selectedId ? " active" : ""}" data-id="${esc(s.id)}">
          ${avatar(site.host)}
          <span class="session-body">
            <span class="session-title">${esc(sessionName(s))}</span>
            <span class="session-url">${esc(site.host)}<em>${esc(site.path)}</em></span>
            <span class="session-foot">
              <span class="meta">${clockTime(date)}${s.duration_ms != null ? ` · ${duration(s.duration_ms)}` : ""}</span>
              ${busy.has(s.id) ? `<span class="badge proc"><i class="spinner"></i>Procesando…</span>` : statusBadge(s)}
            </span>
          </span>
        </button>`;
    }
    list.innerHTML = html;
    tickElapsed();
  }

  async function renderDetail() {
    const s = sessions.find((x) => x.id === selectedId);
    if (!s) {
      detail.innerHTML = emptyDetail(
        ICON.inbox,
        "Elegí una sesión",
        "Vas a ver cada comentario que hiciste en voz alta, anclado al elemento o la página donde lo dijiste.",
      );
      return;
    }
    const site = siteOf(s.base_url);
    const date = new Date(s.started_at);
    const working = busy.get(s.id);
    const ready = s.status === "ready";
    const canProcess = s.status === "ready" || s.status === "failed" || s.status === "interrupted";

    detail.innerHTML = `
      <header class="detail-head">
        ${avatar(site.host)}
        <div class="detail-title">
          <h1>${esc(sessionName(s))}</h1>
          <button type="button" class="link" id="btn-url" title="Abrir en el navegador">${esc(site.host + site.path)}${ICON.external}</button>
        </div>
        ${working ? `<span class="badge proc"><i class="spinner"></i>${working === "refine" ? "Refinando…" : "Reprocesando…"}</span>` : statusBadge(s)}
      </header>
      <div class="facts">
        <span class="fact">${ICON.calendar}${esc(dayLabel(date))}, ${clockTime(date)}</span>
        ${s.duration_ms != null ? `<span class="fact">${ICON.clock}${duration(s.duration_ms)}</span>` : ""}
        ${s.project ? `<span class="fact">${ICON.folder}${esc(s.project)}</span>` : ""}
        ${categoryChips(s.categories)}
        ${s.unanchored_count > 0 ? `<span class="chip" style="--c:var(--mute)"><i></i>${s.unanchored_count} sin anclar</span>` : ""}
      </div>
      <div class="toolbar">
        <button type="button" class="primary" id="btn-copy" ${ready ? "" : "disabled"}>${ICON.copy}<span>Copiar reporte</span></button>
        <button type="button" id="btn-reprocess" ${canProcess && !working ? "" : "disabled"} title="Vuelve a transcribir y anclar con la configuración actual">${ICON.redo}<span>Reprocesar</span></button>
        <button type="button" id="btn-refine" ${ready && !working ? "" : "disabled"} title="Reescribe cada comentario como una tarea">${ICON.spark}<span>Refinar</span></button>
        <button type="button" id="btn-reveal">${ICON.folder}<span>Mostrar en Finder</span></button>
      </div>
      <audio id="player" controls hidden></audio>
      <div id="notice"></div>
      <div id="content"></div>
    `;

    const content = document.getElementById("content")!;
    const notice = document.getElementById("notice")!;

    document.getElementById("btn-url")!.addEventListener("click", () => openUrl(s.base_url));
    document.getElementById("btn-reveal")!.addEventListener("click", () => openPath(s.dir));
    document.getElementById("btn-copy")!.addEventListener("click", async (ev) => {
      const btn = ev.currentTarget as HTMLButtonElement;
      const command = tab === "refined" ? "read_refined_report" : "read_report";
      await writeText(await invoke<string>(command, { id: s.id }));
      btn.classList.add("done");
      btn.innerHTML = `${ICON.check}<span>Copiado</span>`;
      setTimeout(() => {
        btn.classList.remove("done");
        btn.innerHTML = `${ICON.copy}<span>Copiar reporte</span>`;
      }, 1600);
    });

    const run = (kind: "reprocess" | "refine") => async () => {
      busy.set(s.id, kind);
      listKey = detailKey = "";
      await refresh();
      let error: unknown = null;
      try {
        await invoke(kind === "refine" ? "refine_session" : "reprocess_session", { id: s.id });
      } catch (e) {
        error = e;
      }
      busy.delete(s.id);
      if (kind === "refine" && !error) tab = "refined";
      listKey = detailKey = "";
      await refresh();
      if (error && selectedId === s.id) {
        const box = document.getElementById("notice");
        if (box) box.innerHTML = `<p class="callout">No se pudo ${kind === "refine" ? "refinar" : "reprocesar"}: ${esc(error)}</p>`;
      }
    };
    document.getElementById("btn-reprocess")!.addEventListener("click", run("reprocess"));
    document.getElementById("btn-refine")!.addEventListener("click", run("refine"));

    invoke<string | null>("session_audio_path", { id: s.id })
      .then((audioPath) => {
        const player = document.getElementById("player") as HTMLAudioElement | null;
        if (player && audioPath && selectedId === s.id) {
          player.src = convertFileSrc(audioPath);
          player.hidden = false;
        }
      })
      .catch(() => {});

    if (working) {
      content.innerHTML = emptyDetail(
        `<i class="spinner big"></i>`,
        working === "refine" ? "Refinando el reporte…" : "Reprocesando la sesión…",
        "Transcribiendo el audio y anclando cada comentario. Puede tardar unos segundos.",
      );
      return;
    }
    if (s.status === "recording") {
      content.innerHTML = emptyDetail(
        `<span class="rec-orb">${ICON.mic}</span>`,
        `Grabando · <span data-elapsed="${esc(s.started_at)}"></span>`,
        "Hablá en voz alta sobre lo que ves. Cuando detengas la grabación, el reporte aparece acá solo.",
      );
      tickElapsed();
      return;
    }
    if (s.status === "processing") {
      content.innerHTML = emptyDetail(
        `<i class="spinner big"></i>`,
        "Procesando la sesión…",
        "Transcribiendo el audio y anclando cada comentario al elemento donde lo dijiste.",
      );
      return;
    }
    if (s.status === "failed" || s.status === "interrupted") {
      notice.innerHTML = `<p class="callout">${ICON.warn}<span>${
        s.status === "failed"
          ? "Esta sesión se grabó pero el procesamiento no terminó."
          : "La grabación se cortó antes de detenerse."
      } Probá con <strong>Reprocesar</strong>.</span></p>`;
    }

    let issues: Issue[] = [];
    try {
      issues = await invoke<Issue[]>("read_issues", { id: s.id });
    } catch {
      /* sin issues.json todavía */
    }
    if (selectedId !== s.id) return;

    const tabs: [typeof tab, string][] = [
      ["issues", `Comentarios${issues.length ? ` <b>${issues.length}</b>` : ""}`],
      ["report", "Reporte"],
    ];
    if (s.has_refined) tabs.push(["refined", "Refinado"]);
    if (!tabs.some(([key]) => key === tab)) tab = "issues";

    content.innerHTML = `
      <div class="seg">${tabs.map(([key, label]) => `<button type="button" data-tab="${key}" class="${key === tab ? "on" : ""}">${label}</button>`).join("")}</div>
      <div id="pane"></div>`;
    const pane = document.getElementById("pane")!;
    content.querySelectorAll<HTMLButtonElement>(".seg button").forEach((btn) =>
      btn.addEventListener("click", () => {
        tab = btn.dataset.tab as typeof tab;
        detailKey = "";
        void renderDetail();
      }),
    );

    if (tab === "issues") {
      const sorted = [...issues].sort((a, b) => a.t - b.t);
      pane.innerHTML = sorted.length
        ? `<div class="issues">${sorted.map(issueCard).join("")}</div>`
        : emptyDetail(ICON.mic, "Sin comentarios", "No se detectó ningún comentario hablado en esta sesión.");
    } else {
      const pre = document.createElement("pre");
      pre.className = "report";
      try {
        pre.textContent = await invoke<string>(tab === "refined" ? "read_refined_report" : "read_report", { id: s.id });
      } catch (e) {
        pre.textContent = `Todavía no hay reporte. ${e}`;
      }
      pane.replaceChildren(pre);
    }
  }

  function tickElapsed() {
    document.querySelectorAll<HTMLElement>("[data-elapsed]").forEach((el) => {
      el.textContent = stopwatch(Date.now() - new Date(el.dataset.elapsed!).getTime());
    });
  }

  async function refresh() {
    let activeId: string | null = null;
    try {
      activeId = (await invoke<HealthResponse>("daemon_health")).session;
    } catch {
      /* daemon caído: la lista igual se lee del disco */
    }
    let next: SessionSummary[];
    try {
      next = await invoke<SessionSummary[]>("list_sessions");
    } catch (e) {
      list.innerHTML = `<p class="callout">No se pudieron leer las sesiones: ${esc(e)}</p>`;
      return;
    }
    if (!alive) return;
    // Sin `stop.json` y sin estar activa en el daemon: se cortó a mitad de grabación.
    for (const s of next) if (s.status === "recording" && s.id !== activeId) s.status = "interrupted";
    sessions = next;

    const nextListKey = JSON.stringify([sessions, selectedId, [...busy]]);
    if (nextListKey !== listKey) {
      listKey = nextListKey;
      renderList();
    }
    const nextDetailKey = JSON.stringify([sessions.find((s) => s.id === selectedId) ?? null, [...busy]]);
    if (nextDetailKey !== detailKey) {
      detailKey = nextDetailKey;
      await renderDetail();
    }
  }

  list.addEventListener("click", (ev) => {
    const item = (ev.target as HTMLElement).closest<HTMLElement>(".session-item");
    if (!item) return;
    selectedId = item.dataset.id!;
    tab = "issues";
    void refresh();
  });

  const poll = setInterval(refresh, 2000);
  const clock = setInterval(tickElapsed, 1000);
  leaveView = () => {
    alive = false;
    clearInterval(poll);
    clearInterval(clock);
  };

  await refresh();
  // Arranca mostrando la más reciente: es casi siempre la que se acaba de grabar.
  if (!selectedId && sessions.length > 0) {
    selectedId = sessions[0].id;
    await refresh();
  }
}

// ---------- Estado del daemon (barra superior) ----------

async function refreshDaemonPill() {
  const pill = document.getElementById("daemon-pill");
  if (!pill) return;
  try {
    const h = await invoke<HealthResponse>("daemon_health");
    pill.className = h.session ? "daemon rec" : "daemon ok";
    pill.innerHTML = h.session ? `<i class="pulse"></i>Grabando` : `<i></i>Listo para grabar`;
    pill.title = `Daemon v${h.daemon_version}`;
  } catch {
    pill.className = "daemon off";
    pill.innerHTML = `<i></i>Daemon sin responder`;
  }
}
refreshDaemonPill();
setInterval(refreshDaemonPill, 2000);
