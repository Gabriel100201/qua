import { startOnboardingController, type OnboardingElements, type Teardown } from "./lib/controller.js";
import { startModelDownload } from "./lib/model-download.js";

export type { Teardown };

/** Busca los elementos del `index.html` de options por id. Tira si falta alguno — bug de wiring, no caso de borde. */
export function findOnboardingElements(doc: Document): OnboardingElements {
  const byId = <T extends HTMLElement>(id: string): T => {
    const el = doc.getElementById(id);
    if (!el) throw new Error(`[qua] falta #${id} en options/index.html`);
    return el as T;
  };
  return {
    micStatus: byId("qua-mic-status"),
    micButton: byId<HTMLButtonElement>("qua-mic-button"),
    micMessage: byId("qua-mic-message"),
    pairForm: byId<HTMLFormElement>("qua-pair-form"),
    pairInput: byId<HTMLInputElement>("qua-pair-input"),
    pairButton: byId<HTMLButtonElement>("qua-pair-button"),
    pairMessage: byId("qua-pair-message"),
  };
}

/** Arranca options.html real contra `document`. */
export function startQuaOptions(doc: Document = document): Teardown {
  const stopOnboarding = startOnboardingController({ elements: findOnboardingElements(doc) });
  const button = doc.getElementById("qua-model-button") as HTMLButtonElement | null;
  const status = doc.getElementById("qua-model-status");
  const message = doc.getElementById("qua-model-message");
  const stopModel = button && status && message ? startModelDownload({ button, status, message }) : () => undefined;
  return () => {
    stopOnboarding();
    stopModel();
  };
}
