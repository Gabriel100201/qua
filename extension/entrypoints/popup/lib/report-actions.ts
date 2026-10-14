import { LocalStore, type LocalSession } from "../../../shared/local/store.js";

/**
 * Acciones sobre el último reporte (D1 de TAREA-distribucion) en el modo local
 * (D-L1-01): el reporte vive en IndexedDB, no en `~/.qua/sessions/`.
 */
export interface ReadyReport {
  report: string;
  /** Identifica la sesión (antes era la ruta en disco): el controller la compara para
   * saber si apareció un reporte nuevo después de grabar. */
  path: string;
}

let store: LocalStore | undefined;
const db = () => (store ??= new LocalStore());

async function latestReady(): Promise<LocalSession | undefined> {
  const sessions = await db().listSessions(10);
  return sessions.find((s) => s.status === "ready" && s.report_md !== undefined);
}

export async function getLastReport(): Promise<ReadyReport | null> {
  const s = await latestReady();
  return s ? { report: s.report_md ?? "", path: s.id } : null;
}

export async function copyLastReport(): Promise<void> {
  const ready = await getLastReport();
  if (!ready) throw new Error("El reporte todavía se está procesando.");
  await navigator.clipboard.writeText(ready.report);
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const textUrl = (text: string, mime: string) => `data:${mime};base64,${toBase64(new TextEncoder().encode(text))}`;

/**
 * Baja la sesión a `Descargas/qua/<id>/`: `report.md` con sus capturas en `assets/`
 * (las rutas relativas del reporte siguen andando), más `issues.json`, `transcript.txt`
 * y `session.json`. Es lo que un agente lee directo, sin MCP.
 */
export async function revealLastReport(): Promise<void> {
  const s = await latestReady();
  if (!s) throw new Error("Todavía no hay un reporte para bajar.");
  const base = `qua/${s.id}`;
  const files: { name: string; url: string }[] = [
    { name: "report.md", url: textUrl(s.report_md ?? "", "text/markdown") },
    { name: "issues.json", url: textUrl(s.issues_json ?? "[]", "application/json") },
    { name: "transcript.txt", url: textUrl(s.transcript ?? "", "text/plain") },
    { name: "session.json", url: textUrl(s.session_json ?? "{}", "application/json") },
  ];
  for (const asset of await db().assets(s.id)) {
    files.push({ name: `assets/${asset.name}`, url: `data:image/png;base64,${toBase64(asset.bytes)}` });
  }
  for (const f of files) {
    await chrome.downloads.download({ url: f.url, filename: `${base}/${f.name}`, conflictAction: "overwrite" });
  }
  chrome.downloads.showDefaultFolder();
}
