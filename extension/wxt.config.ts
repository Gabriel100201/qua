import { defineConfig } from "wxt";

/**
 * Config mínima de WXT para que `entrypoints/background` compile y corra.
 *
 * Es un borrador de A2, no el manifest final: A1 (content script, permisos de
 * hosts) y A3 (popup/options/offscreen, permiso de micrófono) van a necesitar
 * ampliar `manifest` acá. Ver `docs/DECISIONS.md` — quien la toque después,
 * que sume en vez de pisar los permisos de §05 ya declarados.
 */
export default defineConfig({
  srcDir: ".",
  manifest: {
    name: "QUA",
    permissions: ["tabs", "storage", "offscreen", "alarms", "scripting", "webNavigation"],
    host_permissions: ["<all_urls>"],
    commands: {
      toggle_recording: {
        suggested_key: { default: "Ctrl+Shift+R" },
        description: "Empezar/parar la grabación de sesión",
      },
      drop_mark: {
        suggested_key: { default: "Ctrl+Shift+E" },
        description: "Marcador de precisión",
      },
    },
  },
});
