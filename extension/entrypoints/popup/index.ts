import { startQuaPopup } from "./main.js";

/** Punto de entrada real del popup (§5.4). Mismo patrón que A1/offscreen: framework-agnóstico, se autoarranca solo dentro de una extensión real. */
if (typeof chrome !== "undefined" && chrome.runtime?.id) {
  document.addEventListener("DOMContentLoaded", () => startQuaPopup());
}
