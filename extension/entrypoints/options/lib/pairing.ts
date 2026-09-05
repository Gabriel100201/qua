import {
  DAEMON_HOST,
  DEFAULT_DAEMON_PORT,
  PAIR_PATH,
  PairRequestSchema,
  PairResponseSchema,
  type PairResponse,
} from "@qua/protocol";

/**
 * Pairing de 6 dígitos (§04): options.html hace `POST /pair` con `{code}`;
 * el daemon devuelve un token de 32 bytes que se guarda en
 * `chrome.storage.local` para que el service worker lo use en todo WS
 * posterior. El `Origin: chrome-extension://<id>` que el daemon valida lo
 * pone el navegador solo — no hace falta setearlo a mano.
 */
export const PAIR_TOKEN_STORAGE_KEY = "quaPairToken";

export interface StorageLike {
  set(items: Record<string, unknown>): Promise<void>;
}

export interface PairingDeps {
  fetchFn?: typeof fetch;
  /** Puerto del daemon. Por defecto `DEFAULT_DAEMON_PORT` (§13, `[daemon].port`). */
  port?: number;
  storage?: StorageLike;
}

export type PairingResult = { ok: true; response: PairResponse } | { ok: false; error: string };

/** Válido == pasa `PairRequestSchema` (6 dígitos exactos). No hardcodea la regex — usa el esquema de §04. */
export function isValidPairCode(code: string): boolean {
  return PairRequestSchema.safeParse({ code }).success;
}

function pairUrl(port: number): string {
  return `http://${DAEMON_HOST}:${port}${PAIR_PATH}`;
}

export async function pair(code: string, deps: PairingDeps = {}): Promise<PairingResult> {
  const request = PairRequestSchema.safeParse({ code });
  if (!request.success) {
    return { ok: false, error: "El código tiene que tener 6 dígitos." };
  }

  const fetchFn = deps.fetchFn ?? fetch;
  const port = deps.port ?? DEFAULT_DAEMON_PORT;

  let res: Response;
  try {
    res = await fetchFn(pairUrl(port), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request.data),
    });
  } catch (err) {
    return { ok: false, error: `No se pudo conectar con el daemon en 127.0.0.1:${port}: ${errorMessage(err)}` };
  }

  if (!res.ok) {
    return { ok: false, error: `El daemon rechazó el pairing (HTTP ${res.status}).` };
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { ok: false, error: "La respuesta del daemon no es JSON válido." };
  }

  const parsed = PairResponseSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, error: "La respuesta del daemon no cumple el contrato de /pair (§04)." };
  }

  const storage = deps.storage ?? defaultStorage();
  if (storage) {
    await storage.set({ [PAIR_TOKEN_STORAGE_KEY]: parsed.data.token });
  }

  return { ok: true, response: parsed.data };
}

function defaultStorage(): StorageLike | undefined {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return undefined;
  return { set: (items) => chrome.storage.local.set(items) };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
