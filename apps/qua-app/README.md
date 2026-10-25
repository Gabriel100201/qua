# apps/qua-app

App Tauri 2 en la barra de menú (§09), implementada por **C1**.

## Correr en dev

```sh
cd apps/qua-app
pnpm install                    # una vez, o desde la raíz del monorepo
./scripts/build-sidecars.sh     # compila quad+qua y los copia a src-tauri/binaries/
pnpm tauri dev
```

`build-sidecars.sh` hay que rerunearlo cada vez que cambia el código de `crates/quad` o
`crates/qua-core` — los binarios de sidecar no se regeneran solos (§13: son ~25-30 MB cada
uno, no están commiteados, ver `docs/DECISIONS.md` D-C1-02).

## Build de producción

```sh
export PATH="$HOME/.cargo/bin:$PATH"   # cargo no está en PATH por default, ver STATE.md
../../packaging/macos/build-dmg-app.sh
```

Genera `target/release/bundle/macos/QUA.app` y el `.dmg`, con `quad`, `qua` y la carpeta
compilada de la extensión como recurso. La pantalla inicial muestra su ruta copiable y las
instrucciones exactas de Chrome; la app arranca y supervisa el daemon sola.

## Qué hace (§09)

- **Tray**: ícono en la barra de menú (sin ícono en el Dock — `LSUIElement` en
  `src-tauri/Info.plist`). Menú con estado (idle / ● grabando / procesando), duración
  corriendo, medidor de nivel de mic en vivo (barra de caracteres + %), submenú de
  dispositivo de entrada, y accesos a Sesiones / Pairing / `qua doctor`.
- **Sidecar**: lanza `quad` vía `tauri-plugin-shell` (mecanismo oficial de sidecar, no
  `std::process::Command` a mano). Health-check contra `GET /health` cada 5 s. Si el proceso
  muere (lo mataste vos, o 3 health-checks seguidos fallan y lo matamos nosotros) se
  relanza con backoff exponencial 250 ms → 8 s, reseteado si aguantó > 30 s vivo. Logs
  unificados en `~/.qua/logs/qua-app.log`. **Probado**: `kill -9` al proceso `quad` → se
  relanza solo, `/health` vuelve a responder.
- **Hotkeys globales** (`tauri-plugin-global-shortcut`): ⌘⇧R togglea el estado local de
  grabación del tray, ⌘⇧E deja un marcador en el log. Disparan con cualquier app en foco
  (Chrome incluido) porque son una API del SO, no del webview. **Límite conocido**: todavía
  no mueven una sesión real de la extensión — el canal servidor→cliente para eso no existe
  en el protocolo de §04. Ver `docs/DECISIONS.md` D-C1-01 para el detalle y cómo cerrarlo.
- **Ventana de sesiones** (mínima, a propósito — así lo prioriza §14): lista de
  `~/.qua/sessions/*` leída con `qua_core::read_meta`, `report.md` en un `<pre>` (sin
  renderizar Markdown todavía), reproductor de audio si existe `audio.opus`, y botones
  reprocess / refine (disparan el binario `qua`, hoy stub para esos dos — ver B4) / revelar
  en Finder / copiar ruta.
- **Onboarding**: descarga del modelo de ASR con progreso real (reusa
  `qua_core::asr::model::ensure_model` de B2 — mismos SHA-256 verificados, no hashes
  inventados), botón de permiso de micrófono (abre un stream `cpal` un instante, que en
  macOS es lo que dispara el diálogo de permiso del SO), `qua doctor`, y una ventana de
  pairing que pide el código de 6 dígitos a `POST /pair/start` del daemon.

## Estructura

```
src/            frontend Vite + TS plano, sin framework — un solo index.html ruteado por
                hash (#/onboarding, #/pairing, #/sessions) reutilizando una sola ventana.
src-tauri/
  src/
    lib.rs                setup: plugins, tray, hotkeys, sidecar, tick de refresco
    state.rs               AppState compartido (rec_state, nivel de mic, etc.)
    sidecar.rs              supervisor de `quad` + health-check
    tray.rs / hotkeys.rs / hotkeys_actions.rs / windows.rs
    audio.rs                cpal: enumerar dispositivos, medidor de nivel
    model.rs                descarga del modelo (delega en qua-core)
    commands.rs             comandos invocados desde el frontend
    paths.rs                rutas de ~/.qua/ (delega en quad::config)
  capabilities/default.json permisos de la única ventana (opener, clipboard)
  tauri.conf.json
scripts/build-sidecars.sh
```

## Dependencias del monorepo

Reusa directamente `quad` (config, rutas de `~/.qua/`) y `qua-core`
(`qua_core::read_meta`, `qua_core::asr::model`) en vez de reimplementar — ver
`docs/DECISIONS.md` D-C1-02/03. No toca `packages/protocol` ni `fixtures/`.
