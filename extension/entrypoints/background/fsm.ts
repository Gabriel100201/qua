import { browser } from "wxt/browser";
import type { EnvInfo } from "@qua/protocol";

/** FSM de sesión (§5.3): idle → starting → recording → stopping → idle. */
export type SessionPhase = "idle" | "starting" | "recording" | "stopping";

export interface SessionInfo {
  sessionId: string;
  t0Wall: number;
  baseUrl: string;
  env: EnvInfo;
}

export interface SessionState {
  phase: SessionPhase;
  session?: SessionInfo;
}

const STORAGE_KEY = "qua:session-state";
const IDLE_STATE: SessionState = { phase: "idle" };

const TRANSITIONS: Record<SessionPhase, SessionPhase[]> = {
  idle: ["starting"],
  starting: ["recording", "idle"], // idle: abortó antes de confirmar (§04 error de pairing/conexión)
  recording: ["stopping"],
  stopping: ["idle"],
};

/**
 * Máquina de estados de la sesión, persistida en `chrome.storage.session` para
 * sobrevivir el reciclado del service worker (§5.3). `chrome.storage.session` en sí
 * ya se limpia sola en un reinicio real del navegador, que es exactamente cuándo
 * queremos volver a `idle`.
 */
export class SessionFsm {
  private cached: SessionState = IDLE_STATE;
  private loaded = false;

  async load(): Promise<SessionState> {
    const stored = await browser.storage.session.get(STORAGE_KEY);
    const value = stored[STORAGE_KEY] as SessionState | undefined;
    this.cached = value ?? IDLE_STATE;
    this.loaded = true;
    return this.cached;
  }

  get current(): SessionState {
    if (!this.loaded) {
      throw new Error("SessionFsm: llamá a load() antes de leer el estado");
    }
    return this.cached;
  }

  private async persist(next: SessionState): Promise<void> {
    this.cached = next;
    this.loaded = true;
    await browser.storage.session.set({ [STORAGE_KEY]: next });
  }

  private assertTransition(to: SessionPhase): void {
    const from = this.cached.phase;
    if (!TRANSITIONS[from].includes(to)) {
      throw new Error(`SessionFsm: transición inválida ${from} → ${to}`);
    }
  }

  async start(session: SessionInfo): Promise<void> {
    this.assertTransition("starting");
    await this.persist({ phase: "starting", session });
  }

  async confirmRecording(): Promise<void> {
    this.assertTransition("recording");
    await this.persist({ phase: "recording", session: this.cached.session });
  }

  /** Aborta antes de confirmar (p.ej. el `hello`/pairing inicial falló). */
  async abortStart(): Promise<void> {
    this.assertTransition("idle");
    await this.persist(IDLE_STATE);
  }

  async stop(): Promise<void> {
    this.assertTransition("stopping");
    await this.persist({ phase: "stopping", session: this.cached.session });
  }

  async finish(): Promise<void> {
    this.assertTransition("idle");
    await this.persist(IDLE_STATE);
  }

  isActive(): boolean {
    return this.cached.phase === "recording" || this.cached.phase === "starting";
  }
}
