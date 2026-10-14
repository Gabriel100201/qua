# QUA

Un QA que mira todo mientras hablás. Grabás una sesión en el navegador, hablás en voz alta
sobre lo que ves, y QUA produce un `report.md` con cada comentario anclado al elemento, la
ruta o la sesión donde lo dijiste — con selector, geometría, clases de Tailwind, archivo
fuente y evidencia de consola y red.

- **Spec:** [`docs/SPEC.md`](docs/SPEC.md) — fuente de verdad.
- **Estado:** [`STATE.md`](STATE.md) — tablero de tareas y bitácora.
- **Decisiones de implementación:** [`docs/DECISIONS.md`](docs/DECISIONS.md).

## Instalación y uso — solo la extensión (modo local)

QUA es **una extensión de Chrome y nada más**: no hay app, daemon ni pairing. La extensión
graba, transcribe con Whisper en tu GPU (WebGPU) y arma el reporte sin que el audio salga
del navegador. Ver D-L1-01 en `docs/DECISIONS.md`.

1. Instalá la extensión. Se abre sola la página de configuración: dale permiso al
   micrófono y, si querés, bajá el modelo de voz (~1 GB, una sola vez).
2. Abrí la página a revisar, apretá **Grabar** (o `Ctrl+Shift+1` desde cualquier app) y
   hablá en voz alta sobre lo que ves.
3. **Detener**. Al rato el popup muestra **Copiar reporte** (lo pegás en tu agente, Linear
   o Slack) y **Descargar** (`Descargas/qua/<id>/report.md` con sus capturas).

Para compilarla desde el repo:

```bash
pnpm install
pnpm --filter @qua/extension run build:wasm   # qua-core → WebAssembly (necesita Rust + wasm-pack)
pnpm --filter @qua/extension run build        # → extension/build/chrome-mv3
node e2e/local.e2e.mjs                         # sesión real en Chrome, sin daemon
```

## Modo daemon (anterior)

Hay una app de bandeja (Tauri 2, `apps/qua-app`) con tray, hotkeys globales, onboarding y
sidecar del daemon — y también se puede usar sin ella: `quad` corrido directo desde la
terminal + la extensión de Chrome cargada sin empaquetar. Las dos formas comparten
`~/.qua/` (sesiones, modelo de whisper, `config.toml`) y el mismo protocolo — ninguna es un
fallback de la otra. Esto es real y funciona de punta a punta hoy: probado con Chrome real,
sin intervención manual, en `e2e/` (el camino sin la app — ver más abajo por qué).

### Arranque rápido: repo recién clonado → un `report.md`

**Node 26 · pnpm 10 · Rust 1.98.** En esta máquina `rustup` se instaló con
`--no-modify-path`, así que `cargo`/`rustc` no quedaron en el `PATH` de una shell nueva —
por eso todos los comandos de Rust de este README (acá y en `docs/DECISIONS.md`) usan la
ruta absoluta `~/.cargo/bin/cargo`.

```bash
pnpm install                                                          # una vez
pnpm --filter @qua/protocol --filter @qua/source-resolver run build   # dependencias de la extensión
pnpm --filter @qua/extension run build                                # → extension/.output/chrome-mv3
apps/qua-app/scripts/build-sidecars.sh                                 # compila quad+qua release, los copia a src-tauri/binaries/
~/.cargo/bin/cargo build --release -p quad
./target/release/quad                                                  # daemon en 127.0.0.1:7331
```

`build-sidecars.sh` hace falta incluso si no vas a tocar la app: `apps/qua-app` es parte
del workspace de Cargo, así que sin los binarios de sidecar ni `~/.cargo/bin/cargo test
--workspace` compila (ver `docs/DECISIONS.md`, D-M1-03).

Con el daemon corriendo:

1. `chrome://extensions` → "Modo de desarrollador" → "Cargar descomprimida" → elegir
   `extension/.output/chrome-mv3`.
2. Abrí el popup de la extensión (ícono) y clickeá "Conectar" — un solo click, sin
   terminal ni código (D-U1-01, `docs/DECISIONS.md`: emparejamiento automático mientras
   el daemon no tenga ninguna extensión emparejada todavía). Si ya emparejaste una
   extensión antes y necesitás re-emparejar, el popup te manda a las opciones para el
   código de 6 dígitos (`POST /pair/start` + `POST /pair`, el flujo de siempre).
3. Desde el popup de la extensión: "Grabar", hablá en voz alta sobre lo que ves, "Detener".
   `quad` corre ASR + correlador + render solo al recibir `session.stop`.
4. Cuando termine el procesamiento, usá **Copiar reporte** en el popup. También podés usar `qua last` o `qua last --copy`.

Este es el camino que verifiqué corriendo cada comando de este pase (build, daemon,
`qua sessions`/`show`/`reprocess`, y el `e2e/` completo — ver §6 más abajo). **La app de
bandeja (§3) no la relancé de punta a punta en este pase**: abre una ventana real y pide
pairing a mano, así que no es automatizable sin intervención humana — `apps/qua-app/README.md`
documenta que arranca y responde `/health` (verificado ahí), pero el flujo de grabación
completo vía tray/hotkey no tiene una prueba automática todavía.

### 1. El daemon (`quad` + `qua`)

**Opción A — `.dmg` completo (app, daemon, CLI y extensión):**

```bash
./packaging/macos/build-dmg-app.sh
open target/release/bundle/dmg/QUA_*.dmg
```

Arrastrá QUA a Aplicaciones y abrila. Como no hay Developer ID en este entorno, usá
clic derecho → Abrir; si macOS la bloquea, Configuración del Sistema → Privacidad y
seguridad → Abrir de todas formas. El onboarding muestra la ruta exacta de la extensión
incluida y los pasos para cargarla en Chrome. `build-dmg.sh` sigue disponible para quien
quiera solamente los binarios CLI.

