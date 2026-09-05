import type { Utterance } from "@qua/protocol";
import { formatDuration } from "./format.js";
import { IDLE_STATUS } from "./status-client.js";
import type { PopupStatus, PopupSessionState } from "./messages.js";
import type { Unsubscribe } from "./status-client.js";

/** Lo mínimo que el controller necesita del transporte — ver `status-client.ts` para la implementación real. */
export interface StatusClientLike {
  getStatus(): Promise<PopupStatus>;
  start(): void;
  stop(): void;
  mark(): void;
  onStatus(cb: (status: PopupStatus) => void): Unsubscribe;
  onTranscript(cb: (utterance: Utterance) => void): Unsubscribe;
}

export interface PopupElements {
  toggleButton: HTMLButtonElement;
  markButton: HTMLButtonElement;
  statusLabel: HTMLElement;
  durationLabel: HTMLElement;
  eventsCountLabel: HTMLElement;
  transcript: HTMLElement;
}

export interface PopupControllerOptions {
  client: StatusClientLike;
  elements: PopupElements;
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
  const { client, elements } = opts;
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
    if (status.state === "recording") client.stop();
    else if (status.state === "idle") client.start();
  };
  const onMarkClick = () => client.mark();

  elements.toggleButton.addEventListener("click", onToggleClick);
  elements.markButton.addEventListener("click", onMarkClick);

  const unsubStatus = client.onStatus(applyStatus);
  const unsubTranscript = client.onTranscript(appendTranscript);

  renderStatus();
  client
    .getStatus()
    .then(applyStatus)
    .catch(() => {
      // Sin service worker todavía — se queda con IDLE_STATUS, ya renderizado.
    });

  return () => {
    elements.toggleButton.removeEventListener("click", onToggleClick);
    elements.markButton.removeEventListener("click", onMarkClick);
    unsubStatus();
    unsubTranscript();
    if (durationTimer !== null) clearIntervalFn(durationTimer);
  };
}
