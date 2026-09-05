import { defineBackground } from "wxt/utils/define-background";
import { browser } from "wxt/browser";
import { SessionManager } from "./session-manager.js";
import { startKeepalive } from "./keepalive.js";
import type { StatusResponse, ToBackgroundMessage } from "./internal-messages.js";

export default defineBackground(() => {
  const sessions = new SessionManager();
  void sessions.init();

  startKeepalive(() => {
    // Red de seguridad de §5.3: no hace falta lógica acá, el timer del alarm ya
    // despertó el service worker y eso alcanza para resetear el timeout de 30 s.
  });

  browser.runtime.onMessage.addListener(
    (message: ToBackgroundMessage, _sender, sendResponse: (response: StatusResponse | { ok: true } | { ok: false; error: string }) => void) => {
      handleMessage(message)
        .then(sendResponse)
        .catch((err: unknown) => sendResponse({ ok: false, error: String(err) }));
      return true; // respuesta async
    },
  );

  async function handleMessage(
    message: ToBackgroundMessage,
  ): Promise<StatusResponse | { ok: true } | { ok: false; error: string }> {
    switch (message.type) {
      case "qua:events":
        for (const item of message.items) sessions.enqueue(item);
        return { ok: true };
      case "qua:mark":
        sessions.enqueue({ t: Date.now(), k: "mark", source: "popup" });
        return { ok: true };
      case "qua:start-session":
        await sessions.start(message.baseUrl, message.viewport);
        return { ok: true };
      case "qua:stop-session":
        await sessions.stop();
        return { ok: true };
      case "qua:get-status":
        return { phase: sessions.getPhase(), wsStatus: sessions.getWsStatus() };
      default:
        return { ok: false, error: "mensaje desconocido" };
    }
  }

  browser.commands?.onCommand.addListener((command: string) => {
    if (command === "toggle_recording") {
      // El start real necesita `baseUrl`/`viewport` de la pestaña activa — eso lo
      // dispara el popup (A3). El hotkey solo puede parar una grabación en curso.
      if (sessions.getPhase() === "recording") void sessions.stop();
    } else if (command === "drop_mark") {
      sessions.enqueue({ t: Date.now(), k: "mark", source: "hotkey" });
    }
  });
});
