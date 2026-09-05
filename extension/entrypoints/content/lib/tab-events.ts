import type { Event } from "@qua/protocol";
import { nowMs } from "./clock.js";

/**
 * `tab_switch` y `tab_close` (§03) nacen de `chrome.tabs.onActivated` /
 * `onRemoved` — APIs que solo existen en el service worker, no en un content
 * script inyectado en la página. Ver `docs/DECISIONS.md` (D-09): el disparo
 * real es de A2. Estos builders viven acá para que A2 pueda construir el
 * `Event` con el mismo reloj (`nowMs`, §02) y la misma validación (`EventSchema`
 * vía `createEmit`, ver `emit.ts`) que usa el resto del pipeline de A1, y para
 * que el harness de A1 pueda demostrar que su `emit` acepta los 17 tipos que
 * no son `audio_gap` aunque dos de ellos no se disparen desde acá.
 */
export function buildTabSwitchEvent(from: number | null, to: number, url: string): Event {
  return { t: nowMs(), k: "tab_switch", from, to, url } as Event;
}

export function buildTabCloseEvent(tab: number): Event {
  return { t: nowMs(), k: "tab_close", tab } as Event;
}
