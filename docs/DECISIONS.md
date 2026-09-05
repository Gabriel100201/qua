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

## A2 · Service worker

### A2-01 · `seq` del outbox es por sesión, no global — se resetea al arrancar

**Ambigüedad.** §04 dice "`seq` es monótono creciente por sesión". El outbox vive en una
IndexedDB de la extensión que persiste entre sesiones (y entre reciclados del service
worker), así que había que elegir: contador global para siempre, o contador que arranca de
nuevo en cada sesión.

**Decisión.** `SessionManager.start()` llama a `outbox.reset()` (vacía lotes y el contador de
`nextSeq`) antes de abrir el WS. Cada sesión nueva manda su primer lote con `seq=1`.

**Por qué.** Es lo que dice la prosa del §04, y es lo que espera el daemon: `session_dir` es
por sesión, y un `seq` que seguiera creciendo entre sesiones no le compraría nada a nadie del
lado del daemon (que ni se entera de sesiones previas).

**Consecuencia (no resuelta).** Si el usuario para una sesión mientras el daemon sigue caído
y quedan lotes sin ackear, ese `reset()` los descarta al arrancar la siguiente sesión — se
pierden. El criterio de A2 (§14) es sobre una caída *en el medio* de una sesión, no sobre un
`stop()` mientras está caído; ese caso límite queda afuera y lo puede recuperar señalar B1.

### A2-02 · Al reconectar, el cliente reenvía `session.start` con el mismo `t0_wall`

**Ambigüedad.** §04 no dice qué manda el cliente cuando el WS se cae y reconecta a mitad de
una grabación. El daemon exige `hello` → `session.start` antes de aceptar `events` (código
`no_session`), pero una conexión nueva no tiene forma de saber que ya hubo un
`session.start` en la conexión anterior.

**Decisión.** `WsClient` guarda el `session.start` original y lo reenvía completo (mismo
`t0_wall`, mismo `base_url`, mismo `env`) cada vez que un `hello.ok` confirma una conexión —
la primera vez y en cada reconexión — antes de hacer el replay del outbox.

**Por qué.** Es la única forma de que `events` no rebote con `no_session` tras una
reconexión, dado el protocolo actual (no hay un mensaje "resume").

**Riesgo para B1.** Asume que el daemon trata un `session.start` repetido con el mismo
`t0_wall` como "seguí grabando en el `session_dir` que ya tenías", no como una sesión nueva.
Si B1 lo implementa creando una sesión nueva por cada `session.start`, una reconexión
partiría el `report.md` en dos. Falta un mensaje explícito de "resume" en el protocolo —
reportado, no implementado (packages/protocol está congelado fuera de F0).

### A2-03 · Contrato interno `chrome.runtime` (content script / popup ↔ service worker)

`extension/entrypoints/background/internal-messages.ts` define un `ToBackgroundMessage` con
los tipos `qua:events`, `qua:mark`, `qua:start-session`, `qua:stop-session`,
`qua:get-status`. Esto **no** es parte de `@qua/protocol` (que es solo extensión ↔ daemon,
§04): es mensajería interna de `chrome.runtime` que A2 tuvo que inventar porque el service
worker necesita algo contra qué reaccionar.

**Por qué documentarlo.** A1 (content script) y A3 (popup/options) trabajan en paralelo sin
ver este código. Si cada una define su propio contrato de mensajería con el service worker,
G1 (integración) tiene que reconciliar tres protocolos internos distintos. Que converjan acá
antes de esa instancia ahorra ese trabajo.

### A2-04 · BUG en `packages/protocol`: `exports`/`main`/`types` no coinciden con la salida real del build

**Hallazgo, no decisión — no se tocó `packages/protocol` (está fuera de alcance).**

`packages/protocol/package.json` declara `"types": "./dist/index.d.ts"` y
`"exports"["."]` apuntando a `./dist/index.d.ts` / `./dist/index.js`. Pero su
`tsconfig.json` tiene `"include": ["src/**/*.ts", "scripts/**/*.ts", "test/**/*.ts"]` sin
`rootDir` acotado a `src`, así que `tsc -b` calcula la raíz común de todo lo incluido y emite
a `dist/src/index.js` / `dist/src/index.d.ts` — un nivel más adentro de lo que el
`package.json` promete. Cualquier consumidor externo (Node o un bundler resolviendo por
`exports`) que haga `import "@qua/protocol"` después de `pnpm run build` se encuentra con
`ERR_MODULE_NOT_FOUND` / `Cannot find module`.

**Repro:** `cd packages/protocol && pnpm run build && node -e "require('@qua/protocol')"`
(o el equivalente ESM) — falla. `ls dist/` muestra `src/`, `scripts/`, `test/`, no `index.js`
en la raíz.

**Por qué no lo arreglé yo:** la regla de esta ola es no tocar `packages/protocol`.
Corregirlo es trivial (separar el `tsconfig` del build de tipos del de tests/scripts, con
`rootDir: "src"`, o ajustar `exports` a `./dist/src/index.js`), pero es un cambio de
contrato/build de F0 y hay tareas paralelas que también van a pisarlo si lo toco a mano.

