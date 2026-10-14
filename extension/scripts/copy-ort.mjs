#!/usr/bin/env node
// Copia los binarios de onnxruntime-web que usa transformers.js a public/ort/ (D-L1-01).
// MV3 no deja cargar código remoto, así que tienen que viajar dentro del paquete; son
// 21 MB y salen de node_modules, por eso no van a git y se copian antes de cada build.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = dirname(require.resolve("@huggingface/transformers"));
const out = join(here, "../public/ort");
mkdirSync(out, { recursive: true });
for (const f of ["ort-wasm-simd-threaded.jsep.mjs", "ort-wasm-simd-threaded.jsep.wasm"]) {
  copyFileSync(join(dist, f), join(out, f));
}
console.log(`[copy-ort] ${out}`);
