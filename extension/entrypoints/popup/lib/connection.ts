import { DAEMON_HOST, DEFAULT_DAEMON_PORT, HEALTH_PATH, PAIR_AUTO_PATH, PairResponseSchema, type PairResponse } from "@qua/protocol";

import { TOKEN_STORAGE_KEY } from "../../../shared/storage-keys.js";

/**
 * Emparejamiento de un click desde el popup (D-U1-01, `docs/DECISIONS.md`):
 * antes de esto, "grabar" exigía `curl -X POST /pair/start` en una terminal,
 * leer un código de 6 dígitos y tipearlo en options antes de que venza a los
 * 60 s. `POST /pair/auto` salta todo eso mientras nadie haya emparejado nunca
 * con este daemon — trust-on-first-use, razonable para una herramienta local
 * de un solo usuario atada a 127.0.0.1.
 */

/** Comando exacto para levantar el daemon a mano (README, "Opción B"). */
export const START_DAEMON_COMMAND = "./target/release/quad";

export interface StorageLike {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface ConnectionDeps {
  fetchFn?: typeof fetch;
  /** Puerto del daemon. Por defecto `DEFAULT_DAEMON_PORT` (§13, `[daemon].port`). */
  port?: number;
  storage?: StorageLike;
}

export type AutoPairResult =
  | { ok: true; response: PairResponse }
  | { ok: false; reason: "daemon_down" }
  | { ok: false; reason: "already_paired" }
  | { ok: false; reason: "other"; error: string };

function daemonUrl(path: string, port: number): string {
  return `http://${DAEMON_HOST}:${port}${path}`;
}

/** Token ya guardado de un pairing anterior (manual o automático), si hay. */
export async function getStoredToken(deps: ConnectionDeps = {}): Promise<string | undefined> {
  const storage = deps.storage ?? defaultStorage();
  if (!storage) return undefined;
  const stored = await storage.get(TOKEN_STORAGE_KEY);
  return stored[TOKEN_STORAGE_KEY] as string | undefined;
}

/**
 * `GET /health` (§09). Es la única señal que tiene el popup para distinguir
 * "no emparejado todavía" de "el daemon ni está corriendo" sin pedirle a
 * Gabriel que abra una terminal — cualquier fetch que no resuelva en OK se
 * trata como daemon caído.
 */
export async function isDaemonRunning(deps: ConnectionDeps = {}): Promise<boolean> {
  const fetchFn = deps.fetchFn ?? fetch;
  const port = deps.port ?? DEFAULT_DAEMON_PORT;
  try {
    const res = await fetchFn(daemonUrl(HEALTH_PATH, port), { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * `POST /pair/auto`: el `Origin: chrome-extension://<id>` lo pone el
 * navegador solo, no hace falta setearlo a mano (igual que en `options/lib/pairing.ts`).
 */
export async function autoPair(deps: ConnectionDeps = {}): Promise<AutoPairResult> {
  const fetchFn = deps.fetchFn ?? fetch;
  const port = deps.port ?? DEFAULT_DAEMON_PORT;

  let res: Response;
  try {
    res = await fetchFn(daemonUrl(PAIR_AUTO_PATH, port), { method: "POST" });
  } catch {
    return { ok: false, reason: "daemon_down" };
  }

  if (res.status === 409) {
    return { ok: false, reason: "already_paired" };
  }
  if (!res.ok) {
    return { ok: false, reason: "other", error: `El daemon rechazó el emparejamiento automático (HTTP ${res.status}).` };
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { ok: false, reason: "other", error: "La respuesta del daemon no es JSON válido." };
  }

  const parsed = PairResponseSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, reason: "other", error: "La respuesta del daemon no cumple el contrato de /pair (§04)." };
  }

  const storage = deps.storage ?? defaultStorage();
  if (storage) {
    await storage.set({ [TOKEN_STORAGE_KEY]: parsed.data.token });
  }

  return { ok: true, response: parsed.data };
}

function defaultStorage(): StorageLike | undefined {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return undefined;
  return {
    get: (key) => chrome.storage.local.get(key),
    set: (items) => chrome.storage.local.set(items),
  };
}
