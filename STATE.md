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
| F1 · Generador sintético       | F0     | ⬜ pendiente | — | — |
| A1 · Content script            | F0     | ⬜ pendiente | — | — |
| A2 · Service worker            | F0     | ⬜ pendiente | — | — |
| A3 · Offscreen + UI            | F0     | ⬜ pendiente | — | — |
| B1 · Daemon servidor y store   | F0     | ✅ hecho | Sonnet | *(ver bitácora)* |
| B2 · Daemon audio y ASR        | F0     | ⬜ pendiente | — | — |
| B3 · Correlador                | F0, F1 | ⬜ pendiente | — | — |
| B4 · Renderer y CLI            | F0, F1 | ⬜ pendiente | — | — |
| C1 · App Tauri                 | B1     | ⬜ pendiente | — | — |
| D1 · Servidor MCP              | F0     | ⬜ pendiente | — | — |
| E1 · Source mapping            | F0     | ⬜ pendiente | — | — |
| G1 · Integración y packaging   | todas  | ⬜ pendiente | — | — |

Estados: ⬜ pendiente · 🟡 en curso · ✅ hecho · ❌ falló · ⏸️ bloqueada

## Reparto de modelos (cuota de Codex es escasa — decisión de Gabriel)

- **Opus:** F0 y B3 (contratos y correlador: las dos que más criterio requieren)
- **Sonnet:** implementación estándar (A1, A2, A3, B1, B2, B4, D1)
- **Codex `gpt-5.6-luna`:** solo F1 y E1 — spec cerrada, sin ida y vuelta
- **Haiku:** tareas mecánicas
- No usar `gpt-5.6-sol` salvo que Luna falle en algo concreto.

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
- `2026-09-04 ~23:40` — **B1 hecha.** Servidor axum en `crates/quad/` (§06): `/health`,
  `/pair/start` + `/pair` (código de 6 dígitos, ventana de 60s, allowlist de Origin, token
  de 32 bytes persistido en `config.toml`), y `/ws` con el loop de mensajes de §04. Ingesta
  crash-safe en `crates/qua-core/src/ingest/`: `raw/events.ndjson` (fsync cada
  `[daemon].fsync_interval_ms`, default 2000ms) y `raw/audio.pcm`, con **ack acumulativo
  que solo sale después del fsync** — nunca antes (D-B1-06). `qua recover <id>` (segundo
  binario del mismo crate, D-B1-05) reconstruye `session.json` + la fila de `sessions` en
  SQLite desde `raw/` sin que el proceso original esté vivo. Al parar la sesión, transcodea
  `raw/audio.pcm` → `audio.opus` con `ffmpeg` (best-effort, D-B1-08).
  `qua-core::ingest::pipeline` deja las interfaces (`AsrPipeline`, `Correlator`,
  `Renderer`) para B2/B3/B4 sin implementarlas.
  **Los dos criterios de aceptación corren en CI real:** `ingest_100k.rs` manda 100.000
  eventos por WS contra el servidor real y verifica cero pérdida/duplicados en
  `session.json`; `kill_and_recover.rs` levanta `quad` como proceso de verdad, le manda
  `Child::kill()` (SIGKILL real) a mitad de sesión, y corre `qua recover` como proceso
  aparte para confirmar que reconstruye. 29 tests Rust en el workspace, verdes;
  `cargo fmt --check` y `cargo clippy -D warnings` limpios. Nueve ambigüedades anotadas en
  `docs/DECISIONS.md` (D-B1-01 a D-B1-09) — ninguna toca `packages/protocol` ni `fixtures/`.
  **C1 desbloqueada** (depende de que B1 exponga `/health`, ya lo hace).

## Qué hacer si retomás en frío

1. Leé este archivo y `docs/SPEC.md` §14.
2. `git log --oneline` para ver qué commits entraron.
3. `orca orchestration task-list --json` para ver el estado de los workers.
4. Agarrá la primera tarea ⬜ cuyas dependencias estén ✅ y despachala.
