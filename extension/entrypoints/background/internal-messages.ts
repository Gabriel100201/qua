import type { Event, ViewportInfo } from "@qua/protocol";

/**
 * Contrato interno content script / popup ↔ service worker. NO es parte del
 * protocolo congelado de `@qua/protocol` (§04, extensión ↔ daemon) — es la
 * mensajería de `chrome.runtime` puertas adentro de la extensión, que A2 necesita
 * definir para tener algo contra qué integrar. Ver `docs/DECISIONS.md`: A1 (content
 * script) y A3 (popup/options) deberían converger acá en vez de inventar la suya.
 */
export type ToBackgroundMessage =
  | { type: "qua:events"; items: Event[] }
  | { type: "qua:mark" }
  | { type: "qua:start-session"; baseUrl: string; viewport: ViewportInfo }
  | { type: "qua:stop-session" }
  | { type: "qua:get-status" };

export interface StatusResponse {
  phase: "idle" | "starting" | "recording" | "stopping";
  wsStatus?: "disconnected" | "connecting" | "connected";
}
