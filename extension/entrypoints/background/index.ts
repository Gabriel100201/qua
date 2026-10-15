import { defineBackground } from "wxt/utils/define-background";
import { browser } from "wxt/browser";
import { LocalSessionManager } from "./local-session-manager.js";
import { startKeepalive } from "./keepalive.js";
import type { StatusResponse, ToBackgroundMessage } from "./internal-messages.js";
import { isOverlayAction } from "../../shared/local/overlay-protocol.js";
import { MODEL_STATE_KEY } from "../../shared/local/model-state.js";
import { isRecordable } from "../../shared/ui/format.js";
import { extUrl, reportUrl, sessionFromNotification } from "./notify.js";

/**
 * Service worker del modo local (D-L1-01): junta eventos y capturas, mueve la FSM, y es
 * la única fuente del estado que muestran el popup, la pastilla y el ícono de la barra.
 */
export default defineBackground(() => {
  const sessions = new LocalSessionManager();
  // Un error de arranque no puede perderse: queda como lastError y lo ve el popup.
  const ready = sessions.init().catch((err: unknown) => sessions.reportError(`No pude arrancar: ${err instanceof Error ? err.message : String(err)}`));
  startKeepalive(() => undefined);

  // Primera vez: la bienvenida (diseño "Primera vez") se abre sola al instalar.
  browser.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === "install") void browser.tabs.create({ url: extUrl("/onboarding.html") });
  });

  browser.notifications?.onClicked.addListener((id) => {
    const sid = sessionFromNotification(id);
    if (sid) void browser.tabs.create({ url: reportUrl(sid) });
    void browser.notifications.clear(id);
  });
  browser.notifications?.onButtonClicked.addListener((id) => {
    const sid = sessionFromNotification(id);
    if (sid) void sessions.copyReport(sid);
  });

  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse: (r: unknown) => void) => {
    if (sessions.handleOffscreenMessage(message)) {
      sendResponse({ ok: true });
      return true;
    }
    if (isOverlayAction(message)) {
      const a = message;
      if (a.action === "mark") sessions.mark("popup");
      else if (a.action === "stop") void sessions.stop().catch((e: unknown) => sessions.reportError(e));
      else if (a.action === "open-report") {
        void (async () => {
          const id = a.sessionId ?? (await sessions.latestSession().catch(() => undefined))?.id;
          if (id) await browser.tabs.create({ url: reportUrl(id) });
        })();
      }
      else if (a.action === "fix-mic") void browser.tabs.create({ url: extUrl("/onboarding.html#microfono") });
      sendResponse({ ok: true });
      return true;
    }
    handleMessage(message as ToBackgroundMessage, sender)
      .then(sendResponse)
      .catch((err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
    return true;
  });

  async function handleMessage(message: ToBackgroundMessage, sender: chrome.runtime.MessageSender): Promise<unknown> {
    await ready; // nada se atiende antes de que init() termine (evita carreras con "grabar")
    switch (message.type) {
      case "qua:event":
        sessions.enqueue(message.event);
        return { ok: true };
      case "qua:trigger-mark":
        sessions.mark("popup");
        return { ok: true };
      case "qua:start-session":
        await sessions.startOnActiveTab();
        return { ok: true };
      case "qua:stop-session":
        await sessions.stop();
        return { ok: true };
      case "qua:retry":
        await sessions.retry(message.sessionId);
        return { ok: true };
      case "qua:scheme":
        await sessions.setDark(message.dark);
        return { ok: true };
      case "qua:overlay-hello": {
        // Una pestaña recién cargada pregunta si tiene que mostrar la pastilla.
        const tabId = sender.tab?.id;
        return { state: tabId !== undefined ? await sessions.overlayStateFor(tabId) : { kind: "hidden" } };
      }
      case "qua:get-status":
        return status(message.seen === true);
      default:
        return { ok: false, error: "mensaje desconocido" };
    }
  }

  async function status(seen: boolean): Promise<StatusResponse> {
    if (seen) await sessions.seen();
    const [latest, [tab], model] = await Promise.all([
      sessions.latestSession().catch(() => undefined),
      browser.tabs.query({ active: true, lastFocusedWindow: true }),
      browser.storage.local.get(MODEL_STATE_KEY),
    ]);
    const t0 = sessions.getStartedAtWall();
    return {
      phase: sessions.getPhase(),
      paired: true,
      startedAtWall: t0,
      eventsCount: sessions.getEventsCount(),
      lastError: sessions.getLastError(),
      micReady: sessions.isMicReady(),
      marks: t0 === null ? [] : sessions.getMarks().map((m) => m - t0),
      tab: { url: tab?.url ?? "", recordable: isRecordable(tab?.url) },
      model: (model[MODEL_STATE_KEY] as StatusResponse["model"]) ?? { status: "sin_descargar" },
      latest: latest
        ? {
            id: latest.id,
            status: latest.status,
            progress: latest.progress,
            issues: latest.issues,
            error: latest.error,
            baseUrl: latest.meta.base_url,
            durationMs: latest.duration_ms ?? (latest.t_stop ? latest.t_stop - latest.meta.t0_wall : undefined),
            issueTimes: latest.issue_times,
            updatedAt: latest.updated_at,
          }
        : null,
    };
  }

  browser.commands?.onCommand.addListener((command: string) => {
    if (command === "toggle_recording") {
      if (sessions.getPhase() === "recording") void sessions.stop().catch((e: unknown) => sessions.reportError(e));
      else if (sessions.getPhase() === "idle") void sessions.startOnActiveTab().catch((e: unknown) => sessions.reportError(e));
    } else if (command === "drop_mark") {
      sessions.mark("hotkey");
    }
  });
});
