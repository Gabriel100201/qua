import { startPopupController, type PopupElements, type Teardown } from "./lib/controller.js";
import { StatusClient } from "./lib/status-client.js";
import { PopupDiagnosticsClient } from "./lib/diagnostics.js";

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

/** Arranca el popup real contra `document` y `chrome.runtime`. */
export function startQuaPopup(doc: Document = document): Teardown {
  const client = new StatusClient();
  return startPopupController({
    client,
    diagnostics: new PopupDiagnosticsClient(client),
    elements: findPopupElements(doc),
  });
}
