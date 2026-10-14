import { DAEMON_HOST, DEFAULT_DAEMON_PORT } from "@qua/protocol";
import { TOKEN_STORAGE_KEY } from "../../../shared/storage-keys.js";

export interface ReadyReport {
  report: string;
  path: string;
}

async function token(): Promise<string> {
  const values = await chrome.storage.local.get(TOKEN_STORAGE_KEY);
  const value = values[TOKEN_STORAGE_KEY];
  if (typeof value !== "string" || !value) throw new Error("La extensión no está emparejada.");
  return value;
}

function endpoint(path: string, value: string): string {
  return `http://${DAEMON_HOST}:${DEFAULT_DAEMON_PORT}${path}?token=${encodeURIComponent(value)}`;
}

export async function getLastReport(): Promise<ReadyReport | null> {
  const value = await token();
  const response = await fetch(endpoint("/last/report", value));
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`No pude leer el reporte (${response.status}).`);
  return response.json() as Promise<ReadyReport>;
}

export async function copyLastReport(): Promise<void> {
  const ready = await getLastReport();
  if (!ready) throw new Error("El reporte todavía se está procesando.");
  await navigator.clipboard.writeText(ready.report);
}

export async function revealLastReport(): Promise<void> {
  const value = await token();
  const response = await fetch(endpoint("/last/reveal", value), { method: "POST" });
  if (!response.ok) throw new Error(`No pude abrir la carpeta (${response.status}).`);
}
