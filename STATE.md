# QUA — Estado de la construcción

> **Leé esto primero.** Es el checkpoint del proyecto. Cualquier sesión (Gabriel a la
> mañana, el cron de madrugada, o una sesión nueva) retoma desde acá sin contexto previo.
> **Se actualiza después de cada tarea terminada.**

- **Spec:** `docs/SPEC.md` — fuente de verdad. La §14 tiene el plan de tareas completo.
- **Repo:** `/Users/gabrielfunes/Projects/personal/qua` · git local, sin remote (decisión de Gabriel).
- **Arrancado:** 2026-09-04 ~23:00 -03 (sesión nocturna de Gabriel, desatendida).

## Reglas que no se negocian

1. **Nadie toca `packages/protocol` ni `fixtures/` fuera de F0.** Si una tarea necesita un
   cambio de contrato, lo **reporta**, no lo aplica. Un cambio unilateral rompe en silencio
   a las otras siete tareas en paralelo.
2. Umbrales y parámetros van a `config.toml`, nunca hardcodeados.
3. Una tarea = un commit. Los criterios de aceptación de §14 son la definición de "listo".
4. Rust se invoca por ruta absoluta: `~/.cargo/bin/cargo` (rustup no modificó el PATH).

## Toolchain verificado

`node 26.7` · `pnpm 10.12` · `cargo 1.98.1` · `rustc 1.98.1` · `cmake 4.4.3` · `git` ·
`gh` · `ffmpeg` · `python3.9` · Chrome en `/Applications`

## Tablero

| Tarea | Dep. | Estado | Agente | Commit |
|---|---|---|---|---|
| F0 · Scaffold + contratos      | —      | ✅ hecho | Opus | `ba276ac` |
| F1 · Generador sintético       | F0     | ✅ hecho (ver F1c pendiente) | codex luna | `6e1e0b2` | `d28620d` |
| A1 · Content script            | F0     | ✅ hecho | sonnet | `99aec5b` | — |
| A2 · Service worker            | F0     | ✅ hecho | sonnet | `679c64f` | — | — |
| A3 · Offscreen + UI            | F0     | 🟡 en curso | sonnet | — | — |
| B1 · Daemon servidor y store   | F0     | ✅ hecho | sonnet | `08520bd` | — |
| B2 · Daemon audio y ASR        | F0     | ✅ hecho | sonnet | `2ed220b` | — | — |
| B3 · Correlador                | F0, F1 | 🟡 en curso | **opus** | — | — |
| B4 · Renderer y CLI            | F0, F1 | 🟡 en curso | sonnet | — | — |
| C1 · App Tauri                 | B1     | ⬜ pendiente | — | — |
| D1 · Servidor MCP              | F0     | 🟡 en curso | sonnet | — | — |
| E1 · Source mapping            | F0     | ✅ hecho | codex luna | `296b433` | `5173056` | — |
| G1 · Integración y packaging   | todas  | ⬜ pendiente | — | — |

Estados: ⬜ pendiente · 🟡 en curso · ✅ hecho · ❌ falló · ⏸️ bloqueada

## Reparto de modelos (cuota de Codex es escasa — decisión de Gabriel)

- **Opus:** F0 y B3 (contratos y correlador: las dos que más criterio requieren)
- **Sonnet:** implementación estándar (A1, A2, A3, B1, B2, B4, D1)
- **Codex `gpt-5.6-luna`:** solo F1 y E1 — spec cerrada, sin ida y vuelta
- **Haiku:** tareas mecánicas
- No usar `gpt-5.6-sol` salvo que Luna falle en algo concreto.

## Worktrees de los workers

Cada worker trabaja en su propio worktree para no pelearse por el índice de git ni por los
lockfiles. Se mergean a `main` a medida que cierran. Ruta: `~/orca/workspaces/qua/<id>`.

## Bitácora

- `2026-09-04 23:00` — Repo creado. `docs/SPEC.md` generada desde el artifact (693 líneas).
  Toolchain Rust + cmake instalado. Orquestación vía Orca.
- `2026-09-04 23:15` — **F0 hecha.** Monorepo armado según §13. `packages/protocol` con Zod
  (18 tipos de evento, los 13 mensajes de §04, layout del frame de audio) y su espejo a mano
  en `crates/qua-protocol`. Fixtures doradas en `fixtures/` con el test que las parsea en los
  dos lenguajes con round-trip. Esquema SQLite en `crates/qua-core/src/store/`. CI con
  `pnpm test` + `cargo test`. 60 tests TS · 13 tests Rust, verdes. Siete ambigüedades reales
  de la spec resueltas y anotadas en `docs/DECISIONS.md` (la más importante: **los tipos de
  evento son 18, no 17** — la tabla de §03 tiene 18 filas y la prosa de §14 quedó vieja).
  **Ola 1 desbloqueada:** F1 · A1 · A2 · A3 · B1 · B2 · D1 · E1 pueden arrancar en paralelo.

