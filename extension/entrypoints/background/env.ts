import { browser } from "wxt/browser";

/** Versión de Chrome a partir del user agent del propio service worker. */
export function chromeVersion(): string {
  const match = /Chrome\/([\d.]+)/.exec(navigator.userAgent);
  return match?.[1] ?? "unknown";
}

export function platformName(): string {
  const uaData = (navigator as { userAgentData?: { platform?: string } }).userAgentData;
  return uaData?.platform ?? navigator.platform ?? "unknown";
}

export function extVersion(): string {
  return browser.runtime.getManifest().version;
}

/** Id de sesión: ISO compacto + 4 hex (§03 `SessionId`), p.ej. `2026-09-04T14-32-11Z-a3f9`. */
export function generateSessionId(date: Date, randomHex: () => string = defaultRandomHex): string {
  const iso = date.toISOString().replace(/\.\d+Z$/, "Z").replace(/:/g, "-");
  return `${iso}-${randomHex()}`;
}

function defaultRandomHex(): string {
  const bytes = new Uint8Array(2);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
