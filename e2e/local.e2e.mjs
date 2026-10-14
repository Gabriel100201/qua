#!/usr/bin/env node
// Modo local (D-L1-01): sesión real de punta a punta SIN daemon ni app.
//
// Igual que session.e2e.mjs lanza Chrome for Testing con la extensión cargada y un WAV
// como micrófono, pero acá no se levanta `quad`: al detener, el offscreen doc corre
// silero + whisper (transformers.js, WebGPU si hay) + qua-wasm y deja el reporte en
// IndexedDB. Se valida leyendo esa base desde el service worker.
//
// Uso: node local.e2e.mjs [--wav ruta.wav] [--seconds N] [--profile dir]
//   --profile conserva el perfil (y la Cache API con el modelo) entre corridas: sin
//   eso, cada corrida baja whisper de nuevo.

import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const EXTENSION_OUTPUT = join(REPO_ROOT, "extension/build/chrome-mv3");
const TEST_PAGE = join(__dirname, "fixtures/test-page.html");
const EXTENSION_MANIFEST_NAME = "QUA";

const { values: opts } = parseArgs({
  options: {
    wav: { type: "string", default: join(REPO_ROOT, "fixtures/audio/es-hover-sidebar.wav") },
    seconds: { type: "string" },
    profile: { type: "string" },
    "skip-build": { type: "boolean", default: false },
    // Repetir el WAV: para clips cortos, que pueden terminar de sonar antes de que el
    // offscreen doc tenga el micrófono abierto.
    loop: { type: "boolean", default: false },
    click: { type: "boolean", default: false },
    out: { type: "string" },
    timeout: { type: "string", default: "1800" },
  },
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[e2e-local ${new Date().toISOString().slice(11, 19)}]`, ...a);
function assert(cond, message) {
  if (!cond) throw new Error(`ASSERT: ${message}`);
}

/** Duración de un WAV PCM leyendo el header (para grabar exactamente eso). */
function wavSeconds(path) {
  const b = readFileSync(path);
  const byteRate = b.readUInt32LE(28);
  let off = 12;
  while (off < b.length - 8) {
    const id = b.toString("ascii", off, off + 4);
    const size = b.readUInt32LE(off + 4);
    if (id === "data") return size / byteRate;
    off += 8 + size;
  }
  throw new Error(`no encontré el chunk data en ${path}`);
}

async function findExtensionServiceWorker(context, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const worker of context.serviceWorkers()) {
      try {
        const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
        if (manifest?.name === EXTENSION_MANIFEST_NAME) return worker;
      } catch {
        // todavía no está listo
      }
    }
    await sleep(300);
  }
  throw new Error(`nunca apareció el service worker de "${EXTENSION_MANIFEST_NAME}"`);
}

function serveTestPage() {
  const html = readFileSync(TEST_PAGE, "utf8");
  return new Promise((resolve) => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function main() {
  if (!opts["skip-build"]) {
    // El WAV es una grabación que ya pasó por supresión de ruido y AGC: sin esto, el
    // micrófono falso la procesa por segunda vez y se pierden tramos de voz (D-L1-02).
    log("build: extensión (wxt build, WXT_QUA_RAW_MIC=1)");
    execFileSync("pnpm", ["--filter", "@qua/extension", "run", "build"], {
      cwd: REPO_ROOT,
      stdio: "inherit",
      env: { ...process.env, WXT_QUA_RAW_MIC: "1" },
    });
  }
  assert(existsSync(join(EXTENSION_OUTPUT, "manifest.json")), "no hay build de la extensión");

  const seconds = opts.seconds ? Number(opts.seconds) : wavSeconds(opts.wav);
  const server = await serveTestPage();
  const url = `http://127.0.0.1:${server.address().port}/`;
  const profileDir = opts.profile ?? mkdtempSync(join(tmpdir(), "qua-e2e-local-"));
  mkdirSync(profileDir, { recursive: true });
  log(`perfil ${profileDir} · audio ${opts.wav} (${seconds.toFixed(1)} s)`);

  let context;
  let exitCode = 1;
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      headless: false,
      ignoreDefaultArgs: ["--disable-extensions", "--disable-component-extensions-with-background-pages"],
      args: [
        `--disable-extensions-except=${EXTENSION_OUTPUT}`,
        `--load-extension=${EXTENSION_OUTPUT}`,
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        `--use-file-for-fake-audio-capture=${opts.wav}${opts.loop ? "" : "%noloop"}`,
        "--enable-unsafe-webgpu",
        "--no-first-run",
        "--no-default-browser-check",
      ],
    });
    const background = await findExtensionServiceWorker(context, 15_000);
    log(`extensión ${new URL(background.url()).host}`);

    const page = await context.newPage();
    await page.goto(url);
    await page.bringToFront();
    page.on("console", (m) => {
      if (m.text().includes("[qua]")) log("página:", m.text());
    });

    const send = (message) =>
      background.evaluate(async (msg) => {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        const [injected] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (m) => chrome.runtime.sendMessage(m),
          args: [msg],
        });
        return injected.result;
      }, message);

    log("pestañas abiertas:", context.pages().map((p) => p.url()).join(" · "));
    log("qua:start-session");
    const start = await send({ type: "qua:start-session" });
    assert(start?.ok !== false, `start falló: ${JSON.stringify(start)}`);

    // Como una persona mirando el popup: no habla hasta que dice que el mic está listo.
    const micDeadline = Date.now() + 15_000;
    while (Date.now() < micDeadline && (await send({ type: "qua:get-status" }))?.micReady !== true) await sleep(100);
    log("micrófono listo");

    // Actividad real en la página mientras "habla" el WAV.
    const t0 = Date.now();
    while (Date.now() - t0 < seconds * 1000 + 800) {
      if (opts.click) await page.click("#nuevo-turno").catch(() => undefined);
      else await page.hover("#nuevo-turno").catch(() => undefined);
      await sleep(1500);
      await page.mouse.move(5, 5);
      await sleep(1500);
    }

    log("qua:stop-session");
    const stop = await send({ type: "qua:stop-session" });
    assert(stop?.ok !== false, `stop falló: ${JSON.stringify(stop)}`);
    const tStop = Date.now();

    let last = "";
    let session;
    const deadline = Date.now() + Number(opts.timeout) * 1000;
    while (Date.now() < deadline) {
      const status = await send({ type: "qua:get-status" });
      const latest = status?.latest;
      const line = latest ? `${latest.status} ${JSON.stringify(latest.progress ?? {})}` : "sin sesión";
      if (line !== last) {
        log(line, status?.lastError ? `· error: ${status.lastError}` : "");
        last = line;
      }
      if (latest && (latest.status === "ready" || latest.status === "failed")) {
        session = await background.evaluate(async (id) => {
          const db = await new Promise((res, rej) => {
            const r = indexedDB.open("qua-local");
            r.onsuccess = () => res(r.result);
            r.onerror = () => rej(r.error);
          });
          return new Promise((res) => {
            const r = db.transaction("sessions").objectStore("sessions").get(id);
            r.onsuccess = () => res(r.result);
          });
        }, latest.id);
        break;
      }
      await sleep(1000);
    }
    assert(session, "la sesión nunca terminó de procesarse");
    const procSeconds = (Date.now() - tStop) / 1000;
    const model = await background.evaluate(() => chrome.storage.local.get("qua:model-state"));

    if (session.status === "failed") throw new Error(`procesamiento falló: ${session.error}`);
    const parsed = JSON.parse(session.session_json);
    log(`--- report.md (${session.id}) ---`);
    console.log(session.report_md);
    log(`procesado en ${procSeconds.toFixed(1)} s · audio ${seconds.toFixed(1)} s · motor ${JSON.stringify(model["qua:model-state"])}`);
    log(`audio recibido por el procesamiento: ${session.audio_ms} ms, pico ${session.audio_peak} · captura ${JSON.stringify({ ...session.capture, t0: session.meta.t0_wall })}`);
    log(`eventos=${parsed.events.length} utterances=${parsed.utterances.length} issues=${parsed.issues.length} capturas=${(session.assets ?? []).length}`);
    if (opts.out) {
      writeFileSync(opts.out, JSON.stringify({ seconds, procSeconds, model: model["qua:model-state"], session }, null, 1));
      log(`resultado en ${opts.out}`);
    }

    // El popup real: con la sesión lista tiene que ofrecer copiar y bajar el reporte.
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${new URL(background.url()).host}/popup.html`);
    await popup.waitForSelector("#qua-report-actions:not([hidden])", { timeout: 10_000 });
    const popupText = await popup.evaluate(() => ({
      status: document.getElementById("qua-status")?.textContent,
      engine: document.getElementById("qua-daemon-status")?.textContent,
      actions: [...document.querySelectorAll("#qua-report-actions button")].map((b) => b.textContent),
      connectVisible: !document.getElementById("qua-connect")?.hidden,
    }));
    log("popup:", JSON.stringify(popupText));
    assert(!popupText.connectVisible, "el popup no debería pedir conectar un daemon");

    assert(session.report_md.startsWith("# QUA"), "report.md sin header");
    assert(parsed.events.length > 0, "sin eventos: el content script no llegó");
    assert(parsed.utterances.length > 0, "cero utterances: el audio no llegó a whisper");
    log("PASS — sin daemon: grabar, transcribir y reportar dentro de Chrome");
    exitCode = 0;
  } finally {
    if (context) await context.close().catch(() => {});
    server.close();
  }
  process.exit(exitCode);
}

main().catch((err) => {
  console.error("[e2e-local] FAIL:", err);
  process.exit(1);
});
