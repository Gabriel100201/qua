import { browser } from "wxt/browser";
import type { EnvInfo, Event, ViewportInfo } from "@qua/protocol";
import { SessionFsm } from "./fsm.js";
import { TabTracker } from "./tabs.js";
import { ScreenshotRing } from "./screenshots.js";
import { chromeVersion, extVersion, generateSessionId, platformName } from "./env.js";
import { LocalStore, type LocalSession } from "../../shared/local/store.js";
import {
  isCaptureErrorMessage,
  isCaptureStartedMessage,
  isModelStateMessage,
  isProcessDoneMessage,
  type OffscreenInboundMessage,
} from "../offscreen/lib/messages.js";
import { MODEL_STATE_KEY } from "../../shared/local/model-state.js";

const OFFSCREEN_URL = "offscreen.html";
/** Mismo archivo que declara `content_scripts` en el manifest (WXT). */
const CONTENT_SCRIPT_FILE = "content-scripts/content.js";
const OFFSCREEN_JUSTIFICATION =
  "Captura el micrófono durante la sesión y transcribe el audio localmente al terminar (§05.4).";

/** Mismo batching que el WS de §04: cada 500 ms o 50 eventos. */
const FLUSH_INTERVAL_MS = 500;
const FLUSH_MAX_EVENTS = 50;

export interface SessionTab {
  id: number;
  title: string;
}

async function activeTabContext(): Promise<{ baseUrl: string; viewport: ViewportInfo; tab: SessionTab } | undefined> {
  const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || !tab.url) return undefined;
  try {
    const [injection] = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({ w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1 }),
    });
    const viewport = injection?.result as ViewportInfo | undefined;
    if (!viewport) return undefined;
    return { baseUrl: tab.url, viewport, tab: { id: tab.id, title: tab.title ?? "" } };
  } catch {
    return undefined; // chrome://, la Web Store, etc.: no hay nada que grabar ahí
  }
}

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  return tab?.id;
}

/**
 * Sesión del modo local (D-L1-01). Misma FSM, mismo ciclo de pestañas y mismo ring de
 * capturas que `SessionManager`, pero sin daemon: los eventos van a IndexedDB
 * (`LocalStore`) y al detener, el offscreen doc procesa la sesión entera.
 */
export class LocalSessionManager {
  private readonly fsm = new SessionFsm();
  private readonly tabs: TabTracker;
  private readonly screenshots: ScreenshotRing;
  private buffer: Event[] = [];
  private flushTimer: ReturnType<typeof setInterval> | undefined;
  private eventsCount = 0;
  private lastError: string | null = null;
  /** El offscreen confirmó que el micrófono ya entrega audio (`qua:capture-started`). */
  private micReady = false;

  constructor(
    private readonly store: LocalStore = new LocalStore(),
    private readonly now: () => number = Date.now,
  ) {
    this.tabs = new TabTracker((event) => this.onEvent(event), this.now);
    this.screenshots = new ScreenshotRing(this.now, activeTabId);
  }

  /** Retoma una grabación si el worker se recicló a mitad (el offscreen doc, con el
   * audio, sigue vivo: no depende del service worker). */
  async init(): Promise<void> {
    const state = await this.fsm.load();
    if (state.phase === "recording" && state.session) {
      this.tabs.start();
      this.screenshots.start();
      this.startFlushing();
      return;
    }
    if (state.phase === "starting" || state.phase === "stopping") {
      await this.fsm.finish().catch(() => undefined);
    }
  }

  getPhase() {
    return this.fsm.current.phase;
  }

  getStartedAtWall(): number | null {
    return this.fsm.current.session?.t0Wall ?? null;
  }

  getEventsCount(): number {
    return this.eventsCount;
  }

