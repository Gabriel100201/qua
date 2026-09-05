import { browser } from "wxt/browser";
import { DAEMON_HOST, DEFAULT_DAEMON_PORT, wsUrl } from "@qua/protocol";
import type { Event, EnvInfo, SessionControlAction, ViewportInfo } from "@qua/protocol";
import { SessionFsm } from "./fsm.js";
import { Outbox } from "./outbox.js";
import { WsClient } from "./ws-client.js";
import type { WebSocketLike } from "./ws-client.js";
import { TabTracker } from "./tabs.js";
import { ScreenshotRing } from "./screenshots.js";
import { chromeVersion, extVersion, generateSessionId, platformName } from "./env.js";
import {
  isAudioFrameMessage,
  isAudioGapMessage,
  isCaptureErrorMessage,
  isCaptureStartedMessage,
  isRecordingChunkMessage,
  toAudioFrameBytes,
  type OffscreenInboundMessage,
} from "../offscreen/lib/messages.js";
import { TOKEN_STORAGE_KEY } from "../../shared/storage-keys.js";

const OFFSCREEN_URL = "offscreen.html";
const OFFSCREEN_JUSTIFICATION = "Captura audio del micrófono durante la sesión (§05.4).";



async function getToken(): Promise<string> {
  const stored = await browser.storage.local.get(TOKEN_STORAGE_KEY);
  const token = stored[TOKEN_STORAGE_KEY] as string | undefined;
  if (!token) {
    throw new Error("[qua] sin token: emparejá primero desde options.");
  }
  return token;
}

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  return tab?.id;
}

/**
 * `baseUrl`/`viewport` de la pestaña activa, para arrancar una sesión sin que el
 * popup tenga que estar abierto (§09, D-P1-01: el hotkey global dispara con
 * cualquier app en foco, Chrome incluido). `undefined` si no hay pestaña activa o es
 * una página donde no se puede inyectar (`chrome://`, tienda de extensiones, etc.) —
 * en ese caso no hay nada razonable que grabar.
 */
async function activeTabContext(): Promise<
  { baseUrl: string; viewport: ViewportInfo; tab: SessionTab } | undefined
> {
  const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || !tab.url) return undefined;
  try {
    const [injection] = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({ w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio }),
    });
    const viewport = injection?.result as ViewportInfo | undefined;
    if (!viewport) return undefined;
    return { baseUrl: tab.url, viewport, tab: { id: tab.id, title: tab.title ?? "" } };
  } catch {
    return undefined; // página no inyectable (§05 host_permissions no alcanza ahí)
  }
}

/** Identidad de la pestaña sobre la que arranca la sesión — ver D-Z1-01. */
export interface SessionTab {
  id: number;
  title: string;
}

/**
 * Orquesta la FSM de sesión (§5.3), el ciclo de pestañas, el transporte WS+outbox, el
 * ring de screenshots y el offscreen doc que captura audio (§5.4). Es la raíz de
 * composición del service worker.
 */
export class SessionManager {
  private readonly fsm = new SessionFsm();
  private readonly outbox = new Outbox();
  private readonly tabs: TabTracker;
  private readonly screenshots: ScreenshotRing;
  private ws: WsClient | undefined;
  /** Canal de control ocioso de D-P1-01: solo vive mientras `phase === "idle"`, para
   * que `POST /control` (el hotkey global de la app Tauri) tenga a quién reenviarle
   * `session.control` incluso sin sesión abierta. */
  private controlWs: WsClient | undefined;
  /** Para la franja "eventos" del popup (D-U3-01) — ver `StatusResponse.eventsCount`. */
  private eventsCount = 0;

  constructor(
    private readonly now: () => number = Date.now,
    /** Inyectable para tests (`FakeDaemon.createSocket`, como ya hace A2) — `undefined` usa el `WebSocket` real. */
    private readonly createSocket?: (url: string) => WebSocketLike,
    /** Cuánto esperar la primera conexión antes de fallar `start()` con un error
     * concreto (D-U2-01, docs/DECISIONS.md) en vez de dejar la sesión "recording"
     * mientras el WS reintenta en silencio de fondo. */
    private readonly connectTimeoutMs: number = 5000,
  ) {
    this.tabs = new TabTracker((event) => this.onEvent(event), this.now);
    this.screenshots = new ScreenshotRing(this.now, activeTabId);
  }

