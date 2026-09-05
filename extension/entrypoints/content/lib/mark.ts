import type { Event } from "@qua/protocol";
import type { EmitFn } from "./emit.js";
import type { Teardown } from "./hooks.js";
import { nowMs } from "./clock.js";

/** El hotkey (`Ctrl+Shift+E`) y el botón del popup viven en el service worker (§5.3),
 * no en el content script — no hay `chrome.commands` ni UI de popup acá. El
 * content script solo retransmite: cuando el service worker le avisa que se
 * soltó un mark, lo emite con su propio reloj (§02) para que viaje en el mismo
 * lote que el resto de los eventos de la pestaña. */
export interface MarkMessage {
  type: "qua:mark";
  source: "hotkey" | "popup";
}

function isMarkMessage(msg: unknown): msg is MarkMessage {
  return !!msg && typeof msg === "object" && (msg as MarkMessage).type === "qua:mark";
}

export function buildMarkEvent(source: "hotkey" | "popup"): Event {
  return { t: nowMs(), k: "mark", source } as Event;
}

/** Instala el listener de `chrome.runtime.onMessage` para `qua:mark`. No-op fuera de una extensión. */
export function installMarkRelay(emit: EmitFn): Teardown {
  const runtime = typeof chrome !== "undefined" ? chrome.runtime : undefined;
  if (!runtime?.onMessage) return () => {};

  const listener = (message: unknown) => {
    if (isMarkMessage(message)) emit(buildMarkEvent(message.source));
  };
  runtime.onMessage.addListener(listener);
  return () => runtime.onMessage.removeListener(listener);
}
