# QUA

Un QA que mira todo mientras hablás. Grabás una sesión en el navegador, hablás en voz alta
sobre lo que ves, y QUA produce un `report.md` con cada comentario anclado al elemento, la
ruta o la sesión donde lo dijiste — con selector, geometría, clases de Tailwind, archivo
fuente y evidencia de consola y red.

- **Spec:** [`docs/SPEC.md`](docs/SPEC.md) — fuente de verdad.
- **Estado:** [`STATE.md`](STATE.md) — tablero de tareas y bitácora.
- **Decisiones de implementación:** [`docs/DECISIONS.md`](docs/DECISIONS.md).

## Instalación y uso

No hay todavía una app de bandeja (Tauri, C1 en `STATE.md` — sin cerrar). Hasta que
cierre, QUA se usa como daemon de línea de comandos + extensión de Chrome cargada sin
empaquetar. Esto es real y funciona de punta a punta hoy (probado con Chrome real,
sin intervención manual, en `e2e/`).

### 1. El daemon (`quad` + `qua`)

**Opción A — `.dmg` precompilado:**

```bash
./packaging/macos/build-dmg.sh          # arma target/dist/qua-cli-macos-<version>.dmg
open target/dist/qua-cli-macos-*.dmg    # montalo, corré ./install.sh desde el volumen
```

El binario no está firmado (no hay Developer ID de Apple en este entorno) — el
`.dmg` trae las instrucciones de Gatekeeper (`xattr -d com.apple.quarantine`).

**Opción B — compilar y correr directo:**

```bash
~/.cargo/bin/cargo build --release -p quad
./target/release/quad          # arranca el daemon en 127.0.0.1:7331
```

Los datos (sesiones, modelo de whisper, `config.toml`) quedan en `~/.qua/`. El
modelo por default (`large-v3-turbo-q5_0`, ~574 MB) se baja solo la primera vez que
termina una sesión con audio; para no esperar esa descarga en una prueba rápida,
poné `model = "base"` bajo `[asr]` en `~/.qua/config.toml` (148 MB, el mismo que usa
el test de aceptación de B2).

### 2. La extensión de Chrome

Sin empaquetar todavía (necesita `pnpm install` + build primero):

```bash
pnpm --filter @qua/protocol --filter @qua/source-resolver run build
pnpm --filter @qua/extension run build   # produce extension/.output/chrome-mv3
```

En Chrome: `chrome://extensions` → activar "Modo de desarrollador" → "Cargar
descomprimida" → elegir `extension/.output/chrome-mv3`.

### 3. Emparejar y grabar

Con `quad` corriendo, abrí las opciones de la extensión (ícono → clic derecho →
Opciones) y seguí el flujo de pairing (código de 6 dígitos). Después, desde el
popup de la extensión: "Grabar" arranca la sesión, hablá en voz alta sobre lo que
ves en la página, "Detener" la cierra. `quad` corre ASR + correlador + render
automáticamente al recibir `session.stop` — no hace falta ningún paso manual
después.

### 4. Ver el reporte

```bash
qua sessions              # lista las sesiones grabadas, más recientes primero
qua show <id>              # report.md de una sesión (default)
qua show <id> --format json   # session.json completo
qua reprocess <id>         # re-corre el pipeline (para tunear [correlator] en config.toml)
```

### 5. Probarlo sin tocar nada a mano

`e2e/` tiene un script que hace exactamente los pasos de arriba con Chrome real,
sin ningún clic humano — ver [`e2e/README.md`](e2e/README.md):

```bash
pnpm --filter @qua/e2e run e2e
```

## Layout (§13)

```
packages/
  protocol/              TS + Zod — FUENTE DE VERDAD de los tipos
  source-resolver/       tiers 2 y 3 de React (§11)
  babel-plugin-source/
  vite-plugin-source/
extension/               WXT + TypeScript (MV3)
crates/
  qua-protocol/          espejo Rust + tests contra fixtures
  qua-core/              ingest · asr · correlate · render · store
  quad/                  binario axum (el daemon)
  qua-mcp/               binario MCP stdio
apps/qua-app/            Tauri 2 (C1 — sin cerrar)
fixtures/                sesiones doradas — contrato compartido TS ↔ Rust
e2e/                     sesión real de punta a punta (Chrome + daemon), G1
packaging/macos/         build-dmg.sh — daemon + CLI, G1
```

## Desarrollo

Node 26 · pnpm 10 · Rust 1.98. **`rustup` no está en el `PATH`**: se invoca por ruta
absoluta.

```bash
pnpm install
pnpm test                             # typecheck + vitest (incluye fixtures doradas)
pnpm gen:schema                       # regenera fixtures/schema/ desde Zod
~/.cargo/bin/cargo test --workspace   # incluye las mismas fixtures del lado Rust
```

## Las dos reglas

1. **Nadie toca `packages/protocol` ni `fixtures/` fuera de F0.** Si tu tarea necesita un
   cambio de contrato, lo reporta. Ver [`fixtures/README.md`](fixtures/README.md).
2. **Los umbrales van a `config.toml`, nunca hardcodeados.** Es lo que hace posible tunear
   el correlador con `qua reprocess` sin recompilar.