## Qué hacer si retomás en frío

1. Leé este archivo y `docs/SPEC.md` §14.
2. `git log --oneline` para ver qué commits entraron.
3. `orca orchestration task-list --json` para ver el estado de los workers.
4. Agarrá la primera tarea ⬜ cuyas dependencias estén ✅ y despachala.
- `2026-09-04 23:13` — **F0 ✅** (`ba276ac`). Verificado por el coordinador, no solo reportado:
  60 tests en TS + 11 en Rust, incluido round-trip cruzado y el frame binario dorado
  decodificando idéntico en los dos lenguajes. Encontró una contradicción real en la spec
  (§14 decía 17 tipos de evento, la tabla de §03 tiene 18) y ocho ambigüedades más, todas
  documentadas en `docs/DECISIONS.md`.
- `2026-09-04 23:30` — Ola 1 tanda A largada: **F1** y **E1** con Codex/Luna (otra bolsa de
  cuota, paralelismo gratis), **A1** y **B1** con Sonnet.

## Trampas ya resueltas (no las vuelvas a pisar)

1. **Claude Code se cuelga en el diálogo de confianza** de una carpeta nueva. Pre-aceptalo:
   `python3 <scratchpad>/trust.py <ruta>` escribe `hasTrustDialogAccepted` en `~/.claude.json`.
   Las 13 rutas de worktree ya están hechas.
2. **Codex se cuelga igual** con `codex-interactive-prompt`. Se arregla agregando
   `[projects."<ruta>"]` con `trust_level = "trusted"` a `~/.codex/config.toml`. Ya hecho.
3. **Codex bloqueaba con `codex-update-prompt`.** Resuelto actualizando a 0.153.4.
4. **`worker-start --worktree new-top-level` devuelve `selector_not_found`.** No lo uses.
   El camino que funciona es de tres pasos: `worktree create` → `terminal create --command
   '<agente con su modelo>'` → `terminal wait --for tui-idle` → `worker-start --terminal`.
   Está scripteado en `<scratchpad>/launch.sh <ID> <task> '<cmd>' [retry_of]`.
- `2026-09-04 23:35` — **F1 ✅** (`6e1e0b2`) pero **débil**. Verifiqué el entregable en vez de
  creerle al worker: los 20 escenarios pasan 20/20, pero `s01` tiene 3 eventos y un solo
  candidato. Con un único hover en la ventana, la fórmula de scoring de §07 paso 5, la regla
  de dominancia y la degradación a `route` nunca se ejercitan — B3 sacaría 100% con una
  implementación trivial. Lancé **F1b** para meter distractores, casos que distingan
  implementaciones, y una prueba de que un correlador ingenuo saca <60%.
  **B3 queda en espera hasta que F1b cierre**: no vale gastar Opus optimizando contra un
  benchmark de juguete.
- `2026-09-04 23:36` — También largué **A2**. Cinco workers concurrentes: A1, B1, E1, F1b, A2.
- Aviso enviado a A1/B1/E1: trabajar en su propio worktree. F1 (Codex) commiteó en `main`
  porque la spec menciona la ruta del repo principal como referencia y la tomó literal.
- `2026-09-04 23:42` — **E1 rechazada.** Reportó `succeeded` pero no había corrido los tests
  (le faltaba `node_modules` en el worktree). Instalé y corrí yo: falla
  `parses turbopack and skips framework frames`, que es **el tier 2** — el camino principal
  en Next 16 + React 19 + Turbopack. Relancé como **E1b** en el mismo terminal, con el fallo
  exacto y seis casos de cobertura que faltaban.

## Lección para el coordinador

Dos de los tres entregables revisados hasta ahora estaban mal a pesar de reportar éxito:
F1 pasaba sus tests pero con escenarios triviales, y E1 directamente no corrió los suyos.
**Verificar cada entregable ejecutando los criterios de aceptación, no leer el reporte del
worker.** Es lo que separó un merge sano de meter basura en `main`.
- `2026-09-04 23:50` — **E1b ✅** (`296b433`) verificada y mergeada a `main`. 70 tests verdes.
  Pendiente menor de estilo: `packages/source-resolver/src/index.ts` quedó con funciones
  enteras en una sola línea. Funciona y está testeado, pero merece un pase de formato.
