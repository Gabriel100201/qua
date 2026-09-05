import type { Utterance } from "@qua/protocol";
import { formatDuration } from "./format.js";
import { IDLE_STATUS, type CommandResult } from "./status-client.js";
import type { PopupStatus, PopupSessionState } from "./messages.js";
import type { Unsubscribe } from "./status-client.js";
import type { ContentScriptDiagnosis, DaemonDiagnosis, MicPermissionState } from "./diagnostics.js";

/** Lo mínimo que el controller necesita del transporte — ver `status-client.ts` para la implementación real.
 * `start`/`stop`/`mark` devuelven `CommandResult`: D-U2-01 (docs/DECISIONS.md) — un fallo real (sin
 * token, daemon caído) tiene que llegar hasta acá para poder mostrarse, no perderse en un `void`. */
export interface StatusClientLike {
  getStatus(): Promise<PopupStatus>;
  start(): Promise<CommandResult>;
  stop(): Promise<CommandResult>;
  mark(): Promise<CommandResult>;
  onStatus(cb: (status: PopupStatus) => void): Unsubscribe;
  onTranscript(cb: (utterance: Utterance) => void): Unsubscribe;
}

/** Franja de estado (§04, D-U2-01): daemon / micrófono / content script de la
 * pestaña activa. Ver `diagnostics.ts` para la implementación real de cada chequeo. */
export interface DiagnosticsClientLike {
  getDaemonStatus(): Promise<DaemonDiagnosis>;
  getMicStatus(): Promise<MicPermissionState>;
  getContentScriptStatus(): Promise<ContentScriptDiagnosis>;
  reloadActiveTab(): Promise<void>;
}

export interface PopupElements {
  toggleButton: HTMLButtonElement;
  markButton: HTMLButtonElement;
  statusLabel: HTMLElement;
  durationLabel: HTMLElement;
  eventsCountLabel: HTMLElement;
  transcript: HTMLElement;
  /** Último error real (start/stop fallido, transporte roto) — oculto si no hay nada que mostrar. */
  errorBanner: HTMLElement;
  daemonStatusLabel: HTMLElement;
  micStatusLabel: HTMLElement;
  contentScriptStatusLabel: HTMLElement;
  /** Visible solo cuando el content script de la pestaña activa hace falta recargar. */
  reloadTabButton: HTMLButtonElement;
}

export interface PopupControllerOptions {
  client: StatusClientLike;
  elements: PopupElements;
  /** Opcional: sin esto, la franja de estado se queda con el texto por defecto del HTML
   * (no hay diagnóstico real que mostrar, pero tampoco rompe nada). */
  diagnostics?: DiagnosticsClientLike;
  /** Inyectables para tests — evitan depender de temporizadores/reloj reales. */
  now?: () => number;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  /** Cuántas líneas de transcript se conservan en el DOM (recorta el resto). */
  maxTranscriptLines?: number;
  /**
   * Bug U3 (docs/DECISIONS.md D-U3-01): mientras el popup está abierto, `getStatus()`
   * y la franja de diagnóstico se refrescan cada `pollIntervalMs` — antes se
   * consultaban una sola vez al abrir el popup, así que apretar Grabar/Detener nunca
   * se veía reflejado sin cerrar y reabrir. `onStatus`/`onTranscript` (push) siguen
   * cableados por si algún día el service worker empieza a emitir — hoy no lo hace
   * (§5.3 FSM no tiene ningún `sendMessage` de salida), así que el polling es quien
   * hace el trabajo real.
   */
  pollIntervalMs?: number;
}

const STATUS_LABELS: Record<PopupSessionState, string> = {
  idle: "Inactivo",
  starting: "Arrancando…",
  recording: "● Grabando",
  stopping: "Deteniendo…",
};

const DAEMON_LABELS: Record<DaemonDiagnosis, string> = {
  conectado: "Daemon: conectado",
  no_corre: "Daemon: no responde",
  sin_emparejar: "Daemon: sin emparejar",
};

const MIC_LABELS: Record<MicPermissionState, string> = {
  granted: "Micrófono: concedido",
  denied: "Micrófono: denegado",
  prompt: "Micrófono: pendiente",
  unknown: "Micrófono: desconocido",
};

const CONTENT_SCRIPT_LABELS: Record<ContentScriptDiagnosis, string> = {
  inyectado: "Pestaña: lista",
  hace_falta_recargar: "Pestaña: recargá para grabar",
  desconocido: "Pestaña: sin datos",
};

const DEFAULT_MAX_TRANSCRIPT_LINES = 50;
/** D-U3-01: 500 ms — rápido para sentirse "en vivo", lo bastante espaciado para no
 * saturar `chrome.runtime.sendMessage` mientras el popup queda abierto de fondo. */
const DEFAULT_POLL_INTERVAL_MS = 500;

export type Teardown = () => void;

/**
 * Cablea el popup (§5.4): botón start/stop, botón de marca, duración en vivo,
 * transcript en vivo (`transcript.partial`, §04) y contador de eventos.
 * Recibe el DOM ya armado (`elements`) para no acoplarse a cómo WXT sirve
 * `index.html` — mismo espíritu de `content/main.ts` (A1): testeable sin
 * navegador de verdad.
 */
