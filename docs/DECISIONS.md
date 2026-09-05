# QUA — Decisiones de implementación

> Ambigüedades reales de `docs/SPEC.md` resueltas durante la construcción, con el motivo.
> Las decisiones **cerradas** de producto están en §01 de la spec y no se discuten acá.
>
> Formato: una entrada por decisión, con la tarea que la tomó. Si una tarea necesita
> revertir una de estas, lo reporta — no la cambia sola.

---

## F0 · Scaffold y contratos

### D-01 · Los tipos de evento son 18, no 17

**Ambigüedad.** El criterio de aceptación de A1 en §14 dice «emite los 17 tipos de evento»,
pero la tabla de §03 lista 18 filas: `nav`, `tab_switch`, `tab_close`, `click`, `hover`,
`focus_change`, `input`, `submit`, `scroll_settle`, `viewport`, `console`, `net_fail`,
`net_slow`, `long_task`, `layout_shift`, `mutation_burst`, `mark`, `audio_gap`.

**Decisión.** Manda la tabla: se implementan los 18. La prosa parece un conteo viejo, de
antes de agregar uno de los tipos (probablemente `audio_gap`, que es el único que no emite
el content script sino el service worker).

**Por qué.** Quitar uno para llegar a 17 sería elegir arbitrariamente cuál se pierde, y
todos aparecen usados en otras secciones: `audio_gap` en §04 (resiliencia) y en
`Session.audio.gaps_ms`, `mutation_burst` en §07 paso 7.

**Consecuencia para A1.** Su criterio real es emitir 17 de los 18 desde el content script;
`audio_gap` lo emite A2/A3 cuando se desborda el buffer de audio.

### D-02 · `ended_at` y `duration_ms` son opcionales en `Session`

**Ambigüedad.** El ejemplo de §03 los muestra siempre presentes, pero `status` incluye
`"recording"`, y durante la grabación todavía no existen.

**Decisión.** Ambos son opcionales (ausentes, no `null`). `git` también, porque una sesión
sobre un origen que no mapea a ningún `[[projects]]` con `repo` no tiene repo que mirar.

**Por qué.** Un `session.json` de una sesión en curso tiene que ser válido: `qua recover`
lee exactamente eso después de un `kill -9`. La alternativa —exigirlos y llenarlos con
ceros— haría que un reporte a medio hacer mienta sobre su duración.

**Nota.** `Issue.exported_to` **sí** es requerido-nullable (`null` explícito), no opcional:
la diferencia entre «nunca se exportó» y «no sé» importa para `qua_issues_pending`, y el
índice `idx_pending` filtra por `exported_to IS NULL`.

### D-03 · `ping` no tiene respuesta propia

**Ambigüedad.** §04 lista `{ v:1, type:"ping" }` entre los mensajes cliente → servidor,
pero la lista servidor → cliente no tiene ningún `pong`.

**Decisión.** No se inventa un `pong`. `ping` es un keepalive de nivel de aplicación cuyo
único efecto es tráfico sobre el socket; la liveness se detecta con el pong del propio
WebSocket y con el cierre del socket.

**Por qué.** Agregar un mensaje que la spec no tiene rompería la simetría del contrato justo
en la parte que ocho tareas van a leer como referencia. Y el keepalive real del service
worker es el audio a 50 fps (§5.3): `ping` es la red de seguridad para cuando no hay audio.

**Si hace falta un `pong`,** lo reporta A2 y se agrega en F0, no en la tarea.

### D-04 · `error.code` es un string libre con una lista de códigos conocidos

**Ambigüedad.** §04 define `{ type:"error", code, message }` sin enumerar los códigos.

**Decisión.** `code` valida como `string`, y el paquete exporta `ERROR_CODES`
(`unauthorized`, `origin_rejected`, `bad_message`, `no_session`, `version_mismatch`,
`storage`, `asr`, `internal`) como constantes compartidas. El espejo Rust las tiene en
`messages::error_codes`.

**Por qué.** Un enum cerrado obligaría a tocar `packages/protocol` —que está congelado fuera
de F0— cada vez que B1 o B2 necesitan un código nuevo. Con constantes compartidas, el caso
común está tipado y el caso raro no bloquea a nadie.

