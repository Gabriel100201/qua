import { defineBackground } from "wxt/utils/define-background";
import { browser } from "wxt/browser";
import type { ViewportInfo } from "@qua/protocol";
import { LocalSessionManager, type SessionTab } from "./local-session-manager.js";
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
    throw new Error("No hay una pestaña activa para grabar.");
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

/**
 * Modo local (D-L1-01): no hay daemon ni pairing. El service worker junta eventos y
 * capturas en IndexedDB y, al detener, el offscreen doc transcribe y arma el reporte.
 */
export default defineBackground(() => {
  const sessions = new LocalSessionManager();
  void sessions.init();

  // Primer uso: el permiso de micrófono solo se puede dar desde una página visible de
  // la extensión, así que options se abre sola al instalar (onboarding de D4).
  browser.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === "install") void browser.runtime.openOptionsPage();
  });

  startKeepalive(() => {
    // Red de seguridad de §5.3: despertar el worker alcanza para resetear el timeout.
  });

  browser.runtime.onMessage.addListener(
    (message: unknown, _sender, sendResponse: (response: StatusResponse | { ok: true } | { ok: false; error: string }) => void) => {
      if (sessions.handleOffscreenMessage(message)) {
        sendResponse({ ok: true });
        return true;
      }
      handleMessage(message as ToBackgroundMessage)
        .then(sendResponse)
        .catch((err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
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
      case "qua:get-status": {
        const latest = await sessions.latestSession().catch(() => undefined);
        return {
          phase: sessions.getPhase(),
          paired: true,
          startedAtWall: sessions.getStartedAtWall(),
          eventsCount: sessions.getEventsCount(),
          lastError: sessions.getLastError(),
          micReady: sessions.isMicReady(),
          latest: latest
            ? { id: latest.id, status: latest.status, progress: latest.progress, issues: latest.issues, error: latest.error }
            : null,
        };
      }
      default:
        return { ok: false, error: "mensaje desconocido" };
    }
  }

  browser.commands?.onCommand.addListener((command: string) => {
    if (command === "toggle_recording") {
      // Sin daemon, el hotkey (global, D-L1-01) arranca y para: el SW resuelve la
      // pestaña activa igual que cuando lo pide el popup.
      // Sin popup abierto no hay dónde mostrar un error en el momento: queda en
      // `lastError` y el popup lo muestra la próxima vez que se abra.
      if (sessions.getPhase() === "recording") void sessions.stop().catch((e: unknown) => sessions.reportError(e));
      else if (sessions.getPhase() === "idle") void sessions.startOnActiveTab().catch((e: unknown) => sessions.reportError(e));
    } else if (command === "drop_mark") {
      sessions.enqueue({ t: Date.now(), k: "mark", source: "hotkey" });
    }
  });
});
