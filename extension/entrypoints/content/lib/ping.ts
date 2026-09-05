import type { Teardown } from "./hooks.js";

/**
 * Único propósito: que el popup pueda distinguir "esta pestaña no tiene el content
 * script" de "el content script está ahí pero no pasó nada" (§05, D-U2-01,
 * docs/DECISIONS.md). Los content scripts de `matches: ["<all_urls>"]` no se
 * inyectan solos en pestañas que ya estaban abiertas antes de instalar/recargar la
 * extensión — sin esto, la única señal de eso era que la grabación no generara
 * ningún evento, y nada en la UI lo explicaba.
 *
 * `chrome.tabs.sendMessage` a una pestaña sin content script rechaza con "Could not
 * establish connection" — eso ya alcanzaría para detectarlo, pero depender de que
 * *algún* listener exista (como `installMarkRelay`) es implícito y frágil ante
 * refactors. Este responder es explícito: contesta `qua:pong` a propósito.
 */
export interface PingMessage {
  type: "qua:ping";
}

export function isPingMessage(msg: unknown): msg is PingMessage {
  return !!msg && typeof msg === "object" && (msg as PingMessage).type === "qua:ping";
}

export function installPingResponder(): Teardown {
  const runtime = typeof chrome !== "undefined" ? chrome.runtime : undefined;
  if (!runtime?.onMessage) return () => {};

  const listener = (message: unknown, _sender: unknown, sendResponse: (response: unknown) => void) => {
    if (!isPingMessage(message)) return false;
    sendResponse({ type: "qua:pong" });
    return false; // respuesta síncrona — no hace falta mantener el canal abierto.
  };
  runtime.onMessage.addListener(listener);
  return () => runtime.onMessage.removeListener(listener);
}