### D-05 · La igualdad de números entre TS y Rust es la de JavaScript

**Ambigüedad.** JSON no distingue `2` de `2.0`. En TypeScript todo número es un `f64` y
`JSON.stringify(2.0)` da `"2"`; en Rust, un `f64` con valor `2.0` se serializa como `2.0`.
Un `"dpr": 2` en una fixture hace fallar un round-trip byte a byte del lado Rust sin que
haya ninguna divergencia real de contrato.

**Decisión.** El test de round-trip de Rust normaliza todo flotante de valor entero a entero
antes de comparar (`normalize()` en `crates/qua-protocol/tests/fixtures.rs`). Es la misma
semántica numérica que tiene JavaScript, que es la fuente de verdad.

**Por qué.** La alternativa —tipar como enteros todo campo que en las fixtures aparece sin
parte decimal— mentiría sobre el dominio: `dpr` es 1, 2 o 2.5 según el monitor, y los `rect`
en CSS píxeles son fraccionarios seguido.

### D-06 · El manifiesto de fixtures está duplicado a propósito

`packages/protocol/src/fixtures.ts` y `crates/qua-protocol/tests/fixtures.rs` listan la misma
tabla de fixtures. Un test en Rust (`el_manifiesto_cubre_todas_las_fixtures_del_repo`)
compara el manifiesto contra el contenido real de `fixtures/`, así que agregar una fixture y
olvidarse de un manifiesto rompe el build.

**Por qué duplicado y no generado.** Un manifiesto generado desde TS obligaría al build de
Rust a correr Node. El costo de la duplicación es una línea por fixture; el costo de acoplar
los toolchains lo paga cada tarea, todos los días.

### D-07 · Triggers de FTS5 en el esquema SQLite

**Ambigüedad.** §03 declara `CREATE VIRTUAL TABLE issues_fts USING fts5(text, content=issues,
content_rowid=rowid)` y nada más.

**Decisión.** Se agregan los tres triggers (`AFTER INSERT`, `AFTER DELETE`, `AFTER UPDATE`)
que mantienen el índice.

**Por qué.** Una tabla FTS5 con `content=` es un índice sobre una tabla externa y **no se
puebla sola**: sin triggers, `qua_issues_search` (§10) devolvería cero resultados siempre.
No es una decisión de diseño, es lo que hace falta para que lo que dice la spec funcione.

### D-08 · Alcance de los stubs

`packages/{source-resolver,babel-plugin-source,vite-plugin-source}`, `extension/`,
`crates/{quad,qua-mcp}` y todo `crates/qua-core` salvo `store/` quedan como stubs que
compilan y cuyo `test` pasa trivialmente. Cada uno tiene un comentario de cabecera que dice
qué tarea lo implementa.

**Por qué.** §14 asigna esas piezas a otras tareas. F0 solo tiene que dejar el esqueleto en
pie para que `pnpm test` y `cargo test --workspace` sean verdes desde el commit uno, que es
lo que permite que las ocho tareas de la ola 1 arranquen sin pisarse.

---

## B1 · Daemon: servidor, ingesta y store

### D-09 · `tab_switch`, `tab_close` y `mark` no los dispara el content script

**Ambigüedad.** D-01 dice que el criterio real de A1 es "emitir 17 de los 18 tipos desde
el content script" (todo salvo `audio_gap`). Pero mirando §03 y §5.1/§5.3 con más cuidado:

- `tab_switch` nace de `chrome.tabs.onActivated` y `tab_close` de `chrome.tabs.onRemoved`
  — ninguna de las dos API existe dentro de un content script inyectado en la página. Solo
  el service worker (A2) puede escucharlas.
- `mark` lo dispara el hotkey (`chrome.commands`, §05 manifest) o el botón del popup — los
  dos viven en contextos de extensión que tampoco son el content script.

