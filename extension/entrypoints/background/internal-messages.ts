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
  /** Hay token de pairing guardado (§04, franja de estado del popup) — no implica
   * que el daemon esté vivo, solo que options ya emparejó alguna vez. */
  paired: boolean;
  /** epoch ms en que arrancó la sesión en curso, o `null` si `phase === "idle"`.
   * Bug U3 (docs/DECISIONS.md D-U3-01): sin esto el popup no puede reconstruir la
   * duración real al re-consultar el estado — solo tenía el reloj propio del timer. */
  startedAtWall: number | null;
  /** Eventos aceptados por la FSM en la sesión en curso (0 fuera de `recording`).
   * Cuenta al encolar, no al `ack` del daemon (D-U3-01): un contador que se queda
   * congelado esperando la confirmación de red es peor que uno optimista. */
  eventsCount: number;
}
