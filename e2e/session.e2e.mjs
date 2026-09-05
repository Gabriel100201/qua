#!/usr/bin/env node
// G1 (§14): sesión real de punta a punta, sin intervención manual.
//
// Lanza una instancia aparte de Chrome con la extensión cargada (--load-extension,
// --user-data-dir temporal — nada de esto necesita el modo desarrollador activado a
// mano), un daemon `quad` real contra un `--data-dir` temporal, y una página local de
// prueba. Arranca una sesión, hace un hover real sobre un botón mientras Chrome le
// inyecta a `getUserMedia` el WAV de `fixtures/audio/es-hover-sidebar.wav` como si
// fuera el micrófono (`--use-file-for-fake-audio-capture`, sin flags de UI ni
// permisos manuales), para la sesión, y valida que el daemon produzca un `report.md`
// real.
//
// **Por qué el Chrome de Playwright y no el de /Applications** (ver D-G1-05 en
// docs/DECISIONS.md): el Google Chrome de consumo bloquea `--load-extension` fuera
// de la Chrome Web Store salvo que el "Modo de desarrollador" esté prendido a mano en
// el perfil — probado empíricamente (`--disable-extensions-except is not allowed in
// Google Chrome, ignoring` + `Extensions.NotAllowlistedDisabled2` en el log de
// arranque). "Chrome for Testing" (el binario que maneja Playwright, motor Chrome
// real, sin las restricciones de la build de consumo) es justo el binario que Google
// distribuye para este caso — automatizar Chrome sin depender de un toggle manual.
//
// No es parte de `pnpm test` (ver README.md de esta carpeta): necesita
// `npx playwright install chromium` una vez, un daemon compilado, y toca la red la
// primera vez que baja el modelo whisper. Correr con `pnpm --filter @qua/e2e run e2e`.

import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, existsSync, readdirSync, openSync, closeSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const EXTENSION_DIR = join(REPO_ROOT, "extension");
const EXTENSION_OUTPUT = join(EXTENSION_DIR, ".output/chrome-mv3");
const QUAD_BIN = join(REPO_ROOT, "target/debug/quad");
const CARGO_BIN = join(homedir(), ".cargo/bin/cargo");
const WAV_FIXTURE = join(REPO_ROOT, "fixtures/audio/es-hover-sidebar.wav");
const TEST_PAGE = join(__dirname, "fixtures/test-page.html");

const DAEMON_PORT = 7331; // el mismo default que `wsUrl()` usa sin overridear.
const TOKEN_STORAGE_KEY = "qua:daemon-token";
const EXTENSION_MANIFEST_NAME = "QUA"; // wxt.config.ts: manifest.name.

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(...args) {
  console.log("[e2e]", ...args);
}

function assert(cond, message) {
  if (!cond) throw new Error(`ASSERT: ${message}`);
}

/**
 * `context.serviceWorkers()` puede traer el service worker de una extensión de
 * componente interna de Chrome (p. ej. "Google Network Speech") antes que el
 * nuestro — visto empíricamente. Filtra por el `name` del manifest en vez de
 * confiar en "el primero" o "el último que se registró".
 */
async function findExtensionServiceWorker(context, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const worker of context.serviceWorkers()) {
      try {
        const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
        if (manifest?.name === EXTENSION_MANIFEST_NAME) return worker;
      } catch {
        // Worker todavía no está listo para evaluar, o ya se cerró — se reintenta.
      }
    }
    await sleep(300);
  }
  throw new Error(
    `nunca apareció el service worker de "${EXTENSION_MANIFEST_NAME}" en ${timeoutMs}ms`,
  );
}

/** Sirve `fixtures/test-page.html` en cualquier ruta — es una sola página. */
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

async function waitForHealth(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return await res.json();
    } catch (err) {
      lastErr = err;
    }
    await sleep(200);
  }
  throw new Error(`el daemon nunca respondió /health en ${timeoutMs}ms: ${lastErr}`);
}