**Workaround aplicado en A2 (extension/):** `extension/tsconfig.json` tiene un `paths` que
resuelve `@qua/protocol` directo contra `../packages/protocol/src/index.ts`, y
`extension/vitest.config.ts` tiene el alias equivalente para Vite/Vitest. Los dos están
marcados como temporales en un comentario: hay que borrarlos en cuanto se corrija el
`exports` de la package. Si D1 (servidor MCP) o cualquier otro consumidor TS de
`@qua/protocol` pisa este mismo error, este es el motivo.

### A2-05 · `chrome.tabs.onActivated` no manda la pestaña de origen

`TabTracker` arma el campo `from` de `tab_switch` con la última pestaña activa que vio él
mismo (`activeTabId` en memoria), no con algo que venga de la API — `chrome.tabs.onActivated`
solo manda `{tabId, windowId}`. Documentado acá porque no es obvio leyendo solo la spec (§03
solo dice "`from`, `to`, `url`") y alguien podría asumir que Chrome lo da gratis.

**Consecuencia.** Tras un reciclado del service worker, se pierde el `activeTabId` en
memoria: el primer `tab_switch` después de un reciclado sale con `from: null` aunque hubiera
una pestaña activa previa. Es aceptable — es la misma pérdida de precisión que ya acepta D-02
para sesiones a medio grabar.

## B2 · Daemon: audio y ASR

### D-09 · El VAD segmenta en ventanas de 32 ms, no de 30 ms

**Ambigüedad.** §06.1 dice "VAD silero, ventanas de 30 ms".

**Decisión.** Se usan ventanas de 512 muestras a 16 kHz = 32 ms.

**Por qué.** El crate `voice_activity_detector` envuelve el modelo silero v5, y ese
modelo **exige** `chunk_size = 512` a 16 kHz — es una restricción dura del propio modelo
ONNX (`VadConfigError` si se pide otra cosa), no un parámetro que el crate deje elegir.
30 ms no es un múltiplo entero de muestras a 16 kHz (480 muestras = 30 ms exactos, pero
ese tamaño no es uno de los dos que el modelo acepta: 256 @ 8kHz u 512 @ 16kHz). La
diferencia con la spec es redondeo del modelo upstream, no una decisión de diseño de B2.

### D-10 · Los tests corren contra `ggml-base`, no `ggml-large-v3-turbo-q5_0`

**Ambigüedad.** §14 no dice qué modelo usar en el test de aceptación, y el propio
criterio de B2 anticipa el problema: "Si la descarga del modelo es muy lenta, testeá con
ggml-base y dejalo anotado."

**Decisión.** El test de integración (`crates/qua-core/tests/asr_pipeline.rs`) usa
`ggml-base` (~148 MB, baja en ~30s). El default de producción en `AsrConfig` sigue
siendo `large-v3-turbo-q5_0` (~574 MB), tal cual pide §06.1 — el test solo apunta
`ensure_model` a otro `ModelSpec`, el camino de descarga/verificación es el mismo.

**Por qué.** 574 MB en cada `cargo test` (y en cada corrida de CI, que no tiene caché
entre runs para `~/.qua/models`) es demasiado. La calidad de transcripción baja con
`base` — se ve en el propio output del test: transcribe "hover" como "hago ver" — pero
alcanza para probar que el pipeline entero funciona y que el priming del prompt ayuda
("sidebar" y "componente" sí salen bien gracias al `vocab.txt`). Queda anotado para quien
retome esto: correr el mismo test apuntado a `LARGE_V3_TURBO_Q5_0` da mejor WER, pero es
una corrida manual, no parte de la suite por defecto.

### D-11 · El WAV de la fixture es voz sintetizada, no una grabación humana

**Ambigüedad.** El criterio de B2 pide "un WAV corto en español commiteado en
fixtures/audio/", pero el entorno de esta tarea no tiene micrófono ni una grabación de
Gabriel a mano.

**Decisión.** `fixtures/audio/es-hover-sidebar.wav` se generó con
`say -v Mónica "El botón de nuevo turno no responde cuando hago hover en el sidebar del
componente Agendi." -o sample.aiff` (TTS en español de macOS) y se bajó a 16 kHz mono
con `ffmpeg -ar 16000 -ac 1`. La frase incluye a propósito vocabulario técnico de
`vocab.txt` ("hover", "sidebar", "componente") para poder verificar que el priming del
prompt de §06.1 hace lo que promete.

