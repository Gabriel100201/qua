import { browser } from "wxt/browser";
import { openDb, txDone } from "./idb.js";

/** Ring de screenshots (§5.3). */
export const SCREENSHOT_RING_SIZE = 40;
export const SCREENSHOT_FPS = 1;
export const SCREENSHOT_WIDTH = 1280;
export const SCREENSHOT_QUALITY = 60;

export interface ScreenshotFrame {
  t: number;
  tab: number;
  jpegB64: string;
}

const FRAMES_STORE = "frames";

/** Redimensiona el data URL de `captureVisibleTab` a `SCREENSHOT_WIDTH` px y devuelve
 * el JPEG en base64 SIN el prefijo `data:` (§04 `FrameMessage.jpeg_b64`). */
export async function defaultEncode(dataUrl: string): Promise<string> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob);
  const scale = SCREENSHOT_WIDTH / bitmap.width;
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(SCREENSHOT_WIDTH, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("screenshots: no se pudo obtener el contexto 2D del OffscreenCanvas");
  ctx.drawImage(bitmap, 0, 0, SCREENSHOT_WIDTH, height);
  const outBlob = await canvas.convertToBlob({ type: "image/jpeg", quality: SCREENSHOT_QUALITY / 100 });
  const buf = await outBlob.arrayBuffer();
  return base64FromArrayBuffer(buf);
}

function base64FromArrayBuffer(buf: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i] as number);
  return btoa(binary);
}

export type ScreenshotEncoder = (dataUrl: string) => Promise<string>;

/**
 * `chrome.tabs.captureVisibleTab` throttleado a 1 fps (el límite duro de Chrome es
 * 2/s), guarda los últimos `SCREENSHOT_RING_SIZE` frames en IndexedDB (§5.3). El
 * daemon pide retroactivamente el más cercano a un instante (`closestTo`) — así hay
 * captura del momento aunque ya se haya navegado.
 *
 * `closestTo` resuelve contra una copia en memoria (no vale la pena hacer el ring
 * async para el caso caliente de responder a `capture.request`); IndexedDB es el
 * respaldo que sobrevive un reciclado del service worker.
 */
export class ScreenshotRing {
  private frames: ScreenshotFrame[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  private capturing = false;
  private dbPromise: Promise<IDBDatabase>;

  constructor(
    private readonly now: () => number,
    private readonly getActiveTabId: () => Promise<number | undefined>,
    private readonly encode: ScreenshotEncoder = defaultEncode,
    dbName = "qua-screenshots",
  ) {
    this.dbPromise = openDb(dbName, 1, (db) => {
      if (!db.objectStoreNames.contains(FRAMES_STORE)) {
        db.createObjectStore(FRAMES_STORE, { keyPath: "t" });
      }
    });
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, 1000 / SCREENSHOT_FPS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.frames = [];
  }

  private async tick(): Promise<void> {
    if (this.capturing) return; // nunca superponer capturas (respeta el rate limit de Chrome)
    this.capturing = true;
    try {
      const tabId = await this.getActiveTabId();
      if (tabId === undefined) return;
      const dataUrl = await browser.tabs.captureVisibleTab({
        format: "jpeg",
        quality: SCREENSHOT_QUALITY,
      });
      const jpegB64 = await this.encode(dataUrl);
      await this.push({ t: this.now(), tab: tabId, jpegB64 });
    } catch {
      // captureVisibleTab puede fallar (pestaña protegida, ventana minimizada, rate
      // limit): se pierde ese frame, no la sesión.
    } finally {
      this.capturing = false;
    }
  }

  private async push(frame: ScreenshotFrame): Promise<void> {
    this.frames.push(frame);
    const evicted = this.frames.length > SCREENSHOT_RING_SIZE ? this.frames.shift() : undefined;

    const db = await this.dbPromise;
    const tx = db.transaction(FRAMES_STORE, "readwrite");
    const store = tx.objectStore(FRAMES_STORE);
    store.put(frame);
    if (evicted) store.delete(evicted.t);
    await txDone(tx);
  }

  /** El frame más cercano a `tTarget` para esa pestaña, o `undefined` si el ring
   * todavía no tiene nada de esa pestaña. */
  closestTo(tab: number, tTarget: number): ScreenshotFrame | undefined {
    let best: ScreenshotFrame | undefined;
    for (const frame of this.frames) {
      if (frame.tab !== tab) continue;
      if (!best || Math.abs(frame.t - tTarget) < Math.abs(best.t - tTarget)) best = frame;
    }
    return best;
  }

  size(): number {
    return this.frames.length;
  }
}