  isMicReady(): boolean {
    return this.micReady;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  reportError(err: unknown): void {
    this.lastError = err instanceof Error ? err.message : String(err);
  }

  latestSession(): Promise<LocalSession | undefined> {
    return this.store.latestSession();
  }

  /** Arranca desde el hotkey global o desde el popup sin datos de la pestaña. */
  async startOnActiveTab(): Promise<void> {
    const ctx = await activeTabContext();
    if (!ctx) throw new Error("No puedo grabar esta pestaña. Abrí la página que querés revisar.");
    await this.start(ctx.baseUrl, ctx.viewport, ctx.tab);
  }

  async start(baseUrl: string, viewport: ViewportInfo, tab?: SessionTab): Promise<void> {
    if (this.fsm.current.phase !== "idle") throw new Error("Ya hay una sesión en curso.");
    const latest = await this.store.latestSession();
    if (latest?.status === "processing") {
      throw new Error("Todavía estoy procesando la sesión anterior. Esperá a que termine.");
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
    await this.store.putSession({
      id: sessionId,
      status: "recording",
      meta: { id: sessionId, t0_wall: t0Wall, started_at: new Date(t0Wall).toISOString(), base_url: baseUrl, env },
    });
    await this.fsm.confirmRecording();
    this.eventsCount = 0;
    this.lastError = null;
    this.micReady = false;

    // Ver el comentario equivalente en `SessionManager.start`: el `nav` de carga
    // ocurrió antes de grabar, así que se reconstruye con la URL ya conocida.
    this.enqueue({ t: t0Wall, tab: tab?.id, k: "nav", url: baseUrl, title: tab?.title ?? "", kind: "load" } as Event);

    this.tabs.start();
    this.screenshots.start();
    this.startFlushing();
    if (tab) await this.ensureContentScript(tab.id);
    browser.tabs.onActivated.addListener(this.onTabActivated);

    try {
      await this.ensureOffscreenDocument();
      this.sendToOffscreen({ type: "qua:start-capture", t0Wall });
      // Precargar solo si el modelo todavía no se bajó nunca: la descarga es red y no
      // molesta. Si ya está en caché, cargarlo es inicializar ~1 GB en la GPU, y hacerlo
      // mientras se graba le saca muestras al hilo de audio (medido en el E2E: sesiones
      // enteras sin voz). En ese caso se inicializa al detener, que tarda unos segundos.
      const stored = await browser.storage.local.get(MODEL_STATE_KEY);
      if ((stored[MODEL_STATE_KEY] as { status?: string } | undefined)?.status !== "listo") {
        this.sendToOffscreen({ type: "qua:preload-model" });
      }
    } catch (err) {
      // Sin micrófono la sesión sigue: eventos + DOM igual dan un reporte (§15).
      this.lastError = `No pude abrir el micrófono: ${String(err)}`;
    }
  }

  async stop(): Promise<void> {
    const session = this.fsm.current.session;
    if (this.fsm.current.phase !== "recording" || !session) throw new Error("No hay una sesión grabando.");
    await this.fsm.stop();
    browser.tabs.onActivated.removeListener(this.onTabActivated);
    this.tabs.stop();
    this.screenshots.stop();
    this.stopFlushing();
    await this.flush();

    const tStop = this.now();
    const endedAt = new Date(tStop).toISOString();
    await this.store.updateSession(session.sessionId, { status: "processing", t_stop: tStop, ended_at: endedAt });
    await this.fsm.finish();

    if (await browser.offscreen.hasDocument()) {
      this.sendToOffscreen({ type: "qua:process-session", sessionId: session.sessionId, tStop, endedAt });
    } else {
      // El documento se perdió (Chrome lo cerró): no hay audio, pero el reporte de
      // eventos se puede armar igual. Se abre uno nuevo solo para procesar.
      await this.ensureOffscreenDocument();
      this.sendToOffscreen({ type: "qua:process-session", sessionId: session.sessionId, tStop, endedAt });
    }
  }

  enqueue(event: Event): void {
    this.onEvent(event);
  }

  /** Mensajes del offscreen doc. `true` si era de este contrato. */
  handleOffscreenMessage(msg: unknown): boolean {
    if (isProcessDoneMessage(msg)) {
      if (!msg.ok) this.lastError = `No pude procesar la sesión: ${msg.error ?? "error desconocido"}`;
      void this.closeOffscreenIfIdle();
      return true;
    }
    if (isModelStateMessage(msg)) {
      void browser.storage.local.set({ [MODEL_STATE_KEY]: msg.state });
      return true;
    }
    if (isCaptureErrorMessage(msg)) {
      this.lastError = `Micrófono: ${msg.message}`;
      return true;
    }
    if (isCaptureStartedMessage(msg)) {
      this.micReady = true;
      return true;
    }
    if ((msg as { type?: string } | null)?.type === "qua:keepalive") return true;
    return false;
  }

  private readonly onTabActivated = ({ tabId }: { tabId: number }) => {
    void this.ensureContentScript(tabId);
  };

  /**
   * Chrome no inyecta los content scripts del manifest en pestañas que ya estaban
   * abiertas cuando se instaló o recargó la extensión. Sin esto, grabar en esa pestaña
   * no registra ni un click (pasó en la primera prueba real del modo local): el reporte
   * solo tiene el audio y la ruta. Si la pestaña no contesta el ping, se inyecta acá.
   */
  async ensureContentScript(tabId: number): Promise<void> {
    try {
      await browser.tabs.sendMessage(tabId, { type: "qua:ping" });
      return; // ya está
    } catch {
      // nadie contestó: hay que inyectarlo
    }
    try {
      await browser.scripting.executeScript({ target: { tabId }, files: [CONTENT_SCRIPT_FILE] });
    } catch {
      // chrome://, la Web Store, PDFs: ahí no se puede, y tampoco hay DOM que grabar
    }
  }

  private onEvent(event: Event): void {
    if (this.fsm.current.phase !== "recording") return;
    this.eventsCount += 1;
    this.buffer.push(event);
    if (this.buffer.length >= FLUSH_MAX_EVENTS) void this.flush();
  }

  private startFlushing(): void {
    this.flushTimer ??= setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
  }

  private stopFlushing(): void {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = undefined;
  }

  private async flush(): Promise<void> {
    const sessionId = this.fsm.current.session?.sessionId;
    if (!sessionId || !this.buffer.length) return;
    const batch = this.buffer;
    this.buffer = [];
    try {
      await this.store.appendEvents(sessionId, batch);
    } catch (err) {
      this.buffer = batch.concat(this.buffer); // se reintenta en el próximo tick
      this.lastError = `No pude guardar eventos: ${String(err)}`;
    }
  }

  private async closeOffscreenIfIdle(): Promise<void> {
    if (this.fsm.current.phase !== "idle") return;
    try {
      if (await browser.offscreen.hasDocument()) await browser.offscreen.closeDocument();
    } catch {
      // ya estaba cerrado
    }
  }

  private sendToOffscreen(msg: OffscreenInboundMessage): void {
    try {
      const p = browser.runtime.sendMessage(msg) as unknown;
      if (p && typeof (p as Promise<unknown>).catch === "function") (p as Promise<unknown>).catch(() => undefined);
    } catch {
      // contexto invalidado
    }
  }

  private async ensureOffscreenDocument(): Promise<void> {
    if (await browser.offscreen.hasDocument()) return;
    await browser.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ["USER_MEDIA", "WORKERS"],
      justification: OFFSCREEN_JUSTIFICATION,
    });
  }
}
