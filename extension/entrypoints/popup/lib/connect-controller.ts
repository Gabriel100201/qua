import {
  autoPair as autoPairFn,
  isDaemonRunning as isDaemonRunningFn,
  START_DAEMON_COMMAND,
  type AutoPairResult,
  type ConnectionDeps,
} from "./connection.js";

export interface ConnectElements {
  container: HTMLElement;
  title: HTMLElement;
  message: HTMLElement;
  connectButton: HTMLButtonElement;
  commandRow: HTMLElement;
  commandText: HTMLElement;
  copyButton: HTMLButtonElement;
  openOptionsButton: HTMLButtonElement;
}

export interface ConnectControllerOptions {
  elements: ConnectElements;
  /** Se llama una vez que hay token — quien la use arranca la UI de grabación normal. */
  onConnected: () => void;
  connectionDeps?: ConnectionDeps;
  isDaemonRunningFn?: typeof isDaemonRunningFn;
  autoPairFn?: typeof autoPairFn;
  openOptionsPage?: () => void;
  copyToClipboard?: (text: string) => Promise<void>;
}

export type Teardown = () => void;

const NOT_RUNNING_TITLE = "El daemon no está corriendo";
const NOT_RUNNING_MESSAGE = "Arrancalo con este comando y volvé a intentar:";
const NO_TOKEN_TITLE = "Sin conectar al daemon";
const NO_TOKEN_MESSAGE = "Un click para emparejar esta extensión con el daemon local.";
const CONFLICT_MESSAGE =
  "Ya hay otra extensión emparejada con este daemon. Abrí las opciones y usá el código de 6 dígitos para volver a emparejar.";

/**
 * Cablea el estado "sin conectar" del popup (D-U1-01): reemplaza el flujo de
 * `curl -X POST /pair/start` + código de 6 dígitos por un solo click en
 * "Conectar" contra `POST /pair/auto`. Si el daemon no responde, lo dice con
 * esas palabras y ofrece el comando exacto para levantarlo, copiable.
 */
export function startConnectController(opts: ConnectControllerOptions): Teardown {
  const { elements } = opts;
  const checkDaemon = opts.isDaemonRunningFn ?? isDaemonRunningFn;
  const doAutoPair = opts.autoPairFn ?? autoPairFn;
  const deps = opts.connectionDeps ?? {};
  const copy = opts.copyToClipboard ?? defaultCopy;

  elements.commandText.textContent = START_DAEMON_COMMAND;

  function renderNoToken(): void {
    elements.title.textContent = NO_TOKEN_TITLE;
    elements.message.textContent = NO_TOKEN_MESSAGE;
    elements.commandRow.hidden = true;
    elements.openOptionsButton.hidden = true;
    elements.connectButton.hidden = false;
    elements.connectButton.disabled = false;
    elements.connectButton.textContent = "Conectar";
  }

  function renderDaemonDown(): void {
    elements.title.textContent = NOT_RUNNING_TITLE;
    elements.message.textContent = NOT_RUNNING_MESSAGE;
    elements.commandRow.hidden = false;
    elements.openOptionsButton.hidden = true;
    elements.connectButton.hidden = false;
    elements.connectButton.disabled = false;
    elements.connectButton.textContent = "Reintentar";
  }

  function renderConflict(): void {
    elements.title.textContent = NO_TOKEN_TITLE;
    elements.message.textContent = CONFLICT_MESSAGE;
    elements.commandRow.hidden = true;
    elements.connectButton.hidden = true;
    elements.openOptionsButton.hidden = false;
  }

  function renderOtherError(message: string): void {
    elements.title.textContent = NO_TOKEN_TITLE;
    elements.message.textContent = message;
    elements.commandRow.hidden = true;
    elements.openOptionsButton.hidden = true;
    elements.connectButton.hidden = false;
    elements.connectButton.disabled = false;
    elements.connectButton.textContent = "Reintentar";
  }

  async function refresh(): Promise<void> {
    const running = await checkDaemon(deps);
    if (!running) {
      renderDaemonDown();
      return;
    }
    renderNoToken();
  }

  async function onConnectClick(): Promise<void> {
    elements.connectButton.disabled = true;
    elements.connectButton.textContent = "Conectando…";
    const result: AutoPairResult = await doAutoPair(deps);
    if (result.ok) {
      opts.onConnected();
      return;
    }
    switch (result.reason) {
      case "daemon_down":
        renderDaemonDown();
        break;
      case "already_paired":
        renderConflict();
        break;
      case "other":
        renderOtherError(result.error);
        break;
    }
  }

  async function onCopyClick(): Promise<void> {
    try {
      await copy(START_DAEMON_COMMAND);
      const prev = elements.copyButton.textContent;
      elements.copyButton.textContent = "Copiado ✓";
      setTimeout(() => {
        elements.copyButton.textContent = prev ?? "Copiar";
      }, 1500);
    } catch {
      // Sin permiso de portapapeles — no es crítico, el comando ya está visible como texto plano.
    }
  }

  function onOpenOptionsClick(): void {
    opts.openOptionsPage?.();
  }

  const handleConnect = () => void onConnectClick();
  const handleCopy = () => void onCopyClick();
  const handleOpenOptions = () => onOpenOptionsClick();

  elements.connectButton.addEventListener("click", handleConnect);
  elements.copyButton.addEventListener("click", handleCopy);
  elements.openOptionsButton.addEventListener("click", handleOpenOptions);

  void refresh();

  return () => {
    elements.connectButton.removeEventListener("click", handleConnect);
    elements.copyButton.removeEventListener("click", handleCopy);
    elements.openOptionsButton.removeEventListener("click", handleOpenOptions);
  };
}

function defaultCopy(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  return Promise.reject(new Error("clipboard no disponible"));
}
