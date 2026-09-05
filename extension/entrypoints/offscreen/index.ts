import { startQuaOffscreen } from "./main.js";

/**
 * Punto de entrada real del offscreen doc (§5.4). Igual que
 * `content/index.ts` (A1): se autoarranca solo dentro de una extensión real,
 * así que importar este módulo en Node/tests nunca dispara nada.
 */
if (typeof chrome !== "undefined" && chrome.runtime?.id) {
  startQuaOffscreen();
}
