import { startQuaContentScript } from "./main.js";

/**
 * Punto de entrada real del content script (§05, `document_start`).
 *
 * El wiring con WXT (`defineContentScript`, `matches`, manifest) es del
 * scaffold compartido con A2/A3 (§5.3) — ver `docs/DECISIONS.md` (D-09).
 * Este archivo se mantiene framework-agnóstico a propósito: se autoarranca
 * solo cuando corre dentro de una extensión real (`chrome.runtime` presente),
 * así que importar este módulo en Node/tests nunca dispara nada.
 */
if (typeof chrome !== "undefined" && chrome.runtime?.id) {
  startQuaContentScript();
}
