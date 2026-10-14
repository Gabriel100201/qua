/** Estado del modelo de whisper del modo local (D-L1-01). Archivo aparte para que el
 * service worker y el popup lo lean sin importar el motor (transformers.js es pesado). */
export type ModelState =
  | { status: "sin_descargar" }
  | { status: "descargando"; loaded: number; total: number }
  | { status: "listo"; device: "webgpu" | "wasm" }
  | { status: "error"; message: string };

/** Clave de `chrome.storage.local` donde el SW deja el último estado. */
export const MODEL_STATE_KEY = "qua:model-state";