export function startPopupController(opts: PopupControllerOptions): Teardown {
  const { client, elements, diagnostics } = opts;
  const now = opts.now ?? (() => Date.now());
  const setIntervalFn = opts.setIntervalFn ?? setInterval;
  const clearIntervalFn = opts.clearIntervalFn ?? clearInterval;
  const maxLines = opts.maxTranscriptLines ?? DEFAULT_MAX_TRANSCRIPT_LINES;
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  let status: PopupStatus = IDLE_STATUS;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  function renderStatus(): void {
    elements.statusLabel.textContent = STATUS_LABELS[status.state];
    elements.eventsCountLabel.textContent = String(status.eventsCount);
    elements.toggleButton.textContent = status.state === "recording" ? "Detener" : "Grabar";
    elements.toggleButton.disabled = status.state === "starting" || status.state === "stopping";
    elements.markButton.disabled = status.state !== "recording";
    renderDuration();
    renderError();
  }

  /** D-U2-01: acá es donde el error real (no un `undefined` tragado) llega al DOM. */
  function renderError(): void {
    const message = status.lastError ?? null;
    elements.errorBanner.textContent = message ?? "";
    elements.errorBanner.hidden = message === null;
  }

  function setError(message: string | null): void {
    status = { ...status, lastError: message };
    renderError();
  }

  function applyCommandResult(result: CommandResult): void {
    setError(result.ok ? null : result.error);
    void refreshDiagnostics(); // ej.: un start exitoso puede haber cambiado wsStatus a "connected"
  }

  function renderDuration(): void {
    elements.durationLabel.textContent = formatDuration(
      status.startedAtWall === null ? 0 : now() - status.startedAtWall,
    );
  }

  /**
   * D-U3-01: se usa tanto para el push (`onStatus`, hoy inerte) como para cada poll
   * de `getStatus()`. `lastError` NO se pisa con lo que traiga `next` salvo que
   * `next` traiga uno propio — si lo hiciera siempre, un error real recién mostrado
   * por `applyCommandResult` (ej. "sin token") desaparecería solo en el próximo tick
   * del poll, sin que el usuario llegue a leerlo. El único que limpia `lastError`
   * explícitamente es `setError`/`applyCommandResult`.
   */
  function applyStatus(next: PopupStatus): void {
    status = { ...next, lastError: next.lastError ?? status.lastError ?? null };
    renderStatus();
  }

  function appendTranscript(utterance: Utterance): void {
    const line = elements.transcript.ownerDocument.createElement("div");
    line.className = "qua-transcript-line";
    line.textContent = utterance.text;
    elements.transcript.appendChild(line);
    while (elements.transcript.childElementCount > maxLines) {
      elements.transcript.removeChild(elements.transcript.firstChild!);
    }
    elements.transcript.scrollTop = elements.transcript.scrollHeight;
  }

  const onToggleClick = () => {
    if (status.state === "recording") void client.stop().then(applyCommandResult);
    else if (status.state === "idle") void client.start().then(applyCommandResult);
  };
  const onMarkClick = () => void client.mark().then(applyCommandResult);

  /** Franja de estado (§04, D-U2-01/D-U3-01): daemon / micrófono / content script de
   * la pestaña activa — se refresca al abrir el popup, después de cada intento de
   * start/stop/mark o de recargar la pestaña, y en cada tick del poll de estado
   * (D-U3-01) mientras el popup sigue abierto. */
  async function refreshDiagnostics(): Promise<void> {
    if (!diagnostics) return;
    const [daemon, mic, contentScript] = await Promise.all([
      diagnostics.getDaemonStatus().catch((): DaemonDiagnosis => "no_corre"),
      diagnostics.getMicStatus().catch((): MicPermissionState => "unknown"),
      diagnostics.getContentScriptStatus().catch((): ContentScriptDiagnosis => "desconocido"),
    ]);
    elements.daemonStatusLabel.textContent = DAEMON_LABELS[daemon];
    elements.micStatusLabel.textContent = MIC_LABELS[mic];
    elements.contentScriptStatusLabel.textContent = CONTENT_SCRIPT_LABELS[contentScript];
    elements.reloadTabButton.hidden = contentScript !== "hace_falta_recargar";
  }

  const onReloadTabClick = () => {
    void diagnostics
      ?.reloadActiveTab()
      .catch(() => undefined)
      .then(() => refreshDiagnostics());
  };

  elements.toggleButton.addEventListener("click", onToggleClick);
  elements.markButton.addEventListener("click", onMarkClick);
  elements.reloadTabButton.addEventListener("click", onReloadTabClick);

  const unsubStatus = client.onStatus(applyStatus);
  const unsubTranscript = client.onTranscript(appendTranscript);

  function pollStatus(): void {
    void client.getStatus().then(applyStatus).catch(() => {
      // Mismo motivo que la consulta inicial: `StatusClient` real no rechaza
      // (D-U2-01). Si un tick falla, el próximo lo vuelve a intentar.
    });
    void refreshDiagnostics();
  }

  renderStatus();
  client
    .getStatus()
    .then(applyStatus)
    .catch(() => {
      // No debería pasar — StatusClient real ya no rechaza (D-U2-01), pero un
      // StatusClientLike de test podría. Se queda con IDLE_STATUS, ya renderizado.
    });
  void refreshDiagnostics();
  // D-U3-01: mientras el popup siga abierto, el estado real (fase, franja de
  // diagnóstico) se re-consulta cada `pollIntervalMs` — es lo que hace que
  // apretar Grabar/Detener se vea sin cerrar y reabrir el popup.
  pollTimer = setIntervalFn(pollStatus, pollIntervalMs);

  return () => {
    elements.toggleButton.removeEventListener("click", onToggleClick);
    elements.markButton.removeEventListener("click", onMarkClick);
    elements.reloadTabButton.removeEventListener("click", onReloadTabClick);
    unsubStatus();
    unsubTranscript();
    if (pollTimer !== null) clearIntervalFn(pollTimer);
  };
}
