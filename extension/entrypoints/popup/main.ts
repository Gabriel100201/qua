import { startPopupController, type PopupElements, type Teardown } from "./lib/controller.js";
import { StatusClient } from "./lib/status-client.js";

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
  };
}

/** Arranca el popup real contra `document` y `chrome.runtime`. */
export function startQuaPopup(doc: Document = document): Teardown {
  return startPopupController({
    client: new StatusClient(),
    elements: findPopupElements(doc),
  });
}