**Decisión.** El content script (A1) instala hooks/listeners/observers/hover para 14 tipos
que sí puede detectar directamente sobre el DOM de la página (`nav`, `click`, `hover`,
`focus_change`, `input`, `submit`, `scroll_settle`, `viewport`, `console`, `net_fail`,
`net_slow`, `long_task`, `layout_shift`, `mutation_burst`), más `mark` mediante un relay:
escucha un mensaje del service worker (`chrome.runtime.onMessage`, tipo `qua:mark`) y
construye el evento con su propio reloj — así viaja en el mismo lote que el resto de los
eventos de esa pestaña en vez de que el service worker tenga que inyectarlo aparte. Para
`tab_switch`/`tab_close`, que el content script genuinamente no puede disparar, se dejan
builders puros (`extension/entrypoints/content/lib/tab-events.ts`) para que A2 los use con
el mismo reloj y quede documentado el contrato — pero A2 es quien los llama de verdad desde
`chrome.tabs.onActivated`/`onRemoved`.

**Por qué.** No hay forma de hacer que un content script escuche `chrome.tabs.*` sin
otorgarle permisos y arquitectura que la spec pone explícitamente en el service worker
(§5.3, "Ciclo de pestañas"). Forzarlo sería inventar una API que Chrome no tiene.

**Consecuencia.** El criterio de aceptación verificable *dentro del alcance de A1* es 15
tipos (14 detectados + `mark` vía relay) disparados de punta a punta, más `tab_switch`/
`tab_close` pasando por el mismo `emit()` validado vía sus builders — 17 tipos en total
tocan el pipeline de A1, aunque dos de ellos esperan que A2 los dispare en producción. El
test de `extension/entrypoints/content/test/content-script.test.ts` cubre exactamente eso.
Si esto no te convence como resolución de D-01, es una tarea de dos líneas: A2 revisa que
sus triggers de `chrome.tabs` usen `buildTabSwitchEvent`/`buildTabCloseEvent`.

### D-10 · El build de `@qua/protocol` no coincide con su propio `package.json`