- `2026-09-04 23:51` — Largué **B2** (audio + ASR). Es la de cola más larga: descarga el modelo
  de 574 MB y compila whisper.cpp con Metal, así que conviene que arranque temprano.
- `2026-09-05 23:26` — **F1b mergeada** (`42fb4b1`) pero con defectos que anoté: inventó un tipo
  de evento `scroll` que **no existe en el contrato** (el válido es `scroll_settle`, 234
  ocurrencias), el harness cubre solo 7 de los 18 tipos —faltan `console`, `net_fail`,
  `tab_switch`, `mark`, `long_task`, `layout_shift`, que son los que necesita el paso 7 de
  evidencia— y s01..s20 son 4 plantillas repetidas 5 veces. Lo que vale son s21..s26.
  **Queda pendiente F1c** para arreglarlo, con Sonnet, cuando se libere un slot.
- `2026-09-05 23:26` — **B3 largada con Opus.** No la bloqueé más esperando el harness: le di la
  spec como fuente y el aviso explícito de que el harness tiene defectos, con instrucción de
  NO ajustar la fórmula para que den los números y de reportar escenarios que contradigan §07.

## Observación sobre el reparto de modelos

Los tres entregables de **Codex/Luna** vinieron flojos: F1 con escenarios triviales, E1 sin
correr sus tests, F1b violando el contrato de eventos. **Opus** en F0 fue impecable a la
primera. Cada rechazo cuesta más que lo que ahorra la cuota barata: revisión del coordinador
más el relanzamiento. **Recomendación: reservar Luna para tareas mecánicas con criterio
verificable de una sola línea, y mandar a Claude todo lo que exija leer spec con cuidado.**
- `2026-09-05 23:42` — **A1 ✅** (`99aec5b`) verificada y mergeada. 57 tests propios; `main` queda
  con **127 tests** verdes. Reportó dos hallazgos sin aplicarlos, que es la disciplina correcta:
  **D-09**, que un content script genuinamente no puede escuchar `chrome.tabs.*`, así que
  `tab_switch`/`tab_close` quedan como builders puros para que A2 los dispare (análisis correcto);
  y **D-10**, un bug real de F0.
- `2026-09-05 23:42` — **Arreglé D-10 en `main`.** `packages/protocol/tsconfig.json` usa
  `rootDir: "."`, así que `tsc` emite en `dist/src/`, pero el `package.json` declaraba
  `main`/`exports`/`types` apuntando a `dist/` — un archivo que nunca se generaba. No lo notó
  nadie porque los tests del propio paquete importan por ruta relativa; A1 fue el primero en
  consumirlo como `@qua/protocol` desde otro paquete. Corregí los tres campos a `dist/src/`.
  Los alias que A1 puso en `extension/` siguen siendo válidos y se pueden borrar cuando alguien
  quiera; no urge.
- `2026-09-05 23:42` — Largué **A3** en el slot liberado.
- `2026-09-05 23:45` — **B1 ✅** (`08520bd`) verificada y mergeada. 29 tests, incluidos los dos
  criterios duros con procesos reales: 100k eventos por WS sin pérdida ni duplicados, y
  `kill -9` a mitad de sesión con `qua recover` reconstruyendo desde otro proceso.
  Nueve decisiones propias documentadas (D-B1-01..09).

### Cuidado al mergear: `docs/DECISIONS.md` se resuelve por UNIÓN

Resolví un conflicto en ese archivo con `--theirs` y **perdí D-09 y D-10 de A1**. Los
recuperé a mano. Cada worker agrega sus propias entradas, así que el conflicto siempre es
"ambos agregaron al final": hay que quedarse con las dos partes, nunca con un lado.
`STATE.md` sí se resuelve con `--ours` (lo escribe el coordinador).
- `2026-09-05 23:47` — **B3 encontró un bug de diseño en la spec, no una ambigüedad.** El paso 5
  de §07 decía fusionar candidatos del mismo `sel` **sumando** scores, pero el divisor `6.0` de
  la confianza del paso 6 es exactamente el score máximo de UN candidato — la fórmula de
  confianza se escribió asumiendo que no había suma. Sumando, una tira de eventos débiles sobre
  un distractor (7.07) le ganaba al hover sostenido + click reales (5.04) y anclaba al elemento
  equivocado con **confianza 1.00**, violando la regla de oro.
  **Resolución:** rendimientos decrecientes en vez de suma
  (`score_final = aporte_max + 0.25 × suma_del_resto`) y **confianza calculada del aporte máximo,
  no del score fusionado**. Así la corroboración ayuda a ganar la comparación pero la confianza
  sigue siendo honesta sobre la mejor evidencia sola: el que gana por acumular ruido llega con
  confianza baja y lo filtra el `min_score` o el `dominance_ratio`. `docs/SPEC.md` §07 corregida.
  El artifact publicado también hay que actualizarlo.
