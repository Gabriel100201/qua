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
import { processingLabel, processingProgress, type OverlayState } from "../../shared/local/overlay-protocol.js";
import { setActionState, type ActionState } from "./action-icon.js";
import { notifyReady } from "./notify.js";

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

/** Mensaje a una pestaña sin esperar respuesta: si no hay content script, no pasa nada. */
function toTab(tabId: number, message: unknown): void {
  try {
    void Promise.resolve(browser.tabs.sendMessage(tabId, message)).catch(() => undefined);
  } catch {
    // pestaña cerrada o sin content script
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
  /** Instantes (epoch ms) de cada marca de la sesión en curso: muescas en el anillo. */
  private marks: number[] = [];
  /** Pestaña donde se ve la pastilla (la activa mientras se graba o se procesa). */
  private overlayTab: number | undefined;
  private watchTimer: ReturnType<typeof setInterval> | undefined;
  private dark = false;
  /** Sesión cuyo "listo" ya se avisó (notificación + badge), para no repetirlo. */
  private announced: string | undefined;

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
    this.dark = Boolean((await browser.storage.local.get("qua:dark"))["qua:dark"]);
    let latest = await this.store.latestSession().catch(() => undefined);
    // Chrome se cerró (o el offscreen murió) a mitad de procesar: sin documento que la
    // procese, la sesión quedaría "procesando" para siempre y no dejaría grabar otra.
    if (latest?.status === "processing" && !(await this.hasOffscreen())) {
      latest = await this.store.updateSession(latest.id, { status: "failed", progress: undefined, error: "Se interrumpió el procesamiento" });
    }
    if (latest?.status === "processing") this.watchProcessing();
    else await this.refreshIcon(latest);
  }

  getMarks(): number[] {
    return this.marks;
  }

  /** Las páginas de la extensión avisan si el sistema está en modo oscuro (barra de Chrome oscura). */
  async setDark(dark: boolean): Promise<void> {
    if (dark === this.dark) return;
    this.dark = dark;
    await browser.storage.local.set({ "qua:dark": dark });
    await this.refreshIcon(await this.store.latestSession().catch(() => undefined));
  }

  /** Marca un momento (popup, atajo o la bandera de la pastilla). */
  mark(source: "popup" | "hotkey"): void {
    if (this.fsm.current.phase !== "recording") return;
    const t = this.now();
    this.marks.push(t);
    this.enqueue({ t, k: "mark", source } as Event);
    void this.broadcast();
  }

  /** El usuario abrió el popup: el número de issues del badge ya se vio. */
  async seen(): Promise<void> {
    const latest = await this.store.latestSession().catch(() => undefined);
    if (latest?.status === "ready") await setActionState({ kind: "idle" }, this.dark);
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
    if (latest?.status === "processing" && !(await this.hasOffscreen())) {
      await this.store.updateSession(latest.id, { status: "failed", progress: undefined, error: "Se interrumpió el procesamiento" });
    } else if (latest?.status === "processing") {
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
    this.marks = [];
    this.overlayTab = tab?.id;

    // Ver el comentario equivalente en `SessionManager.start`: el `nav` de carga
    // ocurrió antes de grabar, así que se reconstruye con la URL ya conocida.
    this.enqueue({ t: t0Wall, tab: tab?.id, k: "nav", url: baseUrl, title: tab?.title ?? "", kind: "load" } as Event);

    this.tabs.start();
    this.screenshots.start();
    this.startFlushing();
    if (tab) await this.ensureContentScript(tab.id);
    browser.tabs.onActivated.addListener(this.onTabActivated);
    void this.broadcast();

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
    await this.store.updateSession(session.sessionId, {
      status: "processing",
      t_stop: tStop,
      ended_at: endedAt,
      mark_times: this.marks.map((m) => m - session.t0Wall),
      duration_ms: tStop - session.t0Wall,
    });
    await this.fsm.finish();
    this.watchProcessing();

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

  /** "Reintentar" del popup: vuelve a procesar con el audio guardado de esa sesión. */
  async retry(sessionId: string): Promise<void> {
    const row = await this.store.getSession(sessionId);
    if (!row) throw new Error("No encontré esa sesión.");
    if (this.fsm.current.phase !== "idle") throw new Error("Terminá la grabación en curso primero.");
    const tStop = row.t_stop ?? this.now();
    await this.store.updateSession(sessionId, { status: "processing", error: undefined, progress: undefined });
    this.lastError = null;
    await this.ensureOffscreenDocument();
    this.sendToOffscreen({ type: "qua:process-session", sessionId, tStop, endedAt: row.ended_at ?? new Date(tStop).toISOString() });
    this.watchProcessing();
  }

  /** Copia el reporte al portapapeles sin documento propio (botón de la notificación). */
  async copyReport(sessionId: string): Promise<void> {
    const row = await this.store.getSession(sessionId);
    if (!row?.report_md) return;
    await this.ensureOffscreenDocument();
    this.sendToOffscreen({ type: "qua:copy", text: row.report_md } as unknown as OffscreenInboundMessage);
  }

  /** Estado de la pastilla según la fase y la última sesión. */
  async overlayState(): Promise<OverlayState> {
    const phase = this.fsm.current.phase;
    if (phase === "recording" || phase === "starting") {
      if (this.lastError?.startsWith("Micrófono") || this.lastError?.startsWith("No pude abrir")) return { kind: "error", message: "Sin micrófono" };
      if (!this.micReady) return { kind: "opening" };
      return { kind: "recording", startedAtWall: this.fsm.current.session?.t0Wall ?? this.now(), marks: this.marks.length };
    }
    const latest = await this.store.latestSession().catch(() => undefined);
    if (latest?.status === "processing") return { kind: "processing", label: processingLabel(latest.progress), progress: processingProgress(latest.progress) };
    if (latest?.status === "ready" && this.now() - latest.updated_at < 8000) return { kind: "ready", issues: latest.issues ?? 0, sessionId: latest.id };
    return { kind: "hidden" };
  }

  /** Lleva el estado a la pastilla y al ícono de la barra. */
  async broadcast(): Promise<void> {
    const state = await this.overlayState();
    if (this.overlayTab !== undefined) {
      toTab(this.overlayTab, { type: "qua:overlay", state });
    }
    const action: ActionState =
      state.kind === "opening" ? { kind: "opening" }
      : state.kind === "recording" ? { kind: "recording" }
      : state.kind === "processing" ? { kind: "processing", progress: state.progress }
      : { kind: "idle" };
    if (state.kind !== "hidden" && state.kind !== "ready" && state.kind !== "error") await setActionState(action, this.dark);
  }

  private async refreshIcon(latest?: LocalSession): Promise<void> {
    if (latest?.status === "ready" && latest.id !== this.announced && this.now() - latest.updated_at < 10 * 60_000) {
      await setActionState({ kind: "ready", issues: latest.issues ?? 0 }, this.dark);
    } else await setActionState({ kind: "idle" }, this.dark);
  }

  /** Mientras se procesa: avance en la pastilla y el ícono; al terminar, aviso. */
  private watchProcessing(): void {
    if (this.watchTimer) return;
    this.watchTimer = setInterval(() => void this.tickProcessing(), 700);
  }

  private async tickProcessing(): Promise<void> {
    const latest = await this.store.latestSession().catch(() => undefined);
    await this.broadcast();
    if (!latest || latest.status === "processing" || latest.status === "recording") return;
    clearInterval(this.watchTimer);
    this.watchTimer = undefined;
    if (latest.status === "ready" && this.announced !== latest.id) {
      this.announced = latest.id;
      await setActionState({ kind: "ready", issues: latest.issues ?? 0 }, this.dark);
      await notifyReady(latest).catch(() => undefined);
      // La pastilla muestra "N issues · Ver reporte" y se va sola a los 8 s.
      setTimeout(() => void this.broadcast(), 8200);
    }
  }

  /** Mensajes del offscreen doc. `true` si era de este contrato. */
  handleOffscreenMessage(msg: unknown): boolean {
    if (isProcessDoneMessage(msg)) {
      if (!msg.ok) this.lastError = `No pude procesar la sesión: ${msg.error ?? "error desconocido"}`;
      void this.closeOffscreenIfIdle();
      void this.tickProcessing();
      return true;
    }
    if (isModelStateMessage(msg)) {
      void browser.storage.local.set({ [MODEL_STATE_KEY]: msg.state });
      return true;
    }
    if (isCaptureErrorMessage(msg)) {
      this.lastError = `Micrófono: ${msg.message}`;
      void this.broadcast();
      return true;
    }
    if (isCaptureStartedMessage(msg)) {
      this.micReady = true;
      void this.broadcast();
      return true;
    }
    if ((msg as { type?: string } | null)?.type === "qua:level") {
      // La onda de la pastilla sigue al micrófono; el popup recibe el mismo mensaje directo.
      if (this.overlayTab !== undefined && this.fsm.current.phase === "recording") {
        toTab(this.overlayTab, { type: "qua:overlay-level", levels: (msg as unknown as { levels: number[] }).levels });
      }
      return true;
    }
    if ((msg as { type?: string } | null)?.type === "qua:copied") {
      void this.closeOffscreenIfIdle();
      return true;
    }
    if ((msg as { type?: string } | null)?.type === "qua:keepalive") return true;
    return false;
  }

  private readonly onTabActivated = ({ tabId }: { tabId: number }) => {
    // La pastilla acompaña a la pestaña activa: se va de la anterior y aparece en la nueva.
    const prev = this.overlayTab;
    this.overlayTab = tabId;
    if (prev !== undefined && prev !== tabId) toTab(prev, { type: "qua:overlay", state: { kind: "hidden" } });
    void this.ensureContentScript(tabId).then(() => this.broadcast());
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
    const latest = await this.store.latestSession().catch(() => undefined);
    if (latest?.status === "processing") return;
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

  private async hasOffscreen(): Promise<boolean> {
    try {
      return await browser.offscreen.hasDocument();
    } catch {
      return false;
    }
  }

  private async ensureOffscreenDocument(): Promise<void> {
    if (await browser.offscreen.hasDocument()) return;
    await browser.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ["USER_MEDIA", "WORKERS", "CLIPBOARD"],
      justification: OFFSCREEN_JUSTIFICATION,
    });
  }
}
