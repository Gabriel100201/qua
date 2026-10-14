import { MODEL_STATE_KEY, type ModelState } from "../../../shared/local/model-state.js";

/**
 * "Bajar el modelo ahora" de options (D-L1-01). Corre `loadAsr` acá mismo: la página
 * de opciones comparte origen con el offscreen doc, así que los pesos quedan en la
 * misma Cache API y la primera sesión ya no espera la descarga. Además prueba que
 * WebGPU ande en esta máquina antes de grabar.
 */
export interface ModelElements {
  button: HTMLButtonElement;
  status: HTMLElement;
  message: HTMLElement;
}

export function modelStatusLabel(state: ModelState | undefined): string {
  switch (state?.status) {
    case "listo":
      return state.device === "webgpu" ? "Listo ✓ (usa la GPU)" : "Listo ✓ (sin GPU: usa un modelo más chico, más lento y menos preciso)";
    case "descargando":
      return state.total > 0 ? `Bajando… ${Math.round((state.loaded / state.total) * 100)}%` : "Bajando…";
    case "error":
      return "No se pudo bajar";
    default:
      return "Sin bajar";
  }
}

export function startModelDownload(el: ModelElements): () => void {
  let cancelled = false;
  const render = (state: ModelState | undefined) => {
    if (cancelled) return;
    el.status.textContent = modelStatusLabel(state);
    el.button.disabled = state?.status === "listo" || state?.status === "descargando";
    if (state?.status === "error") el.message.textContent = state.message;
  };

  void chrome.storage.local.get(MODEL_STATE_KEY).then((v) => render(v[MODEL_STATE_KEY] as ModelState | undefined));

  const onClick = async () => {
    el.button.disabled = true;
    el.message.textContent = "Dejá esta pestaña abierta hasta que termine.";
    const save = (state: ModelState) => {
      render(state);
      void chrome.storage.local.set({ [MODEL_STATE_KEY]: state });
    };
    try {
      const { loadAsr } = await import("../../../shared/local/engine.js");
      await loadAsr(save);
      el.message.textContent = "Listo. Ya podés grabar.";
    } catch (err) {
      save({ status: "error", message: String(err) });
      el.button.disabled = false;
    }
  };
  el.button.addEventListener("click", onClick);
  return () => {
    cancelled = true;
    el.button.removeEventListener("click", onClick);
  };
}
