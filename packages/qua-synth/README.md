# `@qua/synth`

Generador TypeScript elegido para F1. `pnpm --filter @qua/synth build` genera 20 sesiones en `expected/`, cada una con `*.events.ndjson`, `*.utterances.json` y `*.expected.json`; `test` ejecuta el runner y reporta el porcentaje de acierto. Los escenarios cubren POINTER, ACTION, SCREEN, GLOBAL, cambio de pestaña, error de consola, ambigüedad (degrada a route), ruido descartable y `mark`.
