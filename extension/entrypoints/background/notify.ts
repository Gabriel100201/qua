import { browser } from "wxt/browser";
import type { LocalSession } from "../../shared/local/store.js";
import { duration, place, plural } from "../../shared/ui/format.js";

/**
 * Aviso de Chrome cuando el reporte está listo (diseño "Marca en Chrome"): permite cerrar
 * el popup mientras procesa. Tocar el aviso abre el reporte; el botón lo copia.
 */
export async function notifyReady(s: LocalSession): Promise<void> {
  const n = s.issues ?? 0;
  await browser.notifications.create(`qua:${s.id}`, {
    type: "basic",
    iconUrl: extUrl("/icon/128.png"),
    title: n ? `Reporte listo: ${plural(n, "issue", "issues")}` : "Reporte listo, sin issues",
    message: `${place(s.meta.base_url)}, ${duration(s.duration_ms ?? 0)}. Tocá para verlo.`,
    buttons: n ? [{ title: "Copiar reporte" }] : [],
    priority: 0,
  });
}

export function sessionFromNotification(id: string): string | undefined {
  return id.startsWith("qua:") ? id.slice(4) : undefined;
}

/** URL de una página de la extensión (WXT solo tipa las rutas que conoce). */
export const extUrl = (path: string): string => chrome.runtime.getURL(path);

export function reportUrl(sessionId: string): string {
  return extUrl(`/report.html?id=${encodeURIComponent(sessionId)}`);
}