- `2026-09-05 01:56` — **PARÓN DE DOS HORAS: se agotaron los límites de tokens a las 23:46.**
  Los cinco workers (A2, A3, B2, B3, B4) se cortaron **en el mismo minuto** y quedaron *idle en
  el prompt* con los procesos vivos. Ni un archivo tocado en 130 minutos. Los límites se
  renovaron ~01:18 pero nadie los volvió a empujar: **el cron de la 01:33 fue lo que salvó la
  noche.** Alcanzaron a commitear A2 (service worker), B2 (audio+ASR) y B3 (correlador);
  A3 y B4 no habían arrancado. Reactivé a los cinco con `orca terminal send`.

### Cómo diagnosticar esto rápido (no confíes en los heartbeats)

Los dispatches seguían en `dispatched` y Orca no marcó nada como fallado. La señal real es el
**mtime de los archivos en cada worktree**:

```bash
for w in a2 a3 b2 b3 b4; do
  d=~/orca/workspaces/qua/$w
  last=$(find "$d" -type f -not -path "*/node_modules/*" -not -path "*/target/*" \
         -not -path "*/.git/*" -exec stat -f "%m" {} + | sort -rn | head -1)
  echo "$w: hace $(( ($(date +%s) - last) / 60 )) min"
done
```

Si todos frenaron **en el mismo minuto**, es límite de cuota, no un bug. Reactivación:

```bash
D=$(orca orchestration dispatch-show --task <task> --json | jq -r .result.dispatch.assignee_handle)
orca terminal send --terminal "$D" --text "Retomá: ..." --enter --json
```

Ojo: los handles guardados se ponen `stale`; resolvelos siempre desde `assignee_handle` del
dispatch, no de un archivo viejo.
- `2026-09-05 02:02` — **A2 ✅** (`679c64f`) verificada y mergeada. Su criterio duro pasa: el
  test simula 10 min con 5 cambios de pestaña y el daemon caído 30 s, y confirma cero eventos
  perdidos tras el replay del outbox. `main` queda con **165 tests** (95 de extensión).

### Cuidado al mergear: la unión NO sirve para archivos de configuración

`docs/DECISIONS.md` se resuelve por unión, pero **`extension/package.json`, `tsconfig.json` y
`vitest.config.ts` no**: A1 y A2 crearon cada uno su versión y unirlas a ciegas produce JSON
inválido y claves duplicadas. Las reconcilié a mano (union de deps, `types: ["chrome","node"]`,
`include` de `entrypoints/` y `test/`). **A3 va a chocar con los mismos tres archivos** —
reconciliar de nuevo a mano, no con `union.py`.

Regla por archivo al mergear:
- `STATE.md` → `--ours` (lo escribe el coordinador)
- `docs/DECISIONS.md` → unión (`scratchpad/union.py`)
- `pnpm-lock.yaml` / `Cargo.lock` → `--theirs` y después `pnpm install`
- configs (`package.json`, `tsconfig.json`, `vitest.config.ts`) → **a mano**
- `2026-09-05 02:07` — **B2 ✅** (`2ed220b`) verificada y mergeada. El test end-to-end es real,
  no un mock: `wav_en_espanol_produce_una_utterance_con_timestamps_por_palabra` corre VAD silero
  y whisper de verdad sobre `fixtures/audio/es-hover-sidebar.wav` y tarda ~10-16 s. Usa
  `ggml-base` (148 MB) en vez de `large-v3-turbo` para no hacer CI de 574 MB — decisión
  documentada. Conflicto en `crates/qua-core/src/lib.rs` entre B1 y B2 resuelto por unión de
  módulos. **63 tests de Rust + 165 de TS = 228 en total.**
- `2026-09-05 02:07` — Largué **D1** (servidor MCP), que es el puente a Linear.

### Cuidado: no hagas `git add` de un archivo que necesita revisión manual

En el merge de B2 mi loop de resolución hizo `git add` incluso del archivo que marcó como
"necesita revisión", y commiteé `lib.rs` con marcadores `<<<<<<<` adentro. Compiló en rojo.
Al resolver conflictos: los casos conocidos se resuelven y se agregan; **el resto se deja sin
agregar y se revisa antes de commitear.**

