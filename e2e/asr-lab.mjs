#!/usr/bin/env node
// Laboratorio de ASR (D-L1-02): corre el pipeline local en Chrome real (WebGPU) sobre el
// PCM crudo de una sesión de quad, con varias configuraciones, y compara contra el
// transcript de whisper.cpp de esa misma sesión. Necesita un build con QUA_LAB=1.
//
// Uso: node asr-lab.mjs --session ~/.qua/sessions/<id> --profile <dir> [--configs a,b]

import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXTENSION_OUTPUT = join(__dirname, "../extension/build/chrome-mv3");

const CONFIGS = {
  "turbo-fp16-q4": { model: "onnx-community/whisper-large-v3-turbo", device: "webgpu", dtype: { encoder_model: "fp16", decoder_model_merged: "q4" }, returnTimestamps: true },
  "turbo-fp16-q4-nots": { model: "onnx-community/whisper-large-v3-turbo", device: "webgpu", dtype: { encoder_model: "fp16", decoder_model_merged: "q4" }, returnTimestamps: false },
  "turbo-fp32-q4-nots": { model: "onnx-community/whisper-large-v3-turbo", device: "webgpu", dtype: { encoder_model: "fp32", decoder_model_merged: "q4" }, returnTimestamps: false },
  "turbo-q4-nots": { model: "onnx-community/whisper-large-v3-turbo", device: "webgpu", dtype: "q4", returnTimestamps: false },
  "turbo-fp16-fp16-nots": { model: "onnx-community/whisper-large-v3-turbo", device: "webgpu", dtype: { encoder_model: "fp16", decoder_model_merged: "fp16" }, returnTimestamps: false },
  "small-wasm-q8-nots": { model: "onnx-community/whisper-small", device: "wasm", dtype: "q8", returnTimestamps: false },
  "base-wasm-q8-nots": { model: "onnx-community/whisper-base", device: "wasm", dtype: "q8", returnTimestamps: false },
  "turbo-wasm-q8-nots": { model: "onnx-community/whisper-large-v3-turbo", device: "wasm", dtype: "q8", returnTimestamps: false },
};

const { values: opts } = parseArgs({
  options: {
    session: { type: "string" },
    profile: { type: "string" },
    configs: { type: "string", default: "turbo-fp16-q4,turbo-fp16-q4-nots" },
    out: { type: "string" },
  },
});

const norm = (s) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9ñ\s]/g, " ").split(/\s+/).filter(Boolean);
function wer(ref, hyp) {
  let prev = Array.from({ length: hyp.length + 1 }, (_, j) => j);
  for (let i = 1; i <= ref.length; i++) {
    const cur = [i];
    for (let j = 1; j <= hyp.length; j++)
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[hyp.length] / ref.length;
}

const pcmB64 = readFileSync(join(opts.session, "raw/audio.pcm")).toString("base64");
const reference = JSON.parse(readFileSync(join(opts.session, "session.json"), "utf8")).utterances;
const refWords = norm(reference.map((u) => u.text).join(" "));

const context = await chromium.launchPersistentContext(opts.profile, {
  headless: false,
  ignoreDefaultArgs: ["--disable-extensions", "--disable-component-extensions-with-background-pages"],
  args: [`--disable-extensions-except=${EXTENSION_OUTPUT}`, `--load-extension=${EXTENSION_OUTPUT}`, "--enable-unsafe-webgpu", "--no-first-run"],
});
let sw;
for (let i = 0; i < 50 && !sw; i++) {
  for (const w of context.serviceWorkers()) {
    try {
      if ((await w.evaluate(() => chrome.runtime.getManifest().name)) === "QUA") sw = w;
    } catch {}
  }
  if (!sw) await new Promise((r) => setTimeout(r, 300));
}
const id = new URL(sw.url()).host;
const page = await context.newPage();
await page.goto(`chrome-extension://${id}/asr-lab.html`);
await page.waitForFunction(() => document.title === "lab-ready");

const results = {};
for (const name of opts.configs.split(",")) {
  const cfg = CONFIGS[name];
  const t = Date.now();
  try {
    const r = await page.evaluate(([c, b]) => window.lab.run(c, b), [cfg, pcmB64]);
    const hyp = norm(r.utterances.map((u) => u.text).join(" "));
    results[name] = { ...r, wer: wer(refWords, hyp) };
    console.log(
      `${name.padEnd(22)} WER ${(results[name].wer * 100).toFixed(1)}% · ${r.utterances.length}/${reference.length} utt · ` +
        `carga ${(r.loadMs / 1000).toFixed(1)} s · proceso ${(r.runMs / 1000).toFixed(1)} s para ${(r.audioMs / 1000).toFixed(0)} s de audio`,
    );
  } catch (err) {
    console.log(`${name.padEnd(22)} FALLÓ en ${((Date.now() - t) / 1000).toFixed(0)} s: ${String(err).slice(0, 300)}`);
  }
}
if (opts.out) writeFileSync(opts.out, JSON.stringify(results, null, 1));
await context.close();
