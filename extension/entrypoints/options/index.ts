import { startQuaOptions } from "./main.js";

/** Punto de entrada real de options.html (§5.4). Mismo patrón que A1/popup/offscreen. */
if (typeof chrome !== "undefined" && chrome.runtime?.id) {
  document.addEventListener("DOMContentLoaded", () => startQuaOptions());
}
