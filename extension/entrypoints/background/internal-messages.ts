import type { Event } from "@qua/protocol";

/**
 * Contrato interno content script / popup ↔ service worker. NO es parte del
 * protocolo congelado de `@qua/protocol` (§04, extensión ↔ daemon) — es la
 * mensajería de `chrome.runtime` puertas adentro de la extensión.
 *
 * **G1** ajustó esta unión para que matchee lo que A1 y A3 mandan de verdad, en vez
 * de lo que A2 había anticipado sin ver el otro lado (ver D-G1-03 en
 * `docs/DECISIONS.md`): el content script (`content/lib/emit.ts`) manda un evento
 * por mensaje (`qua:event`, no `qua:events` en lote), y el popup
 * (`popup/lib/status-client.ts`) manda `qua:start-session`/`qua:trigger-mark` sin
 * `baseUrl`/`viewport` — el service worker es quien tiene que resolverlos desde la
 * pestaña activa, porque el popup no tiene ese contexto.
 */
export type ToBackgroundMessage =
  | { type: "qua:event"; event: Event }
  | { type: "qua:trigger-mark" }
  | { type: "qua:start-session" }
  | { type: "qua:stop-session" }
  | { type: "qua:get-status" };

export interface StatusResponse {
  phase: "idle" | "starting" | "recording" | "stopping";
  wsStatus?: "disconnected" | "connecting" | "connected";
}
