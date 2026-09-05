import { browser } from "wxt/browser";
import { wsUrl } from "@qua/protocol";
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

const OFFSCREEN_URL = "offscreen.html";
const OFFSCREEN_JUSTIFICATION = "Captura audio del micrófono durante la sesión (§05.4).";

const TOKEN_STORAGE_KEY = "qua:daemon-token";

async function getToken(): Promise<string> {
  const stored = await browser.storage.local.get(TOKEN_STORAGE_KEY);
  const token = stored[TOKEN_STORAGE_KEY] as string | undefined;
  if (!token) {
    throw new Error(
      "SessionManager: no hay token de pairing (chrome.storage.local). Emparejá primero desde options.",
    );
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
async function activeTabContext(): Promise<{ baseUrl: string; viewport: ViewportInfo } | undefined> {
  const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || !tab.url) return undefined;
  try {
    const [injection] = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({ w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio }),
    });
    const viewport = injection?.result as ViewportInfo | undefined;
    if (!viewport) return undefined;
    return { baseUrl: tab.url, viewport };
  } catch {
    return undefined; // página no inyectable (§05 host_permissions no alcanza ahí)
  }
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

  constructor(
    private readonly now: () => number = Date.now,
    /** Inyectable para tests (`FakeDaemon.createSocket`, como ya hace A2) — `undefined` usa el `WebSocket` real. */
    private readonly createSocket?: (url: string) => WebSocketLike,
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

  async start(baseUrl: string, viewport: ViewportInfo): Promise<void> {
    if (this.fsm.current.phase !== "idle") {
      throw new Error("SessionManager: ya hay una sesión en curso");
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
    try {
      await this.openTransport(t0Wall, baseUrl, env);
    } catch (err) {
      await this.fsm.abortStart();
      throw err;
    }
    await this.fsm.confirmRecording();
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
      throw new Error("SessionManager: no hay sesión grabando para detener");
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
          await this.start(ctx.baseUrl, ctx.viewport); // cierra `controlWs` de una
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

  private async openTransport(t0Wall: number, baseUrl: string, env: EnvInfo): Promise<void> {
    const token = await getToken();
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
      },
    });
    this.ws.startSession({ t0Wall, baseUrl, env });
  }
}
