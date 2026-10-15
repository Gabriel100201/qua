import { defineConfig } from "wxt";

/**
 * Config mínima de WXT para que `entrypoints/background` compile y corra.
 *
 * Es un borrador de A2, no el manifest final: A1 (content script, permisos de
 * hosts) y A3 (popup/options/offscreen, permiso de micrófono) van a necesitar
 * ampliar `manifest` acá. Ver `docs/DECISIONS.md` — quien la toque después,
 * que sume en vez de pisar los permisos de §05 ya declarados.
 */
import { fileURLToPath } from "node:url";

// Resolvemos los paquetes del workspace contra su FUENTE TS, igual que
// `vitest.config.ts`. Si no, el bundler usa `dist/`, que puede estar viejo: agregar
// una constante al protocolo y compilar la extensión sin reconstruir el paquete
// primero falla con "X is not exported", que no dice nada de la causa real.
const src = (p: string) => fileURLToPath(new URL(`../packages/${p}/src/index.ts`, import.meta.url));

export default defineConfig({
  srcDir: ".",
  alias: {
    "@qua/protocol": src("protocol"),
    "@qua/source-resolver": src("source-resolver"),
  },
  // Carpeta visible a propósito: el default de WXT es `.output`, y macOS esconde
  // todo lo que empieza con punto en el selector de archivos — cargar la extensión
  // sin empaquetar se vuelve innecesariamente difícil.
  outDir: "build",
  // El laboratorio de ASR (D-L1-02) solo entra en builds de desarrollo: QUA_LAB=1.
  filterEntrypoints: process.env.QUA_LAB === "1" ? undefined : ["background", "content", "offscreen", "popup", "options", "onboarding", "report", "pcm-tap-processor"],
  manifest: {
    name: "QUA",
    permissions: [
      "tabs",
      "storage",
      "offscreen",
      "alarms",
      "scripting",
      "webNavigation",
      // Chrome exige este permiso para que una página de la extensión pueda
      // abrir el micrófono mediante getUserMedia(). Sin él responde
      // NotSupportedError aun cuando macOS ya haya autorizado a Chrome.
      "audioCapture",
      // Modo local (D-L1-01): los pesos de whisper (~800 MB) quedan en la Cache API
      // del origen de la extensión, y el reporte se baja con `chrome.downloads`.
      "unlimitedStorage",
      "downloads",
      // Aviso de "reporte listo" y copiarlo desde ese aviso (offscreen con reason CLIPBOARD).
      "notifications",
      "clipboardWrite",
    ],
    // onnxruntime-web y qua-wasm compilan WebAssembly en el offscreen doc. MV3 lo
    // permite solo con 'wasm-unsafe-eval'; el resto del código sigue siendo 'self'.
    // La pastilla en la página usa Instrument Sans desde la extensión.
    web_accessible_resources: [{ resources: ["fonts/*.woff2"], matches: ["<all_urls>"] }],
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
    host_permissions: ["<all_urls>"],
    commands: {
      // Globales (D-L1-01): reemplazan al hotkey de la app Tauri y andan aunque Chrome
      // no tenga el foco. Chrome solo acepta sugerir Ctrl+Shift+[0-9] para globales.
      toggle_recording: {
        suggested_key: { default: "Ctrl+Shift+1" },
        description: "Empezar/parar la grabación de sesión",
        global: true,
      },
      drop_mark: {
        suggested_key: { default: "Ctrl+Shift+2" },
        description: "Marcador de precisión",
        global: true,
      },
    },
  },
});
