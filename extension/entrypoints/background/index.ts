import { defineBackground } from "wxt/utils/define-background";
import { browser } from "wxt/browser";
import type { ViewportInfo } from "@qua/protocol";
import { SessionManager, type SessionTab } from "./session-manager.js";
import { startKeepalive } from "./keepalive.js";
import type { StatusResponse, ToBackgroundMessage } from "./internal-messages.js";

const DEFAULT_VIEWPORT: ViewportInfo = { w: 0, h: 0, dpr: 1 };

/**
 * El popup no tiene el `document` de la pestaña que se está grabando (§5.4: cada
 * contexto de extensión ve solo el suyo), así que es el service worker quien resuelve
 * `baseUrl`/`viewport` contra la pestaña activa cuando llega `qua:start-session`
 * (ver D-G1-03 en `docs/DECISIONS.md`). `scripting` ya está en `wxt.config.ts`.
 */
async function resolveActiveTabSessionInfo(): Promise<{
  baseUrl: string;
  viewport: ViewportInfo;
  tab: SessionTab;
}> {
  const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || !tab.url) {
    throw new Error("SessionManager: no hay pestaña activa para arrancar la sesión");
  }
  let viewport = DEFAULT_VIEWPORT;
  try {
    const [injected] = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({ w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1 }),
    });
    if (injected?.result) viewport = injected.result as ViewportInfo;
  } catch {
    // Páginas donde `scripting.executeScript` no puede correr (chrome://, la Web
    // Store, etc.) — la sesión arranca igual con el viewport por defecto.
  }
  return { baseUrl: tab.url, viewport, tab: { id: tab.id, title: tab.title ?? "" } };
}

export default defineBackground(() => {
  const sessions = new SessionManager();
  void sessions.init();

  startKeepalive(() => {
    // Red de seguridad de §5.3: no hace falta lógica acá, el timer del alarm ya
    // despertó el service worker y eso alcanza para resetear el timeout de 30 s.
  });

  browser.runtime.onMessage.addListener(
    (message: unknown, _sender, sendResponse: (response: StatusResponse | { ok: true } | { ok: false; error: string }) => void) => {
      if (sessions.handleOffscreenMessage(message)) {
        sendResponse({ ok: true });
        return true;
      }
      handleMessage(message as ToBackgroundMessage)
        .then(sendResponse)
        .catch((err: unknown) => sendResponse({ ok: false, error: String(err) }));
      return true; // respuesta async
    },
  );

  async function handleMessage(
    message: ToBackgroundMessage,
  ): Promise<StatusResponse | { ok: true } | { ok: false; error: string }> {
    switch (message.type) {
      case "qua:event":
        sessions.enqueue(message.event);
        return { ok: true };
      case "qua:trigger-mark":
        sessions.enqueue({ t: Date.now(), k: "mark", source: "popup" });
        return { ok: true };
      case "qua:start-session": {
        const { baseUrl, viewport, tab } = await resolveActiveTabSessionInfo();
        await sessions.start(baseUrl, viewport, tab);
        return { ok: true };
      }
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
