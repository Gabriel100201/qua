import { defineContentScript } from "wxt/utils/define-content-script";
import { startQuaContentScript } from "./main.js";

/**
 * Wiring de WXT del content script real (§05, `document_start`).
 *
 * `main.ts` se mantiene framework-agnóstico a propósito (ver `docs/DECISIONS.md`,
 * D-09 de A1): esto es solo el adaptador que hace que WXT lo reconozca como
 * content script de verdad — `matches: ["<all_urls>"]` para cubrir cualquier
 * página del usuario (§12: la redacción, no el matching, es lo que protege
 * datos sensibles) y `runAt: "document_start"` para no perderse el `nav` inicial.
 */
export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_start",
  main() {
    startQuaContentScript();
  },
});
