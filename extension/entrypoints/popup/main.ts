import { startPopupController, type PopupElements, type Teardown } from "./lib/controller.js";
import { StatusClient } from "./lib/status-client.js";
import { PopupDiagnosticsClient } from "./lib/diagnostics.js";
import { startConnectController, type ConnectElements } from "./lib/connect-controller.js";
import { getStoredToken, isDaemonRunning, autoPair, type ConnectionDeps } from "./lib/connection.js";

export type { Teardown };

/** Busca los elementos del `index.html` del popup por id. Tira si falta alguno — es un bug de wiring, no un caso de borde. */
export function findPopupElements(doc: Document): PopupElements {
  const byId = <T extends HTMLElement>(id: string): T => {
    const el = doc.getElementById(id);
    if (!el) throw new Error(`[qua] falta #${id} en popup/index.html`);
    return el as T;
  };
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
 * Arranca el popup real contra `document` y `chrome.runtime` (D-U1-01): sin
 * token muestra el estado "Sin conectar al daemon" (un click en "Conectar",
 * sin código de 6 dígitos); con token, la UI de grabación de siempre.
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

  getStoredToken(opts.connectionDeps)
    .then((token) => {
      if (tornDown) return;
      if (token) showMain();
      else showConnect();
    })
    .catch(() => {
      if (!tornDown) showConnect();
    });

  return () => {
    tornDown = true;
    sessionTeardown?.();
    connectTeardown?.();
  };
}
