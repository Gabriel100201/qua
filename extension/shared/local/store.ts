import type { EnvInfo, Event } from "@qua/protocol";

/**
 * Persistencia del modo local (D-L1-01): reemplaza a `~/.qua/sessions/` + SQLite.
 *
 * Es una sola base de IndexedDB del origen `chrome-extension://<id>`, así que la ven
 * igual el service worker (escribe eventos), el offscreen doc (procesa y guarda el
 * resultado) y el popup (lee el reporte). Nada sale de la máquina.
 */

export const LOCAL_DB_NAME = "qua-local";
const DB_VERSION = 1;
const EVENTS = "events";
const SESSIONS = "sessions";
const ASSETS = "assets";

export type LocalSessionStatus = "recording" | "processing" | "ready" | "failed";

export interface ProcessingProgress {
  stage: "modelo" | "voz" | "transcripcion" | "reporte";
  done: number;
  total: number;
}

export interface LocalSessionMeta {
  id: string;
  t0_wall: number;
  started_at: string;
  base_url: string;
  env: EnvInfo;
}

export interface LocalSession {
  id: string;
  meta: LocalSessionMeta;
  status: LocalSessionStatus;
  t_stop?: number;
  ended_at?: string;
  progress?: ProcessingProgress;
  /** Audio que llegó al procesamiento, en ms (0 = el micrófono no entregó nada). */
  audio_ms?: number;
  /** Pico absoluto del PCM (0..32767): cerca de 0 es un micrófono mudo o sin permiso. */
  audio_peak?: number;
  /** Diagnóstico de la captura (frames recibidos, primer y último `t_ms`, llegadas). */
  capture?: Record<string, number>;
  error?: string;
  report_md?: string;
  issues_json?: string;
  transcript?: string;
  session_json?: string;
  issues?: number;
  /** Nombres de los PNG guardados en `assets` (p.ej. `i01.png`). */
  assets?: string[];
  updated_at: number;
}

interface EventRow {
  sessionId: string;
  event: Event;
}

interface AssetRow {
  key: string;
  sessionId: string;
  name: string;
  bytes: Uint8Array;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB: transacción abortada"));
  });
}

export class LocalStore {
  private readonly db: Promise<IDBDatabase>;

  constructor(name = LOCAL_DB_NAME, factory: IDBFactory = indexedDB) {
    this.db = new Promise((resolve, reject) => {
      const open = factory.open(name, DB_VERSION);
      open.onupgradeneeded = () => {
        const db = open.result;
        const events = db.createObjectStore(EVENTS, { autoIncrement: true });
        events.createIndex("bySession", "sessionId");
        const sessions = db.createObjectStore(SESSIONS, { keyPath: "id" });
        sessions.createIndex("byUpdated", "updated_at");
        const assets = db.createObjectStore(ASSETS, { keyPath: "key" });
        assets.createIndex("bySession", "sessionId");
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
  }

  async appendEvents(sessionId: string, events: Event[]): Promise<void> {
    if (!events.length) return;
    const db = await this.db;
    const tx = db.transaction(EVENTS, "readwrite");
    const store = tx.objectStore(EVENTS);
    for (const event of events) store.add({ sessionId, event } satisfies EventRow);
    await done(tx);
  }

  /** En orden de llegada (la clave autoincremental lo garantiza). */
  async events(sessionId: string): Promise<Event[]> {
    const db = await this.db;
    const tx = db.transaction(EVENTS, "readonly");
    const rows = await req<EventRow[]>(tx.objectStore(EVENTS).index("bySession").getAll(sessionId));
    return rows.map((r) => r.event);
  }

  async putSession(session: Omit<LocalSession, "updated_at">): Promise<void> {
    const db = await this.db;
    const tx = db.transaction(SESSIONS, "readwrite");
    tx.objectStore(SESSIONS).put({ ...session, updated_at: Date.now() });
    await done(tx);
  }

  /** Merge sobre la fila existente (no-op si no existe). */
  async updateSession(id: string, patch: Partial<LocalSession>): Promise<LocalSession | undefined> {
    const db = await this.db;
    const tx = db.transaction(SESSIONS, "readwrite");
    const store = tx.objectStore(SESSIONS);
    const current = await req<LocalSession | undefined>(store.get(id));
    if (!current) {
      await done(tx);
      return undefined;
    }
    const next = { ...current, ...patch, updated_at: Date.now() };
    store.put(next);
    await done(tx);
    return next;
  }

  async getSession(id: string): Promise<LocalSession | undefined> {
    const db = await this.db;
    return req<LocalSession | undefined>(db.transaction(SESSIONS, "readonly").objectStore(SESSIONS).get(id));
  }

  /** Las sesiones más recientes primero (por `meta.t0_wall`). */
  async listSessions(limit = 20): Promise<LocalSession[]> {
    const db = await this.db;
    const all = await req<LocalSession[]>(db.transaction(SESSIONS, "readonly").objectStore(SESSIONS).getAll());
    return all.sort((a, b) => b.meta.t0_wall - a.meta.t0_wall).slice(0, limit);
  }

  async latestSession(): Promise<LocalSession | undefined> {
    return (await this.listSessions(1))[0];
  }

  async putAsset(sessionId: string, name: string, bytes: Uint8Array): Promise<void> {
    const db = await this.db;
    const tx = db.transaction(ASSETS, "readwrite");
    tx.objectStore(ASSETS).put({ key: `${sessionId}/${name}`, sessionId, name, bytes } satisfies AssetRow);
    await done(tx);
  }

  async assets(sessionId: string): Promise<{ name: string; bytes: Uint8Array }[]> {
    const db = await this.db;
    const tx = db.transaction(ASSETS, "readonly");
    const rows = await req<AssetRow[]>(tx.objectStore(ASSETS).index("bySession").getAll(sessionId));
    return rows.map((r) => ({ name: r.name, bytes: r.bytes }));
  }

  /** Borra los eventos crudos de una sesión ya procesada (quedan dentro de `session_json`). */
  async dropEvents(sessionId: string): Promise<void> {
    const db = await this.db;
    const tx = db.transaction(EVENTS, "readwrite");
    const index = tx.objectStore(EVENTS).index("bySession");
    await new Promise<void>((resolve, reject) => {
      const cursor = index.openCursor(IDBKeyRange.only(sessionId));
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c) return resolve();
        c.delete();
        c.continue();
      };
      cursor.onerror = () => reject(cursor.error);
    });
    await done(tx);
  }
}
