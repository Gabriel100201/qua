#!/usr/bin/env node
// Recorre todas las superficies de QUA en Chrome real con una sesión de verdad y saca
// una captura de cada una (diseño 2026-10). Sirve para comparar contra Penpot.
// Uso: node ui-shots.mjs --profile <dir> --out <dir> [--wav ruta.wav]

import { launchQua } from "./lib.mjs";
import { createServer } from "node:http";
import { mkdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXT = join(__dirname, "../extension/build/chrome-mv3");
const { values: opts } = parseArgs({ options: {
  profile: { type: "string" }, out: { type: "string" },
  wav: { type: "string", default: join(__dirname, "../fixtures/audio/es-hover-sidebar.wav") },
} });
mkdirSync(opts.out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log("[ui]", ...a);

const html = readFileSync(join(__dirname, "fixtures/test-page.html"), "utf8");
const server = createServer((_q, r) => { r.writeHead(200, { "content-type": "text/html; charset=utf-8" }); r.end(html); });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/`;

const { ctx, sw, id } = await launchQua({
  extensionDir: EXT,
  profile: opts.profile,
  viewport: { width: 1280, height: 800 },
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-audio-capture=${opts.wav}`, "--enable-unsafe-webgpu"],
});
const ext = (p) => `chrome-extension://${id}/${p}`;
const shot = async (page, name, el) => { await sleep(400); await (el ? page.locator(el) : page).screenshot({ path: join(opts.out, `${name}.png`) }); log(name); };
// El popup real se ve con la página atrás: se lo trae al frente solo para la foto y se
// le da tiempo a refrescar (en una pestaña de fondo Chrome frena sus timers).
let pageRef;
const popupShot = async (name) => { await popup.bringToFront(); await sleep(1200); await shot(popup, name, "body"); await pageRef?.bringToFront(); };


// Primera vez
const onb = await ctx.newPage();
await onb.goto(ext("onboarding.html"));
await shot(onb, "01-bienvenida");
const welcomeVisible = await onb.locator("#welcome").isVisible();
if (welcomeVisible) await onb.click("#start");
await sleep(800);
await shot(onb, "02-primera-vez-pasos");
await onb.close();

// Popup como página de 340 px, con la página de prueba como pestaña activa.
const popup = await ctx.newPage();
await popup.setViewportSize({ width: 340, height: 420 });
await popup.goto(ext("popup.html"));
const errors = [];
popup.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
popup.on("pageerror", (e) => errors.push(String(e)));
const page = await ctx.newPage();
pageRef = page;
await page.goto(url);
await page.bringToFront();
await sleep(1500);
await popupShot("10-popup-inactivo");

const send = (m) => sw.evaluate(async (msg) => {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: (x) => chrome.runtime.sendMessage(x), args: [msg] });
  return r.result;
}, m);

log("grabar", await send({ type: "qua:start-session" }));
await sleep(300);
await popupShot("11-popup-abriendo");
await sleep(2500);
await page.hover("#nuevo-turno");
await sleep(600);
await send({ type: "qua:trigger-mark" });
await sleep(300);
await shot(page, "30-pastilla-grabando");
await popupShot("12-popup-grabando");
await sleep(3000);
await page.click("#nuevo-turno");
await sleep(1500);
log("detener", await send({ type: "qua:stop-session" }));
await sleep(500);
await popupShot("13-popup-procesando");
await shot(page, "31-pastilla-procesando");
for (let i = 0; i < 180; i++) {
  const st = await send({ type: "qua:get-status" });
  if (st?.latest?.status === "ready" || st?.latest?.status === "failed") break;
  await sleep(1000);
}
await sleep(1500);
await shot(page, "32-pastilla-lista");
await popupShot("14-popup-listo");
await popup.bringToFront();
await popup.click("#open-history");
await sleep(600);
await popupShot("15-popup-historial");

const st = await send({ type: "qua:get-status" });
const rep = await ctx.newPage();
await rep.goto(ext(`report.html?id=${encodeURIComponent(st.latest.id)}`));
await sleep(800);
await shot(rep, "20-reporte");

const set = await ctx.newPage();
await set.goto(ext("options.html"));
await sleep(800);
await set.screenshot({ path: join(opts.out, "21-ajustes.png"), fullPage: true });
log("21-ajustes");

// Ícono de la barra: lo que el SW dejó (no se puede capturar la barra de Chrome; se lee el estado).
log("badge", await sw.evaluate(() => chrome.action.getBadgeText({})));
log("errores del popup:", errors.length ? errors : "ninguno");
await ctx.close();
server.close();