**Por qué.** Es habla real (voz humana sintética, no un tono ni ruido), en español, y
whisper la transcribe con un WER razonable — cumple el espíritu del criterio ("que
produzca una Utterance con timestamps por palabra") sin depender de que exista una
grabación previa. Si Gabriel quiere reemplazarla por una grabación suya real, el test de
`crates/qua-core/tests/asr_pipeline.rs` no necesita cambios: solo lee el WAV de
`fixtures/audio/`.

### D-12 · Las palabras se arman agrupando tokens por espacio inicial

**Ambigüedad.** El protocolo pide `Utterance.words: [{w, t, d, p}]`, pero whisper.cpp (y
por lo tanto `whisper-rs`) no tiene un concepto nativo de "palabra": solo expone
timestamps por **token** (subpalabras BPE) vía `token_timestamps`.

**Decisión.** Se agrupan tokens consecutivos en una palabra hasta que aparece un token
que arranca con un espacio — es la misma heurística que usa el propio CLI de
whisper.cpp para `--word-timestamps`/`--split-on-word` río arriba. `t`/`d` de la palabra
salen del `t0` del primer token y el `t1` del último; `p` es el mínimo de las
probabilidades de sus tokens (el token más débil de la palabra).

**Por qué.** Es la única señal que expone la librería; inventar otra heurística
divergiría del comportamiento de referencia de whisper.cpp sin ninguna ventaja.

### D-13 · `avg_logprob` se calcula a mano, promediando `plog` por token

**Ambigüedad.** El protocolo pide `Utterance.avg_logprob`, pero `whisper-rs` no expone
un getter de log-probabilidad a nivel de segmento (a diferencia de la librería Python de
OpenAI, que sí lo calcula).

**Decisión.** Se promedia `token_data().plog` de todos los tokens no especiales de la
utterance. `no_speech_prob` sí es nativo (`segment.no_speech_probability()`) y se
promedia entre segmentos si whisper partió el audio en más de uno.

**Por qué.** Es exactamente el cálculo que hace `whisper.cpp`/Python internamente para
ese campo (promedio de log-probabilidades de token); reproducirlo a mano en Rust da el
mismo número sin depender de una API que el binding no expone.

### D-14 · `AsrConfig` lee solo la tabla `[asr]` de `config.toml`, no el archivo entero

**Ambigüedad.** §13 muestra un `~/.qua/config.toml` con secciones de todo el daemon
(`[daemon]`, `[asr]`, `[capture]`, `[correlator]`, `[[projects]]`), pero B2 solo es dueño
de `[asr]`.

**Decisión.** `AsrConfig::load` deserializa un struct que solo tiene el campo `asr`, y
serde ignora las demás tablas del archivo por default (no hay
`deny_unknown_fields`). Si el archivo no existe todavía, devuelve
`AsrConfig::default()` sin error — un daemon recién instalado no tiene por qué tener
`~/.qua/config.toml`.

**Por qué.** El resto del schema de `config.toml` (pairing, capture, correlador,
proyectos) es de B1/B3/C1. Que B2 posea un tipo que ignora esas tablas evita un choque de
"dueño del archivo" entre tareas de la misma ola — cada una lee lo suyo del mismo
archivo sin tener que coordinarse.

### D-15 · `--asr-workers N` queda como campo de config, no como pool real de hilos

**Ambigüedad.** §06.1 menciona `--asr-workers N` para máquinas lentas, pero el diagrama
del pipeline dice "1 worker whisper" a secas, y la DECISIÓN del propio §06.1 aclara que
un `WhisperContext` no es thread-safe para inferencia paralela.

**Decisión.** `AsrConfig.workers` existe como campo tuneable, y `run_whisper_worker`
consume la cola en un solo hilo con un solo `WhisperContext`, tal cual el diagrama. No se
implementó el fan-out a N workers (que requeriría un receptor compartible, p. ej.
`Arc<Mutex<Receiver<PendingSegment>>>`, más N `WhisperContext` independientes).

**Por qué.** El entregable de B2 es el pipeline correcto de principio a fin; cablear el
flag de CLI a un pool de hilos es una decisión de cómo arranca el proceso (`quad`/CLI),
no del módulo de ASR en sí. Se deja anotado para quien conecte `qua doctor`/el arranque
del daemon: `run_whisper_worker` ya es reentrante (toma su propio `WhisperWorker` y su
propio extremo de la cola), así que levantar N de estos en N hilos con un
`Arc<Mutex<Receiver>>` alcanza.

### D-16 · CI necesita `cmake` + `libclang-dev` en el runner de Rust

**Contexto, no ambigüedad.** `whisper-rs-sys` compila whisper.cpp con `cmake` y genera
bindings con `bindgen`, que a su vez necesita `libclang`. `ubuntu-latest` no lo trae
instalado por default.

**Decisión.** Se agregó un paso `apt-get install -y cmake libclang-dev` al job `rust` de
`.github/workflows/ci.yml`, antes de `cargo fmt`/`clippy`/`test`.

**Por qué.** Sin esto, `cargo build` del workspace entero rompe en cualquier corredor
que no tenga esas herramientas — no es opcional para que B2 compile en CI.

**Costo que queda anotado, no resuelto.** El test de integración de B2 baja
`ggml-base` (~148 MB) de Hugging Face en cada corrida de CI porque el runner es efímero
y no hay caché configurado para `~/.qua/models` (`Swatinem/rust-cache` solo cubre
`target/` y el registro de cargo). Si esto molesta en la práctica, la solución es cachear
ese directorio por hash del modelo — no se hizo acá para no tocar más de lo que hace
falta al workflow compartido.
