import { checkMicPermission, type MicPermissionDeps, type MicPermissionState } from "../../options/lib/mic-permission.js";
import type { StatusClient } from "./status-client.js";

/**
 * Franja de estado del popup (§04, D-U2-01 en docs/DECISIONS.md): el problema real
 * que motivó esto fue un bug de una línea (token guardado bajo dos claves distintas)
 * que costó horas porque nada en la UI decía "el daemon no te está escuchando". Estos
 * tres estados son justo lo que un usuario necesita ver ANTES de apretar grabar, no
 * después de que falle en silencio.
 */
export type DaemonDiagnosis = "conectado" | "no_corre" | "sin_emparejar";
export type ContentScriptDiagnosis = "inyectado" | "hace_falta_recargar" | "desconocido";

export interface PopupDiagnostics {
  daemon: DaemonDiagnosis;
  mic: MicPermissionState;
  contentScript: ContentScriptDiagnosis;
}

export interface ActiveTabRef {
  id?: number;
}

export interface ContentScriptDeps {
  queryActiveTab?: () => Promise<ActiveTabRef | undefined>;
  sendMessageToTab?: (tabId: number, message: unknown) => Promise<unknown>;
}

/**
 * Los content scripts de `matches: ["<all_urls>"]` (§05) no se inyectan solos en
 * pestañas que ya estaban abiertas antes de instalar/recargar la extensión — hace
 * falta recargar la pestaña. Sin este chequeo la única señal de eso era "la
 * grabación no generó ningún evento", indistinguible de una sesión sin actividad.
 * `content/lib/ping.ts` responde `qua:pong`; si no hay nadie del otro lado,
 * `chrome.tabs.sendMessage` rechaza con "Could not establish connection".
 */
export async function checkContentScript(deps: ContentScriptDeps = {}): Promise<ContentScriptDiagnosis> {
  const queryActiveTab = deps.queryActiveTab ?? defaultQueryActiveTab;
  const sendMessageToTab = deps.sendMessageToTab ?? defaultSendMessageToTab;

  const tab = await queryActiveTab();
  if (!tab?.id) return "desconocido";
  try {
    await sendMessageToTab(tab.id, { type: "qua:ping" });
    return "inyectado";
  } catch {
    return "hace_falta_recargar";
  }
}

export interface ReloadTabDeps {
  queryActiveTab?: () => Promise<ActiveTabRef | undefined>;
  reloadTab?: (tabId: number) => Promise<void>;
}

/** Botón "Recargá la pestaña" de la franja de estado — la única forma de recuperar
 * una pestaña sin content script sin tener que cerrar y reabrir el popup a mano. */
export async function reloadActiveTab(deps: ReloadTabDeps = {}): Promise<void> {
  const queryActiveTab = deps.queryActiveTab ?? defaultQueryActiveTab;
  const reloadTab = deps.reloadTab ?? defaultReloadTab;
  const tab = await queryActiveTab();
  if (tab?.id) await reloadTab(tab.id);
}

/**
 * Traduce `StatusResponse` (paired/wsStatus) a un único estado para la franja — el
 * usuario no necesita saber si está "disconnected" o "connecting", necesita saber
 * si tiene que hacer algo. Deliberadamente NO mira `state` (la fase de sesión): el
 * canal de control puede estar conectado en `idle` (D-P1-01), o una sesión puede
 * seguir en `recording` mientras el WS está a mitad de una reconexión — son ejes
 * independientes.
 */
export async function getDaemonDiagnosis(client: Pick<StatusClient, "getStatus">): Promise<DaemonDiagnosis> {
  const status = await client.getStatus();
  if (status.lastError) return "no_corre"; // no se pudo ni preguntar — mismo balde que "no corre"
  if (!status.paired) return "sin_emparejar";
  return status.wsStatus === "connected" ? "conectado" : "no_corre";
}

function defaultQueryActiveTab(): Promise<ActiveTabRef | undefined> {
  if (typeof chrome === "undefined" || !chrome.tabs?.query) return Promise.resolve(undefined);
  return chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => tab);
}

function defaultSendMessageToTab(tabId: number, message: unknown): Promise<unknown> {
  return chrome.tabs.sendMessage(tabId, message);
}

function defaultReloadTab(tabId: number): Promise<void> {
  return chrome.tabs.reload(tabId);
}

export type { MicPermissionDeps, MicPermissionState };
export { checkMicPermission };

/**
 * Implementación real de la franja de estado, para `popup/main.ts`. Estructuralmente
 * satisface `DiagnosticsClientLike` de `controller.ts` sin importarlo — el
 * controller define el contrato que necesita, esto lo cumple (mismo espíritu que
 * `StatusClientLike`).
 */
export class PopupDiagnosticsClient {
  constructor(private readonly client: Pick<StatusClient, "getStatus">) {}

  getDaemonStatus(): Promise<DaemonDiagnosis> {
    return getDaemonDiagnosis(this.client);
  }

  getMicStatus(): Promise<MicPermissionState> {
    return checkMicPermission();
  }

  getContentScriptStatus(): Promise<ContentScriptDiagnosis> {
    return checkContentScript();
  }

  reloadActiveTab(): Promise<void> {
    return reloadActiveTab();
  }
}
