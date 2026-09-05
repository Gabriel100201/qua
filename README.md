# QUA

Un QA que mira todo mientras hablás. Grabás una sesión en el navegador, hablás en voz alta
sobre lo que ves, y QUA produce un `report.md` con cada comentario anclado al elemento, la
ruta o la sesión donde lo dijiste — con selector, geometría, clases de Tailwind, archivo
fuente y evidencia de consola y red.

- **Spec:** [`docs/SPEC.md`](docs/SPEC.md) — fuente de verdad.
- **Estado:** [`STATE.md`](STATE.md) — tablero de tareas y bitácora.
- **Decisiones de implementación:** [`docs/DECISIONS.md`](docs/DECISIONS.md).

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
apps/qua-app/            Tauri 2
fixtures/                sesiones doradas — contrato compartido TS ↔ Rust
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