  /** A correr en cada arranque del service worker: retoma una sesión en curso si el
   * worker se recicló a mitad de grabación (§5.3: estado persistido para eso). */
  async init(): Promise<void> {
    const state = await this.fsm.load();
    if (state.phase === "recording" && state.session) {
      await this.openTransport(state.session.t0Wall, state.session.baseUrl, state.session.env);
      this.tabs.start();
      this.screenshots.start();
      return;
    }
    // "starting"/"stopping" a medio camino en un reciclado: no hay forma segura de
    // confirmar si el `session.start`/`session.stop` salió antes del crash del
    // worker, así que se resuelve a `idle` — mejor pedirle al usuario que reintente
    // que fingir un estado que no se puede verificar.
    if (state.phase === "starting" || state.phase === "stopping") {
      await this.fsm.finish().catch(() => undefined);
    }
    this.openControlChannel();
  }

  getPhase() {
    return this.fsm.current.phase;
  }

  getWsStatus() {
    return this.ws?.getStatus();
  }

  /** epoch ms de arranque de la sesión en curso, o `null` en `idle` (D-U3-01). */
  getStartedAtWall(): number | null {
    return this.fsm.current.session?.t0Wall ?? null;
  }

  /** Eventos aceptados en la sesión en curso (D-U3-01). */
  getEventsCount(): number {
    return this.eventsCount;
  }

  /** Hay token de pairing guardado — no dice nada sobre si el daemon está vivo, solo
   * si options ya completó el emparejamiento (§04, franja de estado del popup). */
  async isPaired(): Promise<boolean> {
    try {
      await getToken();
      return true;
    } catch {
      return false;
    }
  }

  async start(baseUrl: string, viewport: ViewportInfo, tab?: SessionTab): Promise<void> {
    if (this.fsm.current.phase !== "idle") {
      throw new Error("[qua] ya hay una sesión en curso.");
    }
    // Cualquier arranque (popup, hotkey vía `session.control`) cierra el canal de
    // control ocioso de D-P1-01 — no tiene sentido dejarlo colgado mientras graba.
    this.controlWs?.disconnect();
    this.controlWs = undefined;
    const t0Wall = this.now();
    const env: EnvInfo = {
      ua: navigator.userAgent,
      chrome: chromeVersion(),
      platform: platformName(),
      viewport,
      ext: extVersion(),
    };
    const sessionId = generateSessionId(new Date(t0Wall));
    await this.fsm.start({ sessionId, t0Wall, baseUrl, env });
    await this.outbox.reset(); // §03/§04: `seq` es monótono por sesión, no global.
    this.eventsCount = 0;
    try {
      // A diferencia de `init()` retomando una sesión ya confirmada, acá SÍ hace
      // falta esperar la conexión real: es la única forma de que un daemon caído o
      // un token que el daemon rechaza produzcan un error concreto en vez de dejar
      // la FSM en "recording" con el WS reintentando en silencio de fondo (D-U2-01).
      await this.openTransport(t0Wall, baseUrl, env, { waitForConnection: true });
    } catch (err) {
      await this.fsm.abortStart();
      this.ws?.disconnect();
      this.ws = undefined;
      throw err;
    }
    await this.fsm.confirmRecording();

    // El primer `nav` (kind: "load") de la página lo emite el content script al
    // cargar, en `document_start` (`extension/entrypoints/content/main.ts`) — pero
    // eso pasa casi siempre ANTES de que la sesión llegue a "recording" (el caso
    // común: el usuario ya está parado en la página y recién ahí aprieta grabar), y
    // `onEvent` descarta todo evento que llegue mientras la fase no es "recording".
    // Sin esto el correlador nunca ve un `nav`/`tab_switch` para esta pestaña y
    // `route_context` (`qua-core/src/correlate/mod.rs`) resuelve a `url: None` — el
    // reporte ancla a "(ruta desconocida)" aunque `baseUrl` esté perfecto en
    // `session.json`. Se reconstruye acá, ahora que sí es "recording", con la misma
    // URL que ya se resolvió para `session.start` (D-Z1-01, docs/DECISIONS.md).
    this.enqueue({
      t: t0Wall,
      tab: tab?.id,
      k: "nav",
      url: baseUrl,
      title: tab?.title ?? "",
      kind: "load",
    } as Event);

    this.tabs.start();
    this.screenshots.start();

    // Audio (§05.4, A3): no bloquea la sesión si falla — un usuario sin mic o sin
    // permiso concedido todavía sigue grabando eventos + DOM (§15, riesgo conocido:
    // "el permiso de micrófono falla silenciosamente en el offscreen doc").
    try {
      await this.ensureOffscreenDocument();
      this.sendToOffscreen({ type: "qua:start-capture", t0Wall });
    } catch (err) {
      console.warn("[qua] no se pudo arrancar la captura de audio", err);
    }
  }

