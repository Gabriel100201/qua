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

  let status: PopupStatus = IDLE_STATUS;
  let durationTimer: ReturnType<typeof setInterval> | null = null;

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

  function syncDurationTimer(): void {
    const shouldTick = status.state === "recording" && status.startedAtWall !== null;
    if (shouldTick && durationTimer === null) {
      durationTimer = setIntervalFn(renderDuration, 1000);
    } else if (!shouldTick && durationTimer !== null) {
      clearIntervalFn(durationTimer);
      durationTimer = null;
    }
  }

  function applyStatus(next: PopupStatus): void {
    status = next;
    renderStatus();
    syncDurationTimer();
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

  /** Franja de estado (§04, D-U2-01): daemon / micrófono / content script de la
   * pestaña activa — se refresca al abrir el popup y después de cada intento de
   * start/stop/mark o de recargar la pestaña. No hay polling en vivo todavía
   * (ver docs/DECISIONS.md D-U2-01, "queda para un pase siguiente"). */
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

  renderStatus();
  client
    .getStatus()
    .then(applyStatus)
    .catch(() => {
      // No debería pasar — StatusClient real ya no rechaza (D-U2-01), pero un
      // StatusClientLike de test podría. Se queda con IDLE_STATUS, ya renderizado.
    });
  void refreshDiagnostics();

  return () => {
    elements.toggleButton.removeEventListener("click", onToggleClick);
    elements.markButton.removeEventListener("click", onMarkClick);
    elements.reloadTabButton.removeEventListener("click", onReloadTabClick);
    unsubStatus();
    unsubTranscript();
    if (durationTimer !== null) clearIntervalFn(durationTimer);
  };
}
