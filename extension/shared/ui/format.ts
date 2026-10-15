/** Formatos de texto compartidos por las superficies de QUA. */

/** 2:41 → "02:41"; una hora o más → "1:02:41". */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${String(m).padStart(2, "0")}:${ss}`;
}

/** Duración en palabras: "25 s", "2 min 41 s", "1 h 3 min". */
export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** "Hoy, 21:44" · "Ayer, 18:51" · "12 de octubre". */
export function when(epochMs: number, now = Date.now()): string {
  const d = new Date(epochMs);
  const hm = d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(new Date(now)) - day(d)) / 86_400_000);
  if (diff === 0) return `Hoy, ${hm}`;
  if (diff === 1) return `Ayer, ${hm}`;
  return d.toLocaleDateString("es-AR", { day: "numeric", month: "long" });
}

/** "https://pediloapp.com/admin?x" → "pediloapp.com/admin" (sin protocolo ni query). */
export function place(url: string): string {
  try {
    const u = new URL(url);
    // Las páginas de QUA (visor, ajustes, primera vez) no muestran su URL interna.
    if (u.protocol === "chrome-extension:") return "QUA";
    if (!/^https?:$/.test(u.protocol)) return url;
    const path = u.pathname === "/" ? "" : u.pathname.replace(/\/$/, "");
    return u.host + path;
  } catch {
    return url;
  }
}

/** Páginas donde Chrome no deja que una extensión vea el contenido. */
export function isRecordable(url: string | undefined): boolean {
  if (!url) return false;
  if (!/^(https?|file):/.test(url)) return false;
  return !/^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com)/.test(url);
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function bytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1).replace(".", ",")} GB`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
  return `${Math.max(1, Math.round(n / 1e3))} KB`;
}
