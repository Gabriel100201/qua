import { startPopupController, type PopupElements, type Teardown } from "./lib/controller.js";
import { StatusClient } from "./lib/status-client.js";
import { PopupDiagnosticsClient } from "./lib/diagnostics.js";
import { startConnectController, type ConnectElements } from "./lib/connect-controller.js";
import { getStoredToken, isDaemonRunning, autoPair, type ConnectionDeps } from "./lib/connection.js";
import { copyLastReport, getLastReport, revealLastReport } from "./lib/report-actions.js";

export type { Teardown };

/** Busca los elementos del `index.html` del popup por id. Tira si falta alguno — es un bug de wiring, no un caso de borde. */
export function findPopupElements(doc: Document): PopupElements {
  const byId = <T extends HTMLElement>(id: string): T => {
    const el = doc.getElementById(id);
    if (!el) throw new Error(`[qua] falta #${id} en popup/index.html`);
    return el as T;
  };
  const optionalById = <T extends HTMLElement>(id: string): T | undefined =>
    (doc.getElementById(id) as T | null) ?? undefined;
  return {
    toggleButton: byId<HTMLButtonElement>("qua-toggle"),
    markButton: byId<HTMLButtonElement>("qua-mark"),
    statusLabel: byId("qua-status"),
    durationLabel: byId("qua-duration"),
    eventsCountLabel: byId("qua-events-count"),
    transcript: byId("qua-transcript"),
    errorBanner: byId("qua-error"),
    daemonStatusLabel: byId("qua-daemon-status"),
    micStatusLabel: byId("qua-mic-status"),
    contentScriptStatusLabel: byId("qua-content-script-status"),
    reloadTabButton: byId<HTMLButtonElement>("qua-reload-tab"),
    reportActions: optionalById("qua-report-actions"),
    copyReportButton: optionalById<HTMLButtonElement>("qua-copy-report"),
    openFolderButton: optionalById<HTMLButtonElement>("qua-open-folder"),
  };
}

/** Busca los elementos del estado "sin conectar" (D-U1-01). Mismo criterio que `findPopupElements`. */
export function findConnectElements(doc: Document): ConnectElements {
  const byId = <T extends HTMLElement>(id: string): T => {
    const el = doc.getElementById(id);
    if (!el) throw new Error(`[qua] falta #${id} en popup/index.html`);
    return el as T;
  };
  return {
    container: byId("qua-connect"),
    title: byId("qua-connect-title"),
    message: byId("qua-connect-message"),
    connectButton: byId<HTMLButtonElement>("qua-connect-button"),
    commandRow: byId("qua-connect-command-row"),
    commandText: byId("qua-connect-command"),
    copyButton: byId<HTMLButtonElement>("qua-connect-copy"),
    openOptionsButton: byId<HTMLButtonElement>("qua-connect-options"),
  };
}

export interface StartQuaPopupOptions {
  /** Inyectables para tests — evitan depender de `chrome`/`fetch` reales. */
  connectionDeps?: ConnectionDeps;
  isDaemonRunningFn?: typeof isDaemonRunning;
  autoPairFn?: typeof autoPair;
}

/**
 * Arranca el popup real contra `document` y `chrome.runtime`. En el modo local
 * (D-L1-01) va directo a la UI de grabación: no hay daemon ni pairing.
 */
export function startQuaPopup(doc: Document = document, opts: StartQuaPopupOptions = {}): Teardown {
  const mainContainer = doc.getElementById("qua-main");
  const connectElements = findConnectElements(doc);

  let sessionTeardown: Teardown | null = null;
  let connectTeardown: Teardown | null = null;
  let tornDown = false;

  function showMain(): void {
    connectTeardown?.();
    connectTeardown = null;
    if (mainContainer) mainContainer.hidden = false;
    connectElements.container.hidden = true;
    if (!sessionTeardown) {
      const client = new StatusClient();
      sessionTeardown = startPopupController({
        client,
        diagnostics: new PopupDiagnosticsClient(client),
        elements: findPopupElements(doc),
        reportActions: { getLastReport, copyLastReport, revealLastReport },
      });
    }
  }

  function showConnect(): void {
    if (mainContainer) mainContainer.hidden = true;
    connectElements.container.hidden = false;
    connectTeardown = startConnectController({
      elements: connectElements,
      onConnected: showMain,
      connectionDeps: opts.connectionDeps,
      isDaemonRunningFn: opts.isDaemonRunningFn,
      autoPairFn: opts.autoPairFn,
      openOptionsPage: () => {
        if (typeof chrome !== "undefined") chrome.runtime?.openOptionsPage?.();
      },
    });
  }

  // Modo local (D-L1-01): no hay daemon que emparejar, la UI de grabación va directo.
  // `showConnect` queda para un modo daemon opcional; hoy no se usa.
  void getStoredToken;
  void showConnect;
  if (!tornDown) showMain();

  return () => {
    tornDown = true;
    sessionTeardown?.();
    connectTeardown?.();
  };
}
