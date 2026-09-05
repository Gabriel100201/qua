import { browser } from "wxt/browser";
import { wsUrl } from "@qua/protocol";
import type { Event, EnvInfo, ViewportInfo } from "@qua/protocol";
import { SessionFsm } from "./fsm.js";
import { Outbox } from "./outbox.js";
import { WsClient } from "./ws-client.js";
import { TabTracker } from "./tabs.js";
import { ScreenshotRing } from "./screenshots.js";
import { chromeVersion, extVersion, generateSessionId, platformName } from "./env.js";

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
  }

  async stop(): Promise<void> {
    if (this.fsm.current.phase !== "recording") {
      throw new Error("SessionManager: no hay sesión grabando para detener");
    }
    await this.fsm.stop();
    this.tabs.stop();
    this.screenshots.stop();
    await this.ws?.stop(this.now());
    this.ws = undefined;
    await this.fsm.finish();
  }

  enqueue(event: Event): void {
    this.onEvent(event);
  }

  private onEvent(event: Event): void {
    if (this.fsm.current.phase !== "recording") return;
    this.ws?.enqueue(event);
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
    });
    this.ws.startSession({ t0Wall, baseUrl, env });
  }
}
