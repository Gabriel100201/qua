import { browser } from "wxt/browser";
import { wsUrl } from "@qua/protocol";
import type { Event, EnvInfo, ViewportInfo } from "@qua/protocol";
import { SessionFsm } from "./fsm.js";
import { Outbox } from "./outbox.js";
import { WsClient } from "./ws-client.js";
import { TabTracker } from "./tabs.js";
import { ScreenshotRing } from "./screenshots.js";
import { chromeVersion, extVersion, generateSessionId, platformName } from "./env.js";
import {
  isAudioFrameMessage,
  isAudioGapMessage,
  isCaptureErrorMessage,
  isCaptureStartedMessage,
  isRecordingChunkMessage,
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
 * Orquesta la FSM de sesión (§5.3), el ciclo de pestañas, el transporte WS+outbox y
 * el ring de screenshots. Es la raíz de composición del service worker.
 */
export class SessionManager {
  private readonly fsm = new SessionFsm();
  private readonly outbox = new Outbox();
  private readonly tabs: TabTracker;
  private readonly screenshots: ScreenshotRing;
  private ws: WsClient | undefined;

  constructor(private readonly now: () => number = Date.now) {
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
    }
    // "starting"/"stopping" a medio camino en un reciclado: no hay forma segura de
    // confirmar si el `session.start`/`session.stop` salió antes del crash del
    // worker, así que se resuelve a `idle` — mejor pedirle al usuario que reintente
    // que fingir un estado que no se puede verificar.
    else if (state.phase === "starting" || state.phase === "stopping") {
      await this.fsm.finish().catch(() => undefined);
    }
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
      this.ws?.sendBinary(msg.bytes.buffer.slice(msg.bytes.byteOffset, msg.bytes.byteOffset + msg.bytes.byteLength));
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
      onCaptureRequest: (tab, tTarget) => {
        const frame = this.screenshots.closestTo(tab, tTarget);
        if (frame) this.ws?.sendFrame(frame.t, frame.tab, frame.jpegB64);
      },
      onStatusChange: (status) => {
        this.sendToOffscreen({ type: "qua:connection-state", connected: status === "connected" });
      },
    });
    this.ws.startSession({ t0Wall, baseUrl, env });
  }
}
