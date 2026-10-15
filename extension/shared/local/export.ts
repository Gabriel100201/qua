import { LocalStore, type LocalSession } from "./store.js";

/**
 * Sacar un reporte de QUA: copiarlo (para pegarlo en un agente, Linear o Slack) o bajarlo
 * a `Descargas/qua/<id>/` con sus capturas. Lo usan el popup, el historial y el visor.
 */

let store: LocalStore | undefined;
export const localStore = (): LocalStore => (store ??= new LocalStore());

export async function getSession(id: string): Promise<LocalSession | undefined> {
  return localStore().getSession(id);
}

export async function copyReport(id: string): Promise<void> {
  const s = await getSession(id);
  if (!s?.report_md) throw new Error("Ese reporte todavía no está listo.");
  await navigator.clipboard.writeText(s.report_md);
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const textUrl = (text: string, mime: string) => `data:${mime};base64,${toBase64(new TextEncoder().encode(text))}`;

/**
 * Baja la sesión a `Descargas/qua/<id>/`: `report.md` con sus capturas en `assets/` (las
 * rutas relativas del reporte siguen andando), más `issues.json`, `transcript.txt` y
 * `session.json`. Es lo que un agente lee directo, sin MCP.
 */
export async function downloadSession(id: string): Promise<void> {
  const s = await getSession(id);
  if (!s?.report_md) throw new Error("Ese reporte todavía no está listo.");
  const base = `qua/${s.id}`;
  const files: { name: string; url: string }[] = [
    { name: "report.md", url: textUrl(s.report_md, "text/markdown") },
    { name: "issues.json", url: textUrl(s.issues_json ?? "[]", "application/json") },
    { name: "transcript.txt", url: textUrl(s.transcript ?? "", "text/plain") },
    { name: "session.json", url: textUrl(s.session_json ?? "{}", "application/json") },
  ];
  for (const asset of await localStore().assets(s.id)) {
    files.push({ name: `assets/${asset.name}`, url: `data:image/png;base64,${toBase64(asset.bytes)}` });
  }
  for (const f of files) {
    await chrome.downloads.download({ url: f.url, filename: `${base}/${f.name}`, conflictAction: "overwrite" });
  }
  chrome.downloads.showDefaultFolder();
}

export function openReport(id: string): void {
  void chrome.tabs.create({ url: chrome.runtime.getURL(`/report.html?id=${encodeURIComponent(id)}`) });
}
