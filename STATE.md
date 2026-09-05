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
| F1 · Generador sintético       | F0     | ✅ hecho | codex luna | `d28620d` |
| A1 · Content script            | F0     | 🟡 en curso | sonnet | — |
| A2 · Service worker            | F0     | ✅ hecho | sonnet | `679c64f` |
| A3 · Offscreen + UI            | F0     | ⬜ pendiente | — | — |
| B1 · Daemon servidor y store   | F0     | 🟡 en curso | sonnet | — |
| B2 · Daemon audio y ASR        | F0     | ⬜ pendiente | — | — |
| B3 · Correlador                | F0, F1 | ⬜ pendiente | — | — |
| B4 · Renderer y CLI            | F0, F1 | ⬜ pendiente | — | — |
| C1 · App Tauri                 | B1     | ⬜ pendiente | — | — |
| D1 · Servidor MCP              | F0     | ⬜ pendiente | — | — |
| E1 · Source mapping            | F0     | 🟡 en curso | codex luna | — |
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
- `2026-09-05` — **A2 ✅** (`679c64f`). Service worker en `extension/entrypoints/background/`:
  FSM de sesión en `chrome.storage.session`, ciclo de pestañas, cliente WS del protocolo §04
  con outbox en IndexedDB (ack por seq, replay al reconectar, backoff 250ms→8s), ring de 40
  screenshots vía OffscreenCanvas, keepalive con `chrome.alarms`. 38 tests con `wxt/testing`
  (fakeBrowser) y `fake-indexeddb`, sin dependencias de otras tareas — incluye el test del
  criterio de aceptación (10 min, 5 cambios de pestaña, daemon caído 30s en el medio, cero
  eventos perdidos tras el replay). Encontró (sin tocarlo) un bug de build real en
  `packages/protocol` — `exports`/`types` apuntan a `dist/*` pero `tsc` emite a `dist/src/*` —
  documentado en `docs/DECISIONS.md` (A2-04) con workaround acotado a `extension/`. Cinco
  decisiones más (A2-01 a A2-05) sobre ambigüedades del protocolo interno y de reconexión.