  async stop(): Promise<void> {
    if (this.fsm.current.phase !== "recording") {
      throw new Error("[qua] no hay sesión grabando para detener.");
    }
    await this.fsm.stop();
    this.tabs.stop();
    this.screenshots.stop();
    this.sendToOffscreen({ type: "qua:stop-capture" });
    try {
      if (await browser.offscreen.hasDocument()) await browser.offscreen.closeDocument();
    } catch (err) {
      console.warn("[qua] no se pudo cerrar el offscreen doc", err);
    }
    await this.ws?.stop(this.now());
    this.ws = undefined;
    await this.fsm.finish();
    this.openControlChannel(); // vuelve a quedar disponible para el próximo hotkey
  }

  enqueue(event: Event): void {
    this.onEvent(event);
  }

  /**
   * Mensajes que suben del offscreen doc (§5.4, D-11 de A3): frames de audio ya
   * empaquetados, huecos de buffer, y el estado de la captura. Devuelve `true` si el
   * mensaje era de este contrato — así `background/index.ts` sabe que no tiene que
   * tratarlo también como `ToBackgroundMessage`.
   */
  handleOffscreenMessage(msg: unknown): boolean {
    if (isAudioFrameMessage(msg)) {
      const bytes = toAudioFrameBytes(msg);
      this.ws?.sendBinary(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      return true;
    }
    if (isAudioGapMessage(msg)) {
      this.enqueue({ t: this.now(), k: "audio_gap", duration_ms: msg.duration_ms } as Event);
      return true;
    }
    if (isCaptureErrorMessage(msg)) {
      console.warn("[qua] error de captura de audio", msg.message);
      return true;
    }
    // `qua:capture-started` no necesita acción; `qua:recording-chunk` (backup opus)
    // todavía no tiene camino de subida al daemon — ver D-13 en docs/DECISIONS.md.
    if (isCaptureStartedMessage(msg) || isRecordingChunkMessage(msg)) {
      return true;
    }
    return false;
  }

  /**
   * `session.control` (§09, D-C1-01): el hotkey global de la app Tauri, reenviado
   * por el daemon. Llega por `this.controlWs` en idle o por `this.ws` ya grabando —
   * cualquiera de los dos invoca esto mismo.
   */
  private async handleControl(action: SessionControlAction, t: number): Promise<void> {
    switch (action) {
      case "start": {
        if (this.fsm.current.phase !== "idle") return;
        const ctx = await activeTabContext();
        if (!ctx) return;
        try {
          await this.start(ctx.baseUrl, ctx.viewport, ctx.tab); // cierra `controlWs` de una
        } catch {
          this.openControlChannel(); // no arrancó (ya había sesión) — seguí escuchando
        }
        break;
      }
      case "stop":
        if (this.fsm.current.phase === "recording") await this.stop();
        break;
      case "mark":
        // Mismo evento que ya genera el hotkey de `chrome.commands` (D-09): el
        // correlador no distingue el origen.
        if (this.fsm.current.phase === "recording") this.enqueue({ t, k: "mark", source: "hotkey" });
        break;
    }
  }

  /** Conecta el canal ocioso que espera `session.control` mientras no hay sesión
   * (D-P1-01). Sin pairing todavía, no hay nada que escuchar — se ignora en
   * silencio, igual que el resto de la extensión antes de emparejar. */
  private openControlChannel(): void {
    if (this.controlWs || this.fsm.current.phase !== "idle") return;
    void (async () => {
      let token: string;
      try {
        token = await getToken();
      } catch {
        return;
      }
      if (this.controlWs || this.fsm.current.phase !== "idle") return;
      const ws = new WsClient({
        url: wsUrl(token),
        hello: { ext_version: extVersion(), chrome: chromeVersion(), platform: platformName() },
        outbox: this.outbox,
        now: this.now,
        createSocket: this.createSocket,
        onSessionControl: (action, t) => void this.handleControl(action, t),
      });
      ws.startSession();
      this.controlWs = ws;
    })();
  }

  private onEvent(event: Event): void {
    if (this.fsm.current.phase !== "recording") return;
    this.eventsCount += 1;
    this.ws?.enqueue(event);
  }

  private sendToOffscreen(msg: OffscreenInboundMessage): void {
    try {
      const maybePromise = browser.runtime.sendMessage(msg) as unknown;
      if (maybePromise && typeof (maybePromise as Promise<unknown>).catch === "function") {
        (maybePromise as Promise<unknown>).catch(() => {
          // El offscreen doc puede no estar listo todavía — se ignora, igual que en
          // el resto de la mensajería interna (mismo patrón que `content/lib/emit.ts`).
        });
      }
    } catch {
      // Contexto de extensión invalidado — nunca debe tirar hacia acá.
    }
  }

  private async ensureOffscreenDocument(): Promise<void> {
    if (await browser.offscreen.hasDocument()) return;
    await browser.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ["USER_MEDIA"],
      justification: OFFSCREEN_JUSTIFICATION,
    });
  }

  /**
   * `waitForConnection: true` (usado por `start()`) no resuelve hasta el primer
   * `hello.ok` del daemon, o rechaza con un error concreto tras
   * `connectTimeoutMs` — así un daemon caído o un token que el daemon rechaza
   * (nunca llega `hello.ok`) fallan `start()` en vez de dejarlo "recording" para
   * siempre (D-U2-01, EL PECADO ORIGINAL de este pase). `false` (el resumen de
   * `init()` tras un reciclado del worker) mantiene el fire-and-forget de
   * siempre: la sesión ya estaba confirmada, no hay nada que abortar acá.
   */
  private async openTransport(
    t0Wall: number,
    baseUrl: string,
    env: EnvInfo,
    opts: { waitForConnection?: boolean } = {},
  ): Promise<void> {
    const token = await getToken();
    const waitForConnection = opts.waitForConnection ?? false;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        fn();
      };

      if (waitForConnection) {
        timer = setTimeout(() => {
          settle(() =>
            reject(
              new Error(
                `[qua] el daemon no responde en ${DAEMON_HOST}:${DEFAULT_DAEMON_PORT} — revisá que quad esté corriendo.`,
              ),
            ),
          );
        }, this.connectTimeoutMs);
      }

      this.ws = new WsClient({
        url: wsUrl(token),
        hello: { ext_version: env.ext, chrome: env.chrome, platform: env.platform },
        outbox: this.outbox,
        now: this.now,
        createSocket: this.createSocket,
        onCaptureRequest: (tab, tTarget) => {
          const frame = this.screenshots.closestTo(tab, tTarget);
          if (frame) this.ws?.sendFrame(frame.t, frame.tab, frame.jpegB64);
        },
        onSessionControl: (action, t) => void this.handleControl(action, t),
        onStatusChange: (status) => {
          this.sendToOffscreen({ type: "qua:connection-state", connected: status === "connected" });
          if (status === "connected") settle(resolve);
        },
      });
      this.ws.startSession({ t0Wall, baseUrl, env });

      if (!waitForConnection) settle(resolve);
    });
  }
}