**Opción B — compilar y correr directo:**

```bash
~/.cargo/bin/cargo build --release -p quad
./target/release/quad          # arranca el daemon en 127.0.0.1:7331
```

Los datos (sesiones, modelo de whisper, `config.toml`) quedan en `~/.qua/`. El
modelo por default (`large-v3-turbo-q5_0`, ~574 MB) se baja solo la primera vez que
termina una sesión con audio; para no esperar esa descarga en una prueba rápida,
poné `model = "base"` bajo `[asr]` en `~/.qua/config.toml` (148 MB, el mismo que usa
el test de aceptación de B2 y el que usa `e2e/`).

### 2. La extensión de Chrome

Sin empaquetar todavía (necesita `pnpm install` + build primero):

```bash
pnpm --filter @qua/protocol --filter @qua/source-resolver run build
pnpm --filter @qua/extension run build   # produce extension/.output/chrome-mv3
```

En Chrome: `chrome://extensions` → activar "Modo de desarrollador" → "Cargar
descomprimida" → elegir `extension/.output/chrome-mv3`.

### 3. La app de bandeja (opcional, pensada para uso diario)

`apps/qua-app` (Tauri 2) reemplaza el paso "correr `quad` a mano" del daemon: ícono en la
barra de menú (sin ícono en el Dock), levanta y supervisa `quad` como sidecar con
health-check y reinicio automático si se muere, hotkeys globales (⌘⇧R graba/para, ⌘⇧E deja
un marcador — funcionan con cualquier app en foco, Chrome incluido), onboarding que baja el
modelo de ASR con progreso real y pide permiso de micrófono, y una ventana de sesiones. Ver
[`apps/qua-app/README.md`](apps/qua-app/README.md) para el detalle completo (estructura,
qué hace cada módulo, build de producción).

```bash
apps/qua-app/scripts/build-sidecars.sh   # una vez, y cada vez que cambie crates/quad o crates/qua-core
cd apps/qua-app && pnpm tauri dev
```

**Límite conocido** (§09, D-P1-02): el hotkey global llega al daemon por `POST /control` y
de ahí a la extensión por `session.control` — es best-effort; si el daemon no responde, el
intento queda logueado en `~/.qua/logs/qua-app.log` en vez de fallar en silencio.

### 4. Emparejar y grabar

Con `quad` corriendo (a mano o vía la app), abrí el popup de la extensión (ícono) y
clickeá "Conectar" — un click alcanza si es el primer emparejamiento (D-U1-01,
`docs/DECISIONS.md`; `POST /pair/auto`). Si el popup dice "El daemon no está corriendo",
es porque `quad` no está arriba: te muestra el comando exacto para levantarlo. Si ya
había una extensión emparejada, el popup te manda a las opciones para el código de 6
dígitos (`POST /pair/start` + `POST /pair`). Después, "Grabar" arranca la sesión — desde el popup de la extensión, o con el hotkey global
si estás usando la app — hablá en voz alta sobre lo que ves en la página, "Detener" la
cierra. `quad` corre ASR + correlador + render automáticamente al recibir `session.stop` —
no hace falta ningún paso manual después.

### 5. Ver el reporte

```bash
qua sessions              # lista las sesiones grabadas, más recientes primero
qua show <id>              # report.md de una sesión (default)
qua last                   # report.md más reciente
qua last --copy            # lo copia al portapapeles
qua show <id> --format json   # session.json completo
qua reprocess <id>         # re-corre el pipeline (para tunear [correlator] en config.toml)
```

O, si estás usando la app de bandeja, desde su ventana de sesiones (`report.md` en texto
plano, sin Markdown renderizado todavía).

### 6. Probarlo sin tocar nada a mano

`e2e/` tiene un script que hace exactamente los pasos 1, 2 y 4 de arriba con Chrome real
(vía Playwright — no el Chrome de `/Applications`, ver D-G1-05 en `docs/DECISIONS.md`) y un
daemon real, sin ningún clic humano: lanza la extensión cargada, arranca una sesión,
hace un hover real sobre un botón mientras le inyecta a Chrome un `.wav` como si fuera el
micrófono, para la sesión, y valida que el daemon produzca un `report.md` real con
transcripción de whisper — ver [`e2e/README.md`](e2e/README.md):

```bash
pnpm --filter @qua/e2e run e2e
```

No usa la app de bandeja (§3): arranca `quad` directo, igual que la Opción B de §1 — es
el camino que sí está probado de punta a punta sin intervención humana.

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
apps/qua-app/            Tauri 2 — tray, sidecar, hotkeys globales, onboarding (C1)
fixtures/                sesiones doradas — contrato compartido TS ↔ Rust
e2e/                     sesión real de punta a punta (Chrome + daemon), G1
packaging/macos/         build-dmg.sh — daemon + CLI (sin la app de bandeja), G1
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

`cargo test --workspace` compila `apps/qua-app` como parte del workspace, así que necesita
los binarios de sidecar — corré `apps/qua-app/scripts/build-sidecars.sh` una vez por
worktree antes del primer `cargo test --workspace` (ver `docs/DECISIONS.md`, D-M1-03).

## Las dos reglas

1. **Nadie toca `packages/protocol` ni `fixtures/` fuera de F0.** Si tu tarea necesita un
   cambio de contrato, lo reporta. Ver [`fixtures/README.md`](fixtures/README.md).
2. **Los umbrales van a `config.toml`, nunca hardcodeados.** Es lo que hace posible tunear
   el correlador con `qua reprocess` sin recompilar.
