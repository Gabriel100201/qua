# `@qua/synth`

Generador TypeScript elegido para F1b. `pnpm --filter @qua/synth test` genera 26 sesiones realistas en `expected/` y valida el manifiesto/ground truth. Hay 20 escenarios fortalecidos y 6 casos discriminantes; todos usan distractores (15–24 eventos), rutas `/agenda/semana`, selectores `data-testid` y texto rioplatense.

El runner incluye un baseline ingenuo que toma el candidato más cercano temporalmente: su resultado sobre el set es **3.8% (1/26)**, por debajo del 60% exigido. La métrica evita que un único candidato haga pasar el harness sin ejercitar scoring, visibilidad, dominancia o deixis.
