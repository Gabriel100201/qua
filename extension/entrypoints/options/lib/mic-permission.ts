import { MIC_CONSTRAINTS } from "../../offscreen/lib/audio-capture.js";

/**
 * El paso crítico de §5.4 (bloque "⚠️ CUIDADO"): un offscreen document no
 * puede pedir el permiso de micrófono — `getUserMedia` ahí falla en
 * silencio. Options.html corre en el mismo origen `chrome-extension://<id>`
 * y es la única página con UI donde `getUserMedia` puede mostrarle el
 * prompt de permiso al usuario; una vez concedido, el offscreen doc lo
 * hereda porque comparten origen. El onboarding tiene que forzar este paso.
 */
export type MicPermissionState = "granted" | "denied" | "prompt" | "unknown";

export interface MicPermissionDeps {
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  queryPermission?: (name: string) => Promise<{ state: MicPermissionState }>;
}

export interface GrantMicPermissionResult {
  ok: boolean;
  message?: string;
}

/**
 * Consulta el estado actual sin disparar el prompt (para pintar la UI al
 * abrir options.html). Degrada a `"unknown"` si el navegador no soporta
 * `navigator.permissions.query({name:"microphone"})` — no todos lo hacen.
 */
export async function checkMicPermission(deps: MicPermissionDeps = {}): Promise<MicPermissionState> {
  const queryPermission = deps.queryPermission ?? defaultQueryPermission;
  try {
    const result = await queryPermission("microphone");
    return result.state;
  } catch {
    return "unknown";
  }
}

/**
 * Dispara el prompt real de permiso de micrófono con las constraints exactas
 * de §5.4. Suelta el track apenas confirma el permiso: options.html no
 * necesita mantener el micrófono abierto, solo dejar el permiso otorgado
 * para que el offscreen doc lo reabra cuando arranque de verdad una sesión.
 */
export async function grantMicPermission(deps: MicPermissionDeps = {}): Promise<GrantMicPermissionResult> {
  const getUserMedia = deps.getUserMedia ?? defaultGetUserMedia;
  try {
    const stream = await getUserMedia(MIC_CONSTRAINTS);
    stream.getTracks().forEach((track) => track.stop());
    return { ok: true };
  } catch (err) {
    return { ok: false, message: errorMessage(err) };
  }
}

function defaultGetUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia(constraints);
}

async function defaultQueryPermission(name: string): Promise<{ state: MicPermissionState }> {
  const result = await navigator.permissions.query({ name: name as PermissionName });
  return { state: result.state as MicPermissionState };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
