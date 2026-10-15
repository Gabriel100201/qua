// Arranque común de los E2E: Chrome for Testing con la extensión cargada (sin el modo
// desarrollador a mano: ver D-G1-05) y su service worker identificado por nombre.
import { chromium } from "playwright";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findWorker(ctx, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const w of ctx.serviceWorkers()) {
      try {
        if ((await w.evaluate(() => chrome.runtime.getManifest().name)) === "QUA") return w;
      } catch {
        // todavía no está listo
      }
    }
    await sleep(250);
  }
  throw new Error("nunca apareció el service worker de QUA");
}

export async function launchQua({ extensionDir, profile, args = [], viewport }) {
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: false,
    viewport,
    ignoreDefaultArgs: ["--disable-extensions", "--disable-component-extensions-with-background-pages"],
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, "--no-first-run", "--no-default-browser-check", ...args],
  });
  const sw = await findWorker(ctx);
  // La bienvenida se abre sola al instalar; los E2E la abren a propósito cuando la necesitan.
  for (const p of ctx.pages()) if (p.url().includes("onboarding.html")) await p.close();
  return { ctx, sw, id: new URL(sw.url()).host };
}