/** Espera a que `finalize()` (G1, D-B1-04 resuelta) termine de escribir report.md. */
async function waitForReport(quaHome, timeoutMs) {
  const sessionsDir = join(quaHome, "sessions");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(sessionsDir)) {
      for (const id of readdirSync(sessionsDir)) {
        const reportPath = join(sessionsDir, id, "report.md");
        const sessionJsonPath = join(sessionsDir, id, "session.json");
        if (existsSync(reportPath) && existsSync(sessionJsonPath)) {
          const session = JSON.parse(readFileSync(sessionJsonPath, "utf8"));
          return { id, reportPath, sessionJsonPath, session };
        }
      }
    }
    await sleep(500);
  }
  throw new Error(
    `nunca apareció report.md bajo ${sessionsDir} en ${timeoutMs}ms — revisar daemon.log`,
  );
}

async function main() {
  log("build: @qua/protocol + @qua/source-resolver (dependencias de la extensión)");
  execFileSync(
    "pnpm",
    ["--filter", "@qua/protocol", "--filter", "@qua/source-resolver", "run", "build"],
    { cwd: REPO_ROOT, stdio: "inherit" },
  );

  log("build: extensión (wxt build)");
  execFileSync("pnpm", ["--filter", "@qua/extension", "run", "build"], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
  assert(existsSync(join(EXTENSION_OUTPUT, "manifest.json")), "wxt build no produjo manifest.json");

  log("build: daemon (cargo build -p quad)");
  execFileSync(CARGO_BIN, ["build", "-p", "quad"], { cwd: REPO_ROOT, stdio: "inherit" });
  assert(existsSync(QUAD_BIN), `no se generó el binario en ${QUAD_BIN}`);

  const testServer = await serveTestPage();
  const testPagePort = testServer.address().port;
  const testPageUrl = `http://127.0.0.1:${testPagePort}/`;
  log(`página de prueba en ${testPageUrl}`);

  const quaHome = mkdtempSync(join(tmpdir(), "qua-e2e-home-"));
  const profileDir = mkdtempSync(join(tmpdir(), "qua-e2e-profile-"));
  const token = randomBytes(32).toString("hex");
  log(`QUA_HOME=${quaHome}`);

  let context;
  let daemon;
  let exitCode = 1;

  try {
    log("lanzando Chrome (Chrome for Testing, vía Playwright) con la extensión cargada");
    context = await chromium.launchPersistentContext(profileDir, {
      headless: false,
      // Playwright agrega `--disable-extensions` a sus argumentos por defecto, que
      // pisa el allowlist de `--disable-extensions-except` de más abajo y deja la
      // extensión sin cargar (visto empíricamente: chrome://extensions vacío, cero
      // service workers). Sacarlo es lo que hace que cargue sin tocar nada a mano.
      ignoreDefaultArgs: ["--disable-extensions", "--disable-component-extensions-with-background-pages"],
      args: [
        `--disable-extensions-except=${EXTENSION_OUTPUT}`,
        `--load-extension=${EXTENSION_OUTPUT}`,
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        `--use-file-for-fake-audio-capture=${WAV_FIXTURE}`,
        "--no-first-run",
        "--no-default-browser-check",
      ],
    });

    const background = await findExtensionServiceWorker(context, 15_000);
    const extensionId = new URL(background.url()).host;
    log(`extensión cargada: ${extensionId}`);

    const configToml = `[[projects]]
label = "QUA-E2E"
origins = ["${testPageUrl}"]

[[paired_extensions]]
origin = "chrome-extension://${extensionId}"
token = "${token}"

[asr]
model = "base"
`;
    execFileSync("mkdir", ["-p", quaHome]);
    await import("node:fs/promises").then((fsp) =>
      fsp.writeFile(join(quaHome, "config.toml"), configToml, "utf8"),
    );

    log("arrancando el daemon real (quad)");
    const daemonLogFd = openSync(join(quaHome, "daemon.log"), "a");
    daemon = spawn(QUAD_BIN, ["--data-dir", quaHome, "--port", String(DAEMON_PORT)], {
      stdio: ["ignore", daemonLogFd, daemonLogFd],
    });
    closeSync(daemonLogFd);
    daemon.on("exit", (code) => log(`quad terminó (code=${code})`));

    const health = await waitForHealth(DAEMON_PORT, 15_000);
    log("daemon /health:", health);

    await background.evaluate(
      ({ key, value }) => chrome.storage.local.set({ [key]: value }),
      { key: TOKEN_STORAGE_KEY, value: token },
    );

    const testPage = await context.newPage();
    await testPage.goto(testPageUrl);
    await testPage.bringToFront();

    // No se puede mandar el mensaje evaluando `chrome.runtime.sendMessage` directo
    // en el propio contexto del service worker: Chrome no entrega un mensaje al
    // mismo contexto que lo mandó ("Could not establish connection. Receiving end
    // does not exist.", visto empíricamente). En cambio, se inyecta con
    // `chrome.scripting.executeScript` en la pestaña activa (la página de prueba,
    // igual que el popup real) — mismo camino que ya usa el content script para
    // `qua:event`, y no le roba el foco de pestaña activa a la página bajo prueba
    // como sí haría abrir `popup.html` en una pestaña nueva.
    const sendToBackground = (message) =>
      background.evaluate(async (msg) => {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        const [injected] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (m) => chrome.runtime.sendMessage(m),
          args: [msg],
        });
        return injected.result;
      }, message);

    log("qua:start-session");
    const startResp = await sendToBackground({ type: "qua:start-session" });
    log("respuesta:", startResp);
    assert(startResp?.ok !== false, `start-session falló: ${JSON.stringify(startResp)}`);

    await sleep(600); // WS handshake + session.start + offscreen doc + getUserMedia.

    log("hover real sobre #nuevo-turno (§05.1: dwell >= 400ms)");
    await testPage.hover("#nuevo-turno");
    await sleep(1200);
    await testPage.mouse.move(5, 5); // dispara mouseout -> cierra el hover con su dwell.

    log("esperando a que termine de reproducirse/capturarse el WAV (~4s)");
    await sleep(4500);

    log("qua:stop-session");
    const stopResp = await sendToBackground({ type: "qua:stop-session" });
    log("respuesta:", stopResp);
    assert(stopResp?.ok !== false, `stop-session falló: ${JSON.stringify(stopResp)}`);

    log("esperando report.md (ASR + correlador + render corren en finalize())");
    const result = await waitForReport(quaHome, 90_000);
    const report = readFileSync(result.reportPath, "utf8");

    log(`--- ${result.id}/report.md ---`);
    console.log(report);
    log(
      `status=${result.session.status} utterances=${result.session.utterances.length} issues=${result.session.issues.length}`,
    );

    assert(report.startsWith("# QUA"), "report.md no tiene el header de §8.1");
    assert(result.session.status === "ready", `status inesperado: ${result.session.status}`);
    assert(result.session.events.length > 0, "session.json no tiene eventos — el content script no llegó");
    if (result.session.utterances.length === 0) {
      log(
        "ADVERTENCIA: cero utterances transcriptas — revisar daemon.log " +
          "(¿--use-file-for-fake-audio-capture no llegó al VAD?). report.md sigue siendo válido, solo que vacío de voz.",
      );
    } else {
      log("transcripción real obtenida del WAV de fixtures/audio/:", result.session.utterances[0].text);
    }

    log("PASS — sesión real de punta a punta produjo un report.md válido");
    exitCode = 0;
  } finally {
    if (daemon && !daemon.killed) daemon.kill();
    if (context) await context.close().catch(() => {});
    testServer.close();
    log(`QUA_HOME queda en ${quaHome} para inspección manual (no se borra solo)`);
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error("[e2e] FAIL:", err);
  process.exit(1);
});