**Bug de F0, no de A1 — se reporta, no se corrige acá (regla de "nadie toca
`packages/protocol` fuera de F0").**

`packages/protocol/tsconfig.json` usa `rootDir: "."` (para poder compilar `scripts/` y
`test/` bajo el mismo `outDir`), así que `tsc -b` deja el JS real en `dist/src/index.js`.
Pero `package.json` declara `"main": "./dist/index.js"` y `"exports"` apunta a lo mismo —
un archivo que nunca se genera. Nadie lo notó porque los propios tests de `packages/protocol`
importan por ruta relativa (`../src/...`), nunca como `@qua/protocol` desde otro paquete del
workspace — A1 es la primera tarea que consume el paquete así.

**Workaround en A1 (sin tocar `packages/protocol`):** `extension/tsconfig.json` (`paths`) y
`extension/vitest.config.ts` (`resolve.alias`) resuelven `@qua/protocol` directo contra
`packages/protocol/src/index.ts` en vez de `dist/`. Sigue siendo el mismo código fuente, solo
cambia de dónde se lee — el día que se arregle el `rootDir`/`exports` de `packages/protocol`,
estos dos alias se pueden borrar sin que A1 tenga que cambiar ni una línea de sus imports.

**Arreglo real sugerido para quien lo aplique en F0/G1:** en
`packages/protocol/tsconfig.json`, o separar `scripts`/`test` a su propio `tsconfig`
(`rootDir: "src"` para el build de la librería), o cambiar `main`/`exports` a
`./dist/src/index.js`. Cualquiera de las dos cierra la brecha.

### D-B1-01 · `POST /pair/start` no está en la spec, pero hace falta

**Ambigüedad.** §04 dice "la app Tauri abre una ventana de pairing de 60 s y muestra un
código de 6 dígitos", pero la lista de mensajes de §04 no tiene ningún endpoint para que
el daemon *genere* ese código — solo existe `POST /pair` para consumirlo.

**Decisión.** Se agrega `POST /pair/start` (sin body), que genera el código, abre la
ventana de 60 s en memoria y devuelve `{code, expires_in_ms}`. `POST /pair` la valida y
la consume (un solo uso, correcto o no — así no se puede fuerza-bruta un código de 6
dígitos contra la misma ventana).

**Por qué.** La app Tauri (C1) todavía no existe. Alguien tiene que poder disparar el
inicio del pairing para probar el flujo — un test, `qua doctor`, o eventualmente C1. Sin
este endpoint, `POST /pair` no tendría contra qué validar el código.

**Si C1 necesita otra forma de arrancarlo** (por ejemplo vía stdio en vez de HTTP), lo
reporta y se ajusta acá — el contrato de `PairRequest`/`PairResponse` de `qua-protocol`
no cambia.

### D-B1-02 · El `mark` de nivel de mensaje se persiste fuera de banda, con `source: popup`

**Ambigüedad.** §04 tiene dos caminos para un marcador: el evento `Event::Mark` (con
`source: hotkey | popup`) dentro de un lote `events`, y el mensaje suelto
`{v,type:"mark",t}` sin `seq` ni `source`. La spec no dice cómo conviven.

**Decisión.** El mensaje suelto `mark` se interpreta como el marcador manual del popup
(`MarkSource::Popup`) — el del hotkey global ya llega como `Event::Mark{source:hotkey}`
adentro de un lote `events`, emitido por el content script. El servidor lo escribe en
`raw/events.ndjson` fuera de banda (sin ocupar un `seq` de cliente, ver
`RawEventLog::append_out_of_band` en `qua-core`) y fuerza un `sync()` inmediato, tal
como pide "`mark` ... fuerza flush inmediato".

**Por qué.** Si el mark tomara un `seq` propio (por ejemplo `last_written_seq + 1`),
competiría con la numeración que el outbox de la extensión ya usa para sus lotes de
`events`, y un lote de cliente legítimo con ese mismo número quedaría descartado como
falso duplicado. Mantenerlo fuera de esa numeración es lo único seguro.

### D-B1-03 · `git: None` siempre — B1 no resuelve el repo del proyecto

**Ambigüedad.** `Session.git` (§03) requiere branch/sha/dirty del repo del proyecto, que
supone resolver `base_url` contra `[[projects]].repo` y correr git sobre ese path.

**Decisión.** B1 sí resuelve `project` (label + repo) contra `config.toml` — es un
`match` de string, sin dependencias nuevas — pero deja `git: None` siempre. Ningún
criterio de aceptación de B1 (§14) menciona git, y agregar `git2` como dependencia solo
para esto infla el build de un daemon que tiene que arrancar rápido.

**Por qué.** Es un enriquecimiento, no algo de lo que dependa la durabilidad ni el
criterio de "ingesta sin pérdida / recover". Queda para quien construya el paso de
render (B4) o un C1 que ya tenga que shellear git para otra cosa.

### D-B1-04 · `session.stop` responde `session.done` sin correr ASR/correlate/render

**Contexto.** B1 no implementa VAD, whisper, el correlador ni el renderer (fuera de
alcance explícito de la tarea). Pero §04 sí le pide al daemon responder
`session.done` cuando llega `session.stop`.

**Decisión.** B1 responde `session.done` igual, con `issues: 0` siempre y `report_path`
apuntando a la ruta donde *debería* quedar `report.md` (aunque B4 todavía no lo genera).
`Session.status` queda en `"processing"` (nunca `"ready"`) y `utterances`/`issues` salen
vacíos en `session.json`. `qua-core::ingest::pipeline` deja los traits `AsrPipeline`,
`Correlator` y `Renderer` como las interfaces que B2/B3/B4 implementan sobre ese mismo
`session.json`, sin tocar el servidor.

**Por qué.** El criterio de aceptación de B1 es ingesta + durabilidad + recover, no un
pipeline completo. Inventar un estado `"ready"` con 0 issues mentiría sobre que la
sesión se procesó; `"processing"` es honesto y es justo lo que B2→B3→B4 tienen que
completar.

### D-B1-05 · `qua` vive como segundo binario en `crates/quad/`, no en un crate propio

**Ambigüedad.** §13 solo lista `crates/{qua-protocol,qua-core,quad,qua-mcp}` — no hay un
crate para el CLI `qua` de §6.2, aunque la tabla de comandos (`qua sessions`, `qua show`,
`qua recover`, ...) claramente es un binario distinto de `quad` (el servidor).

**Decisión.** `qua` se agrega como un segundo `[[bin]]` de `crates/quad/` (vía
`src/bin/qua.rs`, autodescubierto por Cargo), no como un crate nuevo. B1 solo implementa
`qua recover <id>` (el criterio de aceptación) y un `qua doctor` mínimo (`GET /health`);
`sessions`, `show`, `reprocess`, `refine`, `export` quedan como stubs que imprimen qué
tarea los completa.

**Por qué.** El CLI y el servidor comparten `config.rs` y el store de `qua-core` — vive
en el mismo crate para reusar ese código sin duplicarlo ni promoverlo a una lib
intermedia que nadie pidió. Si B4 (que sí necesita `show`/`export`/`reprocess`
completos) prefiere partirlo en un crate propio, lo reporta y se mueve; no es un cambio
de contrato de red, solo de layout.

### D-B1-06 · El ack es acumulativo por ciclo de fsync, no por mensaje

**Ambigüedad/riesgo.** §04 dice "`ack seq:12`" pero no explicita cuándo exactamente
tiene que salir un ack respecto del fsync de 2s que menciona la resiliencia.

**Decisión.** El daemon **nunca** ackea un lote antes de que su fsync haya terminado.
`RawEventLog::sync()` es lo único que puede mover `last_synced_seq`, y el timer
periódico (cada `[daemon].fsync_interval_ms`, default 2000 como dice §04) es lo único
que llama a `sync()` y dispara el `Ack` correspondiente — nunca se manda un ack
"inline" al procesar un `events`.

**Por qué.** Es la única forma de que la garantía de crash-safety sea real: si el daemon
ackeara antes del fsync y crasheara entre medio, la extensión ya habría borrado esos
eventos de su outbox (§04: "se borran al recibir ack") y esos datos se perderían para
siempre. `qua-core::ingest::raw_log` tiene tests que cubren esto (incluido que un
`append_out_of_band`, ver D-B1-02, no invente acks que no le corresponden).

### D-B1-07 · `fsync_interval_ms` es un umbral de `config.toml`, no una constante

**Decisión.** El período de fsync de 2s de §04 vive en `[daemon].fsync_interval_ms`
(default 2000), no hardcodeado en el servidor.

**Por qué.** La regla general del proyecto ("umbrales van a config.toml, nunca
hardcodeados") aplica acá tanto como al correlador — y en la práctica hizo falta de
inmediato: el test de "100k eventos sin pérdida" lo baja a 40ms para no tardar minutos
esperando acks reales de a 2s.

### D-B1-08 · `audio.opus` vía `ffmpeg` shell-out, con fallback silencioso a `raw/audio.pcm`

**Ambigüedad.** §04 solo especifica que el audio crudo llega como PCM por WS y se
guarda en `raw/audio.pcm`. Pero `Session.audio.path` (§03) y el layout de archivos
(§8.2) muestran `audio.opus` como el artefacto final de una sesión — y no hay ningún
mensaje en el protocolo que suba un archivo opus ya codificado desde el navegador.

**Decisión.** Al recibir `session.stop`, B1 shellea `ffmpeg` (verificado en el
toolchain, STATE.md) para transcodificar `raw/audio.pcm` → `audio.opus` en el
directorio de la sesión, best-effort: si `ffmpeg` no está o falla, `session.json`
apunta a `raw/audio.pcm` en vez de fallar la sesión entera.

**Por qué.** Es la única lectura que cierra el círculo entre "el WS solo manda PCM" y
"el archivo final es opus" sin inventar un mensaje de protocolo nuevo. No es parte de
ningún criterio de aceptación de B1, así que el fallback nunca puede tirar abajo
`session.stop`.

### D-B1-09 · `qua recover` sin `raw/meta.json` falla explícitamente

**Contexto.** `raw/meta.json` (que trae `t0_wall`, `base_url`, `env`) recién se escribe
al procesar `session.start` — no en `hello`, que es cuando se crea el directorio.

**Decisión.** Si el proceso muere entre `hello` y `session.start`, `qua recover <id>`
falla con un error explícito en vez de inventar un `session.json` con campos vacíos o
inventados.

**Por qué.** `t0_wall` y `env` son requeridos por el esquema de `Session` (§03, no son
`Option`) — no hay un valor "vacío" honesto para ellos. Fallar es preferible a escribir
un `session.json` con datos inventados que después alguien (B3, B4, un humano) toma
como reales.
