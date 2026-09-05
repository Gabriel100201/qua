# `@qua/synth`

Generador TypeScript de fixtures sintéticas para medir el correlador de B3 (§07). `pnpm --filter @qua/synth test` genera 27 sesiones en `expected/`, valida el ground truth interno, corre el baseline ingenuo y — lo más importante — relee cada `.events.ndjson` y `.utterances.json` ya escrito en disco y lo valida contra el `EventSchema`/`UtteranceSchema` reales de `@qua/protocol`. Si una sola línea no valida contra el contrato de §03, el test falla.

Saneado en F1c: la entrega original de F1b emitía un tipo de evento inexistente (`scroll`, en vez de `scroll_settle`) y les faltaban campos requeridos a `nav`, `click`, `scroll_settle` y `mutation_burst` — 572 de 651 líneas eran inválidas contra el contrato. Ver `docs/DECISIONS.md`, D-F1c-01, para el detalle de los tres defectos y cómo se corrigieron.

## Escenarios

- **20 base** (`s01`–`s20`): 5 por cada clase de deixis de §07 paso 3 (POINTER, ACTION, SCREEN, GLOBAL), cada uno con ruta, selectores, texto y estructura de distractores propios — no son plantillas repetidas.
- **6 discriminantes** (`s21`–`s26`): casos límite de §07 — un target que resiste distractores acumulados, ACTION que ignora el cursor actual, ambigüedad real (ratio < `dominance_ratio` → degrada a `route`, que es el comportamiento correcto), visibilidad penalizando al candidato oculto, corte por marcador de tema, y ruido ASR sin señal de habla.
- **1 de ancla dura** (`s27`): `marked: true` + evento `mark`, para ejercitar la ventana angosta `[-2500, +500]` del paso 4 en vez de la ventana normal.

Entre los 27 escenarios se cubren los 18 tipos de evento de §03, incluidos los 5 tipos de evidencia que el harness original no usaba nunca (`console`, `net_fail`, `net_slow`, `long_task`, `layout_shift` — sin ellos el paso 7 de §07 no se ejercita) y el resto como ruido ambiente realista (`tab_switch`, `input`, `submit`, `viewport`, `tab_close`, `audio_gap`).

## Métricas

El runner incluye un baseline ingenuo que toma, de los 4 tipos anclables, el evento más cercano en el tiempo a `t_start` sin mirar selector, deixis ni scoring: su resultado sobre las 27 sesiones es **40.7% (11/27)**, por debajo del 60% exigido — evita que un correlador que solo mire cercanía temporal pase el harness sin ejercitar scoring, visibilidad, dominancia o deixis.

El correlador real de B3 (`cargo test -p qua-core --test harness_sintetico -- --nocapture`), con la config por defecto de `[correlator]`, ancla correctamente **27/27 (100%)** de los escenarios sobre este harness corregido, con 0 líneas rechazadas o descartadas por el contrato.
