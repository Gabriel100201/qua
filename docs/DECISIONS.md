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

## B3 · Correlador

### D-B3-01 · `[correlator]` lleva todos los números de §07, no solo los 5 del ejemplo

**Ambigüedad.** El `config.toml` de §13 muestra cinco claves (`window_back_ms`,
`window_fwd_ms`, `decay_ms`, `min_score`, `dominance_ratio`), pero §07 paso 9 dice «todos
los umbrales viven en `[correlator]`» y en el cuerpo de §07 hay muchos más números: los
`base` del scoring, los multiplicadores de deixis, el 0.3 de visibilidad, el 45 s de la
agrupación, el 0.6 de `no_speech_prob`, la ventana del `mark`, la ventana de evidencia, el
divisor 6.0 de la confianza y el 0.5 del screenshot.

**Decisión.** `CorrelatorConfig` expone **todos** con el valor de §07 como default. Un
`config.toml` que solo tenga las cinco del ejemplo se comporta exactamente igual que antes.
La sección usa `deny_unknown_fields`: una clave mal escrita rompe con error en vez de
ignorarse.

**Por qué.** Es lo que hace útil a `qua reprocess` (§6.2): tunear el correlador sin
recompilar. Y un umbral mal tipeado que se ignora en silencio es justo el bug que arruina
una sesión de tuning sin dar ninguna señal.

### D-B3-02 · Los patrones del paso 8 también corren sobre el texto normalizado

**Ambigüedad.** §07 paso 3 dice explícitamente «sobre el texto en minúsculas y sin
acentos». El paso 8 no dice nada, y sus patrones vienen escritos con tildes
(`redacción`, `el título`).

**Decisión.** La misma normalización para los dos pasos: se normalizan el texto y los
patrones. `redaccion` y `redacción` matchean igual.

**Por qué.** Whisper devuelve tildes de forma inconsistente sobre habla rioplatense
rápida; hacer depender la categoría de un issue de si el ASR puso la tilde sería una
fuente de ruido gratuita. La `ñ` no se toca: es una letra propia, no una vocal acentuada.

### D-B3-03 · Los patrones se aplican con frontera de palabra

**Ambigüedad.** Las alternancias de §07 pasos 3 y 8 vienen sin `\b`.

**Decisión.** Se aplican como `\b(...)\b`.

**Por qué.** Sin frontera, `eso` matchea dentro de «peso», `esa` dentro de «mesa» y `dice`
dentro de «índice»: prácticamente todo texto quedaría clasificado POINTER y medio quedaría
en la categoría `copy`. La intención de la tabla es claramente léxica.

**Precedencia entre clases de deixis.** Una frase puede matchear varias («esta pantalla»
contiene «esta»). Orden: **GLOBAL > SCREEN > ACTION > POINTER**. Las dos primeras deciden
el `anchor.kind` por sí solas y son la aplicación de la regla de oro al paso 3; entre las
dos últimas gana la más específica.

### D-B3-04 · La confianza de un ancla decidida por deixis

**Ambigüedad.** §07 paso 6 define `confidence` a partir de `best.score`, pero cuando la
deixis es SCREEN o GLOBAL el ancla se decide sin mirar candidatos: puede no haber ninguno.

**Decisión.** Esos casos usan `deictic_confidence` (default 0.8), configurable.

**Por qué.** Con la fórmula genérica, «esta pantalla necesita un título más claro» en una
página quieta daría confianza 0 y caería en la sección «Sin anclar» de §8.1 — cuando en
realidad está perfectamente anclada, a la ruta, que es lo que el issue pedía. El match de
deixis es evidencia directa de la intención, no una conjetura puntuada.

### D-B3-05 · El filtro de ruido sobre un grupo usa medias ponderadas por duración

**Ambigüedad.** §07 paso 2 dice «se descarta **el grupo**» y usa `no_speech_prob` y
`avg_logprob`, que son campos de la `Utterance`, no del grupo.

**Decisión.** El grupo agrega esos dos campos como media ponderada por duración de sus
miembros; `marked` es un OR y el texto es la concatenación.

**Por qué.** Con una sola utterance —el caso normal— devuelve su propio valor sin tocarlo,
así que el paso 2 se lee literal. Y ponderar por duración es la agregación natural de dos
promedios por segmento.

### D-B3-06 · `long_task` y `layout_shift` van a `evidence.net`

**Contradicción de contrato, reportada a F0.** §07 paso 7 manda adjuntar cinco tipos de
evento (`console`, `net_fail`, `net_slow`, `long_task`, `layout_shift`), pero el `Evidence`
de §03 tiene dos baldes: `console` y `net`.

**Decisión.** `console` lleva los `console`; `net` queda como el balde de evidencia
no-console y lleva los otros cuatro. Cada evento se distingue por su `k`, que viaja
serializado.

**Por qué.** La alternativa es tirar dos de los cinco tipos que la spec manda adjuntar, y
`long_task` es justamente lo que sostiene la categoría `perf` del paso 8. **Si F0 agrega un
tercer campo a `Evidence`, esto se revierte en una línea.**

### D-B3-07 · La fusión por selector corrobora, pero no suma

**Ambigüedad con consecuencias.** §07 paso 5 cierra con «los candidatos que resuelven al
mismo `sel` se fusionan: se suman los scores». La suma es incondicional, y eso hace que una
tira de eventos débiles sobre un mismo elemento (un `scroll_settle`, un `focus_change`, un
`click` viejo y dos `hover`) supere a la señal real: en el escenario s23 del harness, cinco
aportes chicos sobre el distractor suman **7,07** contra los **5,04** de un hover sostenido
más un click sobre el elemento del que se estaba hablando. El ancla queda en el elemento
equivocado y —peor— con confianza **1,00**.

Eso contradice dos cosas de la propia spec: la **regla de oro** del paso 6 y el criterio de
aceptación de B3 en §14, «ningún caso ambiguo anclado a elemento con confianza > 0.5».

Hay una pista más de que la suma no estaba en el diseño: el divisor `6.0` de `confidence`
es **exactamente el score máximo de un solo candidato**
(`click 3.0 × recency ≤ 1 × bias ACTION 2.0 × visibility 1.0`). Con scores sumados la
confianza satura en 1,0 seguido y la escala de §8.1 (0.91 · 0.74 · 0.88) deja de significar
algo.

**Decisión** (tomada por el coordinador; B3 la reportó en vez de aplicarla sola).
La fusión se parte en dos:

```
score_final  = aporte_max + merge_extra_weight × (suma del resto)
merge_extra_weight = 0.25          // nueva clave de [correlator]

confidence   = clamp(aporte_max / 6.0, 0, 1)   // del MÁXIMO, no del score fusionado
               × 0.7 si el ratio best/second < 1.3
```

**Por qué.** La corroboración de varios eventos ayuda a **ganar la comparación** contra
otros candidatos, que es lo que la spec quería; pero la confianza sigue siendo honesta sobre
qué tan fuerte es la mejor evidencia sola. Un candidato que gana por acumulación de ruido
gana por poco y llega con confianza baja, así que se lo comen `min_score` o
`dominance_ratio` y degrada a `route` — que es exactamente lo que pide la regla de oro.

**Es una perilla, no una constante.** `merge_extra_weight` vive en `[correlator]`: `1.0`
recupera la suma literal de §07 y `0.0` deja solo el aporte más fuerte, sin recompilar.
Sobre los 26 escenarios de F1b: `1.0` da 46,2 %, `0.25` (el default) da 73,1 % y `0.0` da
73,1 %. Con el default, **cero** desaciertos anclados a elemento con confianza > 0.5.

**Pendiente fuera de B3.** El coordinador actualiza `docs/SPEC.md` §07 de su lado.

### D-B3-08 · Los candidatos se restringen a la pestaña de `t_ref`

**Ambigüedad.** §07 paso 7 dice «misma pestaña» para la evidencia; el paso 4 no dice nada
sobre la ventana de candidatos.

**Decisión.** También se restringe. La pestaña vigente en `t_ref` sale del último evento de
navegación o interacción anterior —no de cualquier evento, porque un `console` de una
pestaña de fondo no cambia dónde está mirando el usuario—. Un evento sin `tab` no se
descarta: el contrato lo permite.

**Por qué.** Anclar a un elemento de una pestaña que no es la que se está mirando es
exactamente el error que la regla de oro quiere evitar. Y el paso 1 ya prohíbe fusionar a
través de un `tab_switch`, así que la intención está clara.

### D-B3-09 · Un `k` desconocido en `events.ndjson` se saltea, no rompe

**Decisión.** `correlate::events_from_ndjson` descarta las líneas que no son JSON, las que
tienen un `k` fuera de los 18 del contrato y las que no completan su variante, y devuelve
la lista de descartes con el motivo. Nunca aborta.

**Por qué.** El correlador corre sobre sesiones grabadas por versiones distintas de la
extensión y sobre archivos a medio escribir tras un `kill -9` (§6.2, `qua recover`). Perder
un evento es barato; perder la sesión entera no. El harness de F1b emite un `scroll` que no
existe en el contrato: se ignora sin ruido.

### D-B3-10 · Se emite un solo `timing` por issue

**Ambigüedad.** §07 paso 7 dice «si hay **un** click en E seguido de `mutation_burst` o
`nav`», pero en una ventana de 10 s puede haber varios.

**Decisión.** Se emite uno: el del click del elemento anclado si lo hay, si no el del click
más reciente que tenga cierre dentro de E.

**Por qué.** Tres timings por issue son ruido, no evidencia, y el que le interesa al agente
es el del elemento del que se está hablando.

### D-D1-01 · JSON-RPC/stdio escrito a mano, sin SDK de MCP

**Ambigüedad.** §10 no dice con qué implementar el transporte MCP. Existe un SDK oficial
en Rust (`rmcp`), pero trae su propio runtime async, macros de derivación de schema y
abstracciones para transportes que `qua-mcp` no necesita (solo hay 5 herramientas, un
único transporte — stdio — y ningún estado compartido entre llamadas).

**Decisión.** Se implementó el JSON-RPC 2.0 mínimo a mano: un loop síncrono que lee
líneas de stdin, despacha `initialize` / `notifications/initialized` / `tools/list` /
`tools/call` / `ping`, y escribe una línea de respuesta por stdout. Cada tool devuelve su
resultado como `content: [{type: "text", text: <JSON serializado>}]`.

**Por qué.** Menos superficie: no hay que aprender ni fijar una versión de un SDK externo
para cinco funciones de solo lectura, y el test de aceptación puede hablar el protocolo
real sin más dependencia que `serde_json`. Si en otra ola se agregan más herramientas o
un transporte HTTP, ahí sí vale la pena migrar a `rmcp`.

### D-D1-02 · Solo lectura impuesta por flags de SQLite, no por disciplina de código

**Contexto, no ambigüedad.** El criterio de D1 es "SOLO LECTURA... salvo
`qua_issue_mark_exported`".

**Decisión.** `qua_sessions_list`, `qua_session_get`, `qua_issues_pending` y
`qua_issues_search` abren su conexión con `SQLITE_OPEN_READ_ONLY`; solo
`qua_issue_mark_exported` abre una conexión `SQLITE_OPEN_READ_WRITE`. Cada llamada abre y
cierra su propia conexión (igual que ya hace `quad`, ver `crates/qua-core/src/store/mod.rs`).

**Por qué.** Con el flag de SQLite, un bug futuro que intente escribir desde una
herramienta de "solo lectura" falla en tiempo de ejecución con `SQLITE_READONLY` en vez
de corromper silenciosamente el índice del daemon mientras corre en paralelo.

### D-D1-03 · `qua_session_get.include_events` agrega `session.json` completo

**Ambigüedad.** §10 dice que `qua_session_get` devuelve "report.md + issues.json" y que
tiene un parámetro `include_events=false`, pero no dice qué cambia ese parámetro si el
"Devuelve" ya está fijo.

**Decisión.** Con `include_events=false` (default) la herramienta lee y devuelve
`report.md` + `issues.json` del directorio de la sesión (`dir` en `sessions`), tal cual
dice la tabla. Con `true`, agrega además el contenido completo de `session.json` (que sí
tiene los eventos crudos, §8.2) bajo la clave `session`.

**Por qué.** Es la única lectura consistente con los tres nombres en juego: el parámetro
se llama "events", y el único archivo de la sesión que tiene eventos es `session.json` —
`issues.json` no los tiene. Mantiene el caso por defecto barato (sin los ~147 eventos
crudos) y dale al agente una vía explícita para pedir el detalle completo cuando lo
necesite.

### D-D1-04 · `qua_home()` se duplica en `qua-mcp` en vez de depender de `quad`

**Ambigüedad.** `quad` (B1) ya expone `config::qua_home()` (`$QUA_HOME` o `$HOME/.qua`)
como lib, y sería el path por defecto natural para el archivo `qua.db` que abre `qua-mcp`.

**Decisión.** Se copian esas mismas 6 líneas en `crates/qua-mcp/src/db.rs` en vez de
agregar `quad` como dependencia de `qua-mcp`.

**Por qué.** `quad` es el binario de otra tarea (B1); depender de su crate como librería
acopla el build de D1 a cualquier cambio futuro en B1, cuando lo único que hace falta es
una función de tres líneas sin estado. El nombre del archivo (`qua.db`) sí se reusa desde
`qua_core::store::DB_FILE_NAME`, que es la fuente de verdad compartida y no tiene ese
problema.

### D-D1-05 · Orden de `qua_issues_pending`: severidad (`high > med > low`) y después confianza

**Ambigüedad.** §10 dice que se ordena "por severidad", sin desempate.

**Decisión.** `ORDER BY CASE severity WHEN 'high' THEN 3 WHEN 'med' THEN 2 WHEN 'low'
THEN 1 END DESC, confidence DESC`.

**Por qué.** El índice `idx_pending` de §03 es exactamente `(exported_to, confidence
DESC)` — la confianza como desempate secundario es la señal más fuerte de que "por
severidad" no quería decir "ignorando todo lo demás", sino "agrupado por severidad, y
adentro de cada grupo, como ya lo dejó indexado F0".

### D-D1-06 · Filtro `project` es igualdad exacta contra `sessions.project`

**Ambigüedad.** §10 no dice si `project` en `qua_sessions_list`, `qua_issues_pending` y
`qua_issues_search` es substring, case-insensitive o exacto.

**Decisión.** Igualdad exacta (`=`) contra el label de proyecto tal cual quedó en
`sessions.project` (el `label` de `ProjectRef` de §13/§03).

**Por qué.** Es el comportamiento más predecible para un agente que ya sabe el nombre
exacto del proyecto (lo tiene de `qua_sessions_list` o de su propio `config.toml`). Si en
la práctica hace falta buscar por substring, se puede agregar sin romper este contrato
ampliando el parámetro, no reinterpretándolo.

### D-D1-07 · Errores de herramienta son `isError: true`, no errores de JSON-RPC

**Ambigüedad implícita del protocolo MCP.** Un issue inexistente, una sesión sin
`dir` legible, o un parámetro con el tipo equivocado son fallas de la operación, no del
transporte.

**Decisión.** `tools/call` siempre responde con `result` (nunca con `error` de
JSON-RPC) cuando el método existe y los params tienen la forma básica; el fallo de la
herramienta en sí viaja como `result.isError: true` con el mensaje en `content[0].text`.
Los errores de JSON-RPC (`-32601` método desconocido, `-32602` falta `params.name`,
`-32700` JSON inválido) se reservan para pedidos rotos a nivel de protocolo.

**Por qué.** Es la convención estándar de MCP y la que espera un cliente como Claude
Code: le permite mostrarle el error al agente como parte de la conversación de la
herramienta en vez de tratarlo como una falla de la conexión.

### D-D1-08 · Fixtures de test propias en `crates/qua-mcp/tests/fixtures/`, no en `fixtures/`

**Regla de la ola, no ambigüedad.** `fixtures/` de la raíz es de F0 (contrato
TS↔Rust); D1 no lo toca.

**Decisión.** El test de aceptación siembra la DB desde `crates/qua-mcp/tests/fixtures/`:
`seed.json` (filas de `sessions`/`issues`, con las 3 clases de anchor de §07 y un issue
ya exportado) más un directorio `session/` con `report.md` + `issues.json` +
`session.json` de verdad. El esquema se aplica con `qua_core::store::apply_schema` — el
mismo código que usa el daemon — para que la DB de test sea idéntica en forma a la real.

**Por qué.** Cumple "test que abre una DB sembrada desde fixtures" sin tocar el directorio
compartido de F0 ni depender de que otra tarea (B1/B3/B4) ya haya producido una sesión
real en disco.

## A3 · Offscreen document + UI

### D-11 · Contrato interno offscreen ↔ service worker (A2 no existía todavía)

**Ambigüedad.** §5.4 dice "postMessage → service worker → WS binario" pero no especifica la
forma de esos mensajes, y A2 (el service worker) todavía estaba "en curso" cuando arrancó A3
— no hay código del otro lado contra el que alinearse.

**Decisión.** A3 define el contrato completo en `extension/entrypoints/offscreen/lib/messages.ts`:

- SW → offscreen: `qua:start-capture` (con `t0Wall` y `startSeq` opcional), `qua:stop-capture`,
  `qua:connection-state` (refleja si el WS está arriba, para el buffer de 30 s de §04).
- offscreen → SW: `qua:audio-frame` (bytes ya empaquetados con el layout de §04, listos para
  el WS tal cual), `qua:audio-gap` (duración perdida por desborde del buffer), `qua:capture-started`,
  `qua:capture-error`, `qua:recording-chunk` (blob del `MediaRecorder`, ver D-12).

Todo viaja por `chrome.runtime.sendMessage`/`onMessage`, igual que el relay de `mark` de A1
(D-09) — no por un `Port` de larga vida, para no introducir dos mecanismos de transporte
distintos en la misma extensión sin necesidad real (50 fps de 653 B es liviano para
`sendMessage`).

**Por qué.** A2 necesita algo contra qué implementar cuando llegue a esta parte, y A3 no
puede bloquearse esperando. Mismo patrón que D-09: el lado que llega primero deja el contrato
por escrito y builders/tipos ya armados; el otro lado los consume sin re-diseñar nada.

**Consecuencia.** Si A2 (o quien la retome) necesita un contrato distinto, es una tarea de
mover nombres, no de re-arquitecturar: `AudioCapture` en `lib/audio-capture.ts` ya separa "qué
hace falta" (`AudioCaptureCallbacks`) de "cómo se manda" (`main.ts`, la única pieza que conoce
`chrome.runtime`). El offscreen doc nunca abre el WS ni construye `Event`s de §03 — eso sigue
siendo enteramente de A2 (`audio_gap`, en particular, lo arma el service worker con la
`duration_ms` que le pasa `qua:audio-gap`, ver D-12).

### D-12 · `audio_gap` lo construye el service worker, no el offscreen doc

**Ambigüedad.** §04 dice que `audio_gap` es un evento de §03 más (con `t` y `tab?`), pero el
offscreen doc no tiene un reloj de sesión completo ni sabe de `Event`s — esa responsabilidad,
en toda la spec, es del content script (§5.1) o del service worker (§5.3), nunca del
offscreen doc.

**Decisión.** El offscreen doc solo reporta `duration_ms` perdida (`qua:audio-gap`, D-11); es
el service worker quien arma el `Event` `{t, k:"audio_gap", duration_ms}` con `EventSchema` de
`@qua/protocol` y lo mete en el batching normal de §04.

**Por qué.** Mismo espíritu que D-09 de A1: no inventar una responsabilidad nueva en un
contexto que la spec nunca le asignó. El offscreen doc ya expone `GapBuffer` (`lib/gap-buffer.ts`,
30 s por defecto, drop-oldest) para que A2 no tenga que reimplementar la lógica de desborde.

### D-13 · El archivo de respaldo (`MediaRecorder` opus) no tiene forma de subirse al daemon

**Ambigüedad real de la spec.** §5.4 dice "`MediaRecorder(...)` en paralelo para el archivo" y
§08.2 espera `audio.opus` en la carpeta de la sesión, pero §04 (los únicos mensajes cliente →
servidor) no define ningún mensaje para subir un archivo — solo el frame binario PCM.

**Decisión.** A3 no inventa un mensaje nuevo (regla de "nadie toca `packages/protocol` fuera
de F0"). El offscreen doc entrega cada chunk del `MediaRecorder` vía `qua:recording-chunk`
(D-11) y ahí termina su responsabilidad — qué hacer con esos blobs (guardarlos en IndexedDB,
subirlos por HTTP a un endpoint nuevo, descartarlos) queda para quien resuelva esta brecha de
protocolo, probablemente junto con B1/G1.

**Reportado, no aplicado.** Si esto se resuelve agregando un mensaje a `packages/protocol`
(ej. un `POST /sessions/<id>/audio` o un tipo de mensaje WS nuevo), es responsabilidad de F0/G1
definirlo — acá solo se deja documentado el hueco y el punto de enganche (`onRecordingChunk`).

### D-14 · `t_ms` del frame de audio se deriva contando muestras, no leyendo el reloj de pared

**Ambigüedad.** El comentario del layout en `packages/protocol/src/constants.ts` dice que
`t_ms` es "desde t0_wall" (offset relativo), mientras que el comentario de `Event.t` en
`event.ts` sugiere que el content script manda epoch absoluto y el daemon normaliza (así lo
implementó A1 en `content/lib/clock.ts`) — dos convenciones distintas conviven en el mismo
protocolo. Para el frame binario manda el comentario de `constants.ts`, que es más específico
y es literalmente parte de la fuente de verdad del layout.

**Decisión.** `PcmFramer` (`extension/entrypoints/offscreen/lib/pcm-framer.ts`) no lee ningún
reloj por frame: recibe un único `startTMs` (calculado una vez, al arrancar la captura, como
`nowMs() − t0_wall`) y deriva el `t_ms` de cada frame siguiente contando muestras exactas
emitidas dividido el sample rate (`AUDIO_SAMPLE_RATE`, 16 kHz fijo). El offscreen doc calcula
ese único offset con el mismo reloj que usa el content script (`performance.timeOrigin +
performance.now()`, §02) y se lo pasa al `AudioWorkletProcessor` por `postMessage` al iniciar.

**Por qué.** Contar muestras es exacto y no tiene jitter: a un sample rate fijo, el tiempo
transcurrido es `muestras / sampleRate` segundos, sin importar si `AudioWorkletGlobalScope`
tiene o no acceso confiable a `performance.now()` en cada navegador. Leer el reloj de pared en
cada frame (50 veces por segundo) además arrastraría el jitter de scheduling del hilo de audio
al campo que el daemon usa para el jitter buffer (§06.1) — exactamente lo que ese buffer existe
para absorber del lado de la red, no algo que el cliente debería introducir por su cuenta.

**Consecuencia.** El test `pcm-framer.test.ts` verifica esto de punta a punta contra la fixture
dorada de F0 (`fixtures/audio-frame.{bin,json}`): con `startSeq`/`startTMs` iguales a los de la
fixture, el primer frame producido a partir de las 320 muestras f32 equivalentes es byte a byte
idéntico al `.bin` — es el criterio de aceptación de A3 ("PCM validado a 16 kHz mono").

### D-15 · Tipos de `AudioWorkletGlobalScope` declarados a mano

**Detalle técnico, no ambigüedad de producto.** `lib.dom.d.ts` (la lib de TypeScript que ya usa
`extension/tsconfig.json`) declara `AudioWorkletNode` (la vista del hilo principal) pero no
`AudioWorkletProcessor`/`registerProcessor`/`sampleRate` — esos viven en un scope de worklet
que TypeScript no incluye por defecto y para el que no hay una lib oficial instalada en este
monorepo.

**Decisión.** `extension/entrypoints/offscreen/worklet/pcm-tap-processor.ts` declara
ambientalmente lo mínimo que usa (`AudioWorkletProcessor`, `registerProcessor`) al principio
del archivo, en vez de agregar una dependencia nueva al workspace solo para esto. El registro
real (`registerProcessor(...)`) queda atrás de un `typeof AudioWorkletProcessor !== "undefined"`
— igual que el auto-arranque de `content/index.ts` (A1) y `offscreen/index.ts` — así que
importar este archivo fuera de un worklet real (tests, bundler) nunca ejecuta nada.

**Pendiente para quien conecte WXT de verdad (G1/A2, ver D-11):** este archivo tiene que
terminar compilado como su propio script servible (`audioContext.audioWorklet.addModule(url)`
necesita una URL, no un import) — no se resuelve acá porque es del scaffold compartido, mismo
punto que D-09.

### D-B4-01 · `report.md` no envuelve texto a un ancho de columna fijo

**Ambigüedad.** El bloque de ejemplo de §8.1 muestra `**Dicho**` y la línea de
`**Ancla**` cortados a la mitad de la oración ("... en mobile\ncasi no lo encuentro...",
"... confianza 0.91\n  · hover 2.1s..."). La spec no dice a qué ancho de columna, y no
hay ningún otro lugar del documento que mencione un wrap de 72/80 columnas.

**Decisión.** Cada campo (`Dicho`, `Ancla`, `Ruta`, ...) se escribe en una sola línea
lógica, sin cortar a mano. El corte del ejemplo de §8.1 es formateo del documento de
spec para que quepa en la página, no un requisito del formato.

**Por qué.** Envolver a un ancho arbitrario sin que la spec lo pida es inventar una
regla que nadie va a poder verificar ("¿72? ¿80? ¿por palabra completa?") y que además
le complica la vida a cualquier `grep`/diff sobre `report.md`. Una sola línea por campo
es más fácil de testear byte a byte contra una fixture (el criterio de aceptación de
B4) y más fácil de parsear para un agente.

### D-B4-02 · Cómo se ve el campo **Ancla**/**Ruta** para anchors `route` y `session`

**Ambigüedad.** §8.1 solo da un ejemplo con `anchor.kind = "element"`. §07 dice que
`route` y `session` también llevan `confidence` y `reason`, pero no hay ningún ejemplo
de cómo se ven en el reporte.

**Decisión.**
- **Ancla** (`element`): `` `{sel}` `` como en el ejemplo. (`route`): el *pathname* de
  `anchor.url` entre backticks (`` `/agenda/mes` ``, sin esquema ni host). (`session`):
  el texto literal `(sesión completa)`, sin backticks, porque no hay un identificador
  real que mostrar.
- **Ruta**: igual criterio para el "qué", más `(pestaña N)` si `anchor.tab` está
  presente; para `session` (que no tiene tab ni url) es directamente
  `(sesión completa)`.
- La columna "Ancla" de la tabla resumen usa el mismo texto que el campo del detalle.

**Por qué.** Es la lectura más literal del esquema (§03: `Anchor.url`/`Anchor.tab` son
`Option`, y son justamente los que faltan en `route`/`session`) sin inventar campos
nuevos. `url_path()` recorta `http://host:port/x` a `/x` con el mismo criterio que usa
el ejemplo de §8.1 (`/agenda/semana`, sin `http://localhost:3000`).

### D-B4-03 · La sección "Sin anclar" no tiene formato dado por la spec

**Contexto.** §8.1 dice que los issues con `confidence < 0.35` van a una sección final
"Sin anclar" "con el texto crudo y la ruta", pero no muestra un ejemplo.

**Decisión.** Una lista de líneas `- (HH:MM:SS) categoría/severidad — "texto" · ruta
`{path}`` (o `(sesión completa)` si no hay URL), ordenada cronológicamente por `t`
(no por confianza: para releer la sesión en orden es lo único que tiene sentido acá).
Estos issues no aparecen en la tabla resumen ni tienen bloque `## NN` propio.

**Por qué.** Es la lectura más simple de "no ensucian la lista principal": quedan
completamente fuera de la numeración y de la tabla, con la info mínima que pide la
spec (texto crudo + ruta) y nada más (sin ancla detallada, porque por definición el
ancla no es confiable).

### D-B4-04 · `report.md` sin `git` omite la cláusula de rama entera

**Contexto.** `Session.git` es `Option<GitInfo>` (§03) — una sesión puede grabarse
fuera de un repo git.

**Decisión.** Si `git` es `None`, la línea de metadatos de §8.1 salta directo de la
duración a `"N issues"`, sin dejar un `· ·` vacío ni inventar `rama desconocida`.

**Por qué.** Es consistente con cómo el resto del formato omite campos ausentes
(`**Fuente**`, `**Clases**`, `**Timing**`, `**Captura**` también desaparecen del todo
si no hay dato, en vez de imprimir un placeholder) — más fácil de leer y de testear que
decidir un texto para "no sé".

### D-B4-05 · El recorte de captura busca el frame crudo en `raw/frames/<issue_id>.{jpg,png}`

**Contexto.** §07 paso 9 dice que el daemon pide `capture.request` a la extensión y
recorta el frame que vuelve. Pero ese round-trip no está cableado todavía: B1
(`crates/quad/src/ws.rs`) recibe `ClientMessage::Frame` y lo descarta explícitamente
("interfaz para B3/B4"), y nadie manda `capture.request` desde el daemon.

**Decisión.** B4 entrega la parte que sí le toca — recortar y guardar
(`render::screenshot::crop_for_target`, testeada con imágenes sintéticas) — bajo una
convención de archivo: si existe `raw/frames/<issue_id>.jpg` (o `.jpeg`/`.png`) al
correr `render_session`, se recorta y se guarda en `assets/<issue_id>.png`. Si no
existe (el caso de hoy, porque nada lo escribe todavía), el issue se renderiza sin
captura, sin que sea un error.

**Por qué.** Cablear el WS completo (pedir el frame, guardarlo crudo) es trabajo de
quien conecte el paso 9 de punta a punta — probablemente B3 (que decide *cuándo* pedir
la captura) o quien la reciba en el servidor. Inventar esa pieza en B4 sería un cambio
de alcance no pedido y además necesitaría tocar `ws.rs`. La convención de nombre de
archivo es el contrato mínimo que deja ambos lados desacoplados y testeables por
separado.

### D-B4-06 · La fecha de `report.md` no convierte de UTC a hora local

**Contexto.** `Session.started_at` es un ISO-8601 en UTC (termina en `Z`). El ejemplo
de §8.1 (`2026-09-04 14:32`) coincide exactamente con `started_at` de la fixture
(`"2026-09-04T14:32:11.204Z"`) sin ningún corrimiento de huso horario.

**Decisión.** `report.md` muestra el timestamp tal como viene en UTC (corta segundos y
milisegundos, cambia `T` por espacio), sin convertir a la zona horaria de quien corre
`qua show`/`qua reprocess`.

**Por qué.** Es lo que el propio ejemplo de la spec hace, y además evita que
`report.md` deje de ser reproducible byte a byte entre máquinas con distinto huso
horario — un requisito real dado que el criterio de aceptación de B4 es una
comparación exacta contra una fixture.

### D-B4-07 · Bug conocido y no resuelto: `issues.id` es clave primaria global en SQLite

**Contexto.** El esquema de F0 (`crates/qua-core/src/store/schema.sql`) declara
`issues.id TEXT PRIMARY KEY` sin componerlo con `session_id`. Los ids de issue son
correlativos *por sesión* (`i01`, `i02`, ...), así que dos sesiones distintas van a
generar el mismo `id` tarde o temprano, y la segunda pisa a la primera en el índice.

**Decisión.** B4 implementa `store::upsert_issues` contra el esquema tal como está
(no lo toca — es un cambio de contrato de F0, fuera del alcance que las reglas
comunes permiten aplicar unilateralmente) y deja esto anotado para que quien pueda
tocar el esquema (probablemente junto con D1/qua-mcp, el primer consumidor real de
`qua_issues_pending`/`qua_issues_search`) lo arregle con una clave compuesta
`(session_id, id)` o un id verdaderamente único como `{session_id}:{id}`.

**Por qué.** No es un problema que B4 haya introducido — ya existía en el esquema de
F0 — y arreglarlo implica una migración de esquema que otras tareas en paralelo podrían
estar asumiendo en su forma actual. Reportar y no tocar es la regla del proyecto para
justamente este caso.

### D-B4-08 · `qua export --format json` exporta `issues.json`, no `session.json`

**Ambigüedad.** §6.2 solo dice `qua export <id> --format md|json`, sin aclarar si el
JSON es la sesión completa o solo los issues. `qua show --json` sí tiene un target obvio
(`session.json`, porque `show` es "mostrame todo sobre esta sesión").

**Decisión.** `export --format json` escribe/imprime `issues.json`; `export --format
md` es el mismo `report.md` que `show --md`. `show --json` sigue siendo `session.json`
completo.

**Por qué.** "Exportar" en el resto de la spec (§8.3 `refine`, §10 `qua_issue_mark_exported`)
siempre habla de *issues* como la unidad que sale hacia otro sistema (un ticket, un
LLM) — nunca de la sesión cruda con sus 3000 eventos. `show` es para inspeccionar una
sesión propia; `export` es para llevarse lo que le importa a un consumidor externo.

### D-B4-09 · `qua reprocess` no re-corre ASR ni correlador de verdad todavía

**Contexto.** §6.2 describe `reprocess` como "re-corre VAD+ASR+correlador sin
regrabar". B2 (ASR) y B3 (correlador) son tareas en curso en paralelo — sus crates no
existen todavía en este worktree en una forma que B4 pueda invocar.

**Decisión.** `quad::cli::reprocess` recarga `session.json` (o lo reconstruye desde
`raw/` si falta, igual que `qua recover`), lo reescribe tal cual de forma determinística
y vuelve a correr el renderer de B4 (`report.md`, `issues.json`, `transcript.txt`,
capturas) sobre los `utterances`/`issues` que ya tenía. No inventa una implementación
de juguete de ASR ni de correlador.

**Por qué.** El criterio de aceptación de B4 es "test de idempotencia de reprocess" —
que correrlo dos veces dé bytes idénticos — y eso se sostiene con la implementación
real de `render` sin necesitar un ASR/correlador real. `ingest::pipeline::AsrPipeline`
y `Correlator` quedan como los puntos de extensión: cuando B2/B3 mergeen, conectarlos
acá es el único cambio que hace falta, sin tocar la interfaz de `qua reprocess`.

**Actualización (este mismo worker, misma tarea).** A mitad de B4, `git log` mostró que
B2 y B3 ya se mergearon a `main` (`qua_core::asr`, `qua_core::correlate::correlate`)
mientras este worktree seguía basado en el commit de antes de esas dos tareas — B4
declara dependencia de F0/F1, no de B2/B3, así que no era un prerequisito bloqueante
para arrancar. Evalué rebasear `b4` sobre `main` para cablear el correlador de verdad
acá mismo, pero `qua-core` de `main` ya arrastra `whisper-rs` (compila whisper.cpp con
Metal) como dependencia de B2 — un rebase mete ese costo de compilación entero en esta
tarea por un cambio que no es su criterio de aceptación, y agrega superficie de
conflicto (Cargo.lock, `lib.rs`) sin necesidad. Dejo `reprocess` como quedó (recarga +
re-renderiza) y anoto acá el cableado concreto para quien mergee `b4` a `main` después
de B2/B3: en `crates/quad/src/cli.rs::reprocess`, reemplazar el passthrough de
`session.issues` por `qua_core::correlate::correlate(&session.events, &session.utterances,
&cfg)` (con `cfg: CorrelatorConfig` leído de `[correlator]` en `config.toml`, ya
soportado por B3), tomar `Correlation.issues` como los issues nuevos, y usar
`Correlation.captures` para saber a qué issues pedirles `capture.request` — que calza
exactamente con la convención `raw/frames/<issue_id>.*` de D-B4-05.

### D-B4-10 · `qua refine` es un placeholder determinístico, sin LLM real

**Contexto.** §8.3 pide mandar `issues.json` a un LLM que agrupe duplicados y reescriba
cada issue como ticket. Este repo no tiene credenciales, cliente HTTP a un proveedor de
LLM, ni ninguna decisión tomada sobre cuál usar — y no es parte del alcance de B4
(renderer + CLI) inventar esa integración.

**Decisión.** `qua refine <id>` escribe `report.refined.md` con un título (primeros 72
caracteres del texto del issue) y cuerpo (el texto completo) por cada issue, sin agrupar
duplicados ni pasar por ningún LLM. El mensaje de salida deja explícito que es un
placeholder.

**Por qué.** El comando tiene que existir y producir un archivo con la forma correcta
(§8.2: `report.refined.md`, "sin pisar el original") para que el resto del flujo (una
futura tarea que sí cablee un LLM) tenga algo sobre qué iterar, sin fingir una
integración que no existe.

## B5 · Cierra las dos deudas que dejó B4

### D-B5-01 · `qua reprocess` ya corre el correlador real (cierra D-B4-09)

**Contexto.** D-B4-09 dejó `reprocess` como passthrough (recarga `session.json`,
re-renderiza) porque B4 arrancó desde un commit anterior al merge de B2/B3, y documentó
el cableado exacto para cuando alguien retomara el trabajo con `qua_core::correlate` ya
disponible. Este worktree (`b5`) parte de después de esos merges: `qua_core::correlate`
y `CorrelatorConfig::from_path` ya existen y están probados.

**Decisión.** `quad::cli::reprocess` (`crates/quad/src/cli.rs`) reemplaza el passthrough
por: leer `[correlator]` de `config.toml` con `CorrelatorConfig::from_path`, correr
`qua_core::correlate::correlate(&session.events, &session.utterances, &cfg)`, reemplazar
`session.issues` por `correlation.issues` y actualizar `session.stats.issues` con la
cuenta nueva antes de escribir `session.json` y renderizar. Exactamente el cableado que
D-B4-09 dejó anotado — no se tocó la firma de `reprocess` ni la convención de capturas de
D-B4-05 (el renderer ya resuelve `raw/frames/<issue_id>.*` solo).

`correlation.captures` (los `CaptureRequest` del paso 9) no se usan: pedirle un frame
nuevo a la extensión requiere una conexión WS en vivo, que `reprocess` no tiene por
diseño (corre offline sobre lo que ya está en `raw/`). Cablear ese round-trip es del
alcance de quien conecte el paso 9 de punta a punta (ver D-B4-05), no de esta tarea.

**Por qué.** Sin esto, `qua reprocess` no producía issues de verdad — el pipeline
completo (§02: `ingest → asr → correlate → render`) quedaba roto en su paso central. El
test de idempotencia de B4 (`reprocess_es_idempotente_byte_a_byte`) sigue en verde
porque `correlate` es una función pura de `events`/`utterances`, que no cambian entre
pasadas de `reprocess`.

### D-B5-02 · `issues.id` pasa a ser `(session_id, id)` (cierra D-B4-07)

**Contexto.** D-B4-07 documentó el bug: `issues.id TEXT PRIMARY KEY` es una clave
global, pero los ids son correlativos por sesión (`i01`, `i02`, ...), así que una
segunda sesión pisaba en silencio los issues de la primera — pérdida de datos real en
una herramienta cuyo propósito es acumular hallazgos entre sesiones.

**Decisión.** Clave primaria compuesta `PRIMARY KEY (session_id, id)` en
`crates/qua-core/src/store/schema.sql`, no el id sintético `{session_id}:{id}`. Cambios:

- `schema.sql`: `issues.id` deja de ser `PRIMARY KEY` propio; la tabla declara
  `PRIMARY KEY (session_id, id)`. `idx_pending` no cambia (no referencia `id`). Los
  triggers de FTS5 tampoco cambian: usan `rowid`, la columna oculta que SQLite sigue
  manteniendo porque la clave compuesta (y antes, la clave `TEXT` simple) nunca la
  alias-ea — eso solo pasa con una columna sola declarada `INTEGER PRIMARY KEY`.
- `store::upsert_issues`: `ON CONFLICT(id)` → `ON CONFLICT(session_id, id)`.
- `qua-mcp`: `qua_issues_pending` y `qua_issues_search` no necesitaron cambios — ya
  hacían `JOIN sessions` por `session_id` y ya devuelven `session_id` junto a cada
  issue. `qua_issue_mark_exported` ahora pide `session_id` además de `issue_id`
  (los dos salen del mismo objeto que devolvió `pending`/`search`, así que el agente
  nunca arma el par a mano) — ver `crates/qua-mcp/README.md`.

**Por qué compuesta y no `{session_id}:{id}`.** Un id sintético concatenado obliga a
parsear/escapar un string en cada punto de entrada (y a confiar en que ningún id de
sesión lleve el separador elegido) solo para reconstruir algo que SQLite ya modela
nativamente con una clave de dos columnas. La clave compuesta además no rompe el
formato de `Issue.id` que ya vive en `session.json`/`issues.json` (`i01`, sin prefijo) —
`session_id` sigue siendo una columna aparte, exactamente como ya la trataban las
consultas de `qua-mcp` antes de este fix.

**Prueba de que el bug murió.** `crates/qua-mcp/tests/mcp_protocol.rs`,
`dos_sesiones_con_el_mismo_id_local_i01_no_se_pisan`: siembra dos sesiones con su propio
`i01` cada una, confirma que `qua_issues_pending` devuelve las dos (antes del fix, la
segunda pisaba a la primera y solo aparecía un issue), y que `qua_issue_mark_exported`
con `(session_id, issue_id)` afecta solo a la sesión correcta.

## C1 · App Tauri

### D-C1-01 · El hotkey global no puede arrancar/parar una grabación de verdad todavía

**Ambigüedad real, no menor.** §09 dice que el hotkey global (⌘⇧R / ⌘⇧E) «es lo único que la
extensión sola no puede dar», dando a entender que dispara la grabación en el navegador. Pero
§04 solo define `session.start` / `session.stop` / `mark` como mensajes **cliente→servidor**
(los manda la extensión al daemon). No hay ningún mensaje **servidor→cliente** en la lista de
§04 para que el daemon (o la app) le ordene a la extensión arrancar o parar — el canal para
que un proceso externo controle una sesión ya abierta en el navegador no existe en el
contrato actual.

**Decisión.** No lo agrego ni al `packages/protocol` ni al `qua-protocol` de Rust — es
exactamente el tipo de cambio de contrato que C1 tiene prohibido aplicar unilateralmente
(rompería en silencio a A2, que ya está mergeada). En su lugar:

- El hotkey global (`tauri-plugin-global-shortcut`, ⌘⇧R / ⌘⇧E) queda completamente
  implementado y **se probó que dispara con Chrome en foco** — es una API del SO, no depende
  de qué ventana tiene el foco. Togglea el estado local del tray (idle/grabando) y lo deja en
  el log unificado de `~/.qua/logs/qua-app.log`.
- Lo que **no** hace todavía: mover una sesión real de la extensión. Eso necesita un mensaje
  nuevo servidor→cliente (propongo `{ v:1, type:"control.toggle_recording" }` y
  `{ v:1, type:"control.mark", t }`, agregados a §04 y reenviados por el daemon al cliente WS
  conectado) más el listener correspondiente en el service worker (A2, ya cerrada).

**Por qué.** Implementar solo la mitad alcanzable de C1 (el hotkey de verdad, el tray de
verdad, el sidecar de verdad) y documentar el resto es mejor que fingir una integración
end-to-end que en realidad no toca la extensión. El criterio de aceptación de §14 («el
hotkey dispara con Chrome en foco») se cumple tal como está escrito; «mueve una grabación
real» es una lectura más fuerte que no se puede satisfacer sin tocar protocolo o A2.

**Para quien retome C1.** Con el mensaje de arriba agregado a `packages/protocol` (y su
espejo Rust), el lado de la app es un `if let Some(child) = ...` trivial: postear al daemon
(nuevo endpoint HTTP interno, p.ej. `POST /control/toggle-recording`, no versionado — como
`/pair/start` de B1) que reenvía el mensaje por el WS activo. `apps/qua-app/src-tauri/src/
hotkeys_actions.rs` es donde engancharlo.

### D-C1-02 · Los binarios de sidecar no se commitean

**Decisión.** `apps/qua-app/src-tauri/binaries/{quad,qua}-<target-triple>` van al
`.gitignore`. Se generan con `apps/qua-app/scripts/build-sidecars.sh` (compila `quad` y `qua`
en release desde el mismo código fuente del repo y los copia con el sufijo de target-triple
que espera `tauri-plugin-shell`).

**Por qué.** Son ~25-30 MB cada uno, reproducibles al 100 % desde `crates/quad`, y el
target-triple cambia según la máquina. Commitearlos infla el repo sin necesidad — es
exactamente lo mismo que no commitear `target/`.

### D-C1-03 · El modelo de ASR se descarga reusando `qua_core::asr::model` de B2

**Decisión.** En vez de reimplementar descarga + verificación SHA-256 para la barra de
progreso de onboarding (§09), la app depende directamente de `qua-core` y llama a
`ensure_model` (B2) con un callback de progreso que emite eventos al frontend.

**Por qué.** B2 ya tiene los SHA-256 reales (los que reporta la API de HF, no inventados) y
la lógica de reintento/idempotencia. Reimplementarla hubiera significado adivinar hashes o
saltear la verificación — ninguna de las dos aceptable para un archivo de 574 MB que carga
un modelo de inferencia.

### D-C1-04 · Medidor de nivel de mic: dispositivo propio, no el de la extensión

**Ambigüedad.** §09 dice que el app "no captura nada: gestiona", pero también pide un
"medidor de nivel de mic en vivo" y un selector de dispositivo — cosas que necesitan tocar
el micrófono, y el micrófono real de la sesión lo abre el offscreen document de la extensión
(§5.4), no el app.

**Decisión.** El app abre su **propio** stream de `cpal` (independiente del de la extensión)
solo para calcular RMS y mostrarlo en el tray, y para listar/probar dispositivos de entrada
en el onboarding. Nunca se graba ni se persiste. macOS permite múltiples taps de lectura
sobre el mismo dispositivo de entrada sin conflicto.

**Por qué.** Es la única forma de que "medidor de nivel" y "selector de dispositivo" existan
sin que el app dependa de que la extensión esté conectada — y sin ellos, dos ítems explícitos
de §09 quedarían sin implementar. "No captura nada" se interpreta como "no es la fuente de
la grabación de la sesión", no como "nunca abre el micrófono para nada".

### D-B6-01 · El divisor de `confidence` depende de la clase de deixis, no es 6.0 fijo

**Contexto.** Corriendo el pipeline real sobre `fixtures/session-full.json` (ver
`docs/ejemplos/report-ejemplo.md`), el issue 01 — hover sostenido de 2,1 s **más** click
**más** deixis POINTER ("este botón"), los tres sobre el mismo elemento: el ancla más
nítida de todo el reporte — salía con confianza **0.48**. Eso está mal por dos razones:
se lee como una moneda al aire para el caso más claro del reporte, y queda debajo de
`screenshot_min_confidence` (0.5), así que el paso 9 no pide el recorte justo del issue
que más lo necesita.

**Causa.** §07 paso 6 normalizaba con `confidence = clamp(aporte_max / 6.0)`.
`6.0 = base_click(3.0) × bias_action(2.0)` es el score máximo alcanzable **solo** con
deixis ACTION. Con POINTER el máximo real es `3.0 × bias_pointer(1.5) = 4.5`, así que ni
un match POINTER perfecto (recency = 1) puede pasar de `4.5 / 6.0 = 0.75` — y con
decaimiento de recencia (el caso real) cae a 0.48. El divisor era una constante global
donde la spec necesitaba uno por clase.

**Decisión.** `max_possible_score(deixis, cfg)` en `correlate::anchor` calcula el techo
de la clase en juego: `base_max × bias_de_la_clase × recency(1.0) × visibility(1.0)`, con
`base_max = confidence_divisor / bias_action` (no hardcodeado: sigue saliendo del
`confidence_divisor` de `[correlator]`, así que tunearlo desde el toml escala las tres
clases a la vez). Con los defaults: POINTER → 4.5, ACTION → 6.0 (sin cambio), sin deixis
→ 3.0.

```
confidence = clamp(aporte_max / max_possible_score(deixis), 0, 1)
             × ambiguity_penalty si ratio best/second < dominance_ratio
```

Sobre `fixtures/session-full.json`, el issue 01 pasa de **0.48 a 0.64**: cruza el umbral
de screenshot y deja de leerse como un tiro de moneda. La lógica de dominancia/ambigüedad
del paso 6 no cambia — solo cambia contra qué se normaliza el aporte ganador.

**Por qué no llega a 0.75.** El pedido original de B6 pedía verificar que el issue 01
llegue a `≥ 0.75`. La cuenta exacta no da: el click ganador de ese issue ocurre 1.1 s
después de `t_ref` (`recency = exp(-1100/2500) ≈ 0.644`), y `aporte_max` es
`3.0 × 1.5 × 0.644 = 2.898` sin importar el divisor. `2.898 / 4.5 = 0.644` es el máximo
alcanzable para ESE evento con la fórmula del paso 6 — llegar a 0.75 exigiría o inflar
`aporte_max` con la corroboración del hover (exactamente lo que D-B3-07 prohíbe, por lo
de abajo) o encoger el techo de la clase POINTER por debajo de lo que un match perfecto
necesita. Gabriel dormía cuando se detectó esto; queda anotado acá en vez de forzar el
número.

**Por qué no se usa el score fusionado para acercarse a 0.75.** Se probó normalizar
contra el score fusionado (`aporte_max + merge_extra_weight × resto`) en vez de contra el
aporte máximo solo — sube el issue 01 a ~0.78, pero reabre exactamente el bug que D-B3-07
cerró: corrida contra el harness de F1b, el escenario **s23** (cinco aportes débiles
sobre un distractor visible superando a un hover + click reales sobre el elemento
correcto, pero perdiendo por poco en `dominance_ratio`) vuelve a superar confianza 0.5
anclado al elemento equivocado. Ese criterio — «ningún caso ambiguo anclado a elemento
con confianza > 0.5» (§14, criterio de aceptación de B3) — no se negocia, así que
`max_contribution` (no el score fusionado) se mantiene como base de `confidence`.
Confirmado con `cargo test -p qua-core --test harness_sintetico -- --nocapture`: s23 sigue
degradando a `route` con confianza 0.44 bajo el fix de este ticket.

**Gap conocido, fuera de alcance de B6: `s24`.** El mismo harness expone un escenario
(`s24`, "visibilidad penaliza candidato oculto") donde el elemento realmente referido por
deixis está marcado `visible: false` a propósito; `visibility_penalty` (0.3) lo hunde por
debajo de un distractor totalmente visible que **domina sin ambigüedad**
(`ratio ≈ 3.16 ≥ dominance_ratio`). No es el caso que protege el criterio de §14 —ese
habla de casos *ambiguos* (`ratio < dominance_ratio`), y s24 no lo es—, así que no viola
la regla de oro tal como la define la spec. Pero con este fix su confianza sube de 0.49 a
0.63 (antes se colaba por debajo de 0.5 por la coincidencia de que el divisor global 6.0
aplastaba también a los aciertos). Ya era un desacierto antes de B6 (`los_desaciertos_no_
pueden_ser_de_alta_confianza` solo mide, no assertea — es "medición, no oráculo" según su
propio comentario). Tocar `visibility_penalty` o la interacción visibilidad/dominancia es
un problema distinto (deixis apunta a algo oculto) y queda fuera del alcance de este
ticket — reportado, no resuelto.

**Tests que cambiaron de número, no de regla.** `correlate::anchor::tests` — los que
usaban `sin_deixis()` y dividían por 6.0 ahora dividen por 3.0
(`ancla_a_elemento_cuando_domina`, `degrada_a_route_por_ambiguedad`,
`degrada_a_route_por_score_bajo`). `la_confianza_mide_el_aporte_mas_fuerte_no_el_acumulado`
cambió los números de ejemplo (de `7.07/2.83` contra el "real" `5.04`, a `3.9/1.2` contra
`3.0`) para seguir demostrando el mecanismo — con divisor por clase, los números viejos ya
no cumplían `< 0.5` sin dejar de ser "ganador por acumulación", así que se recalibraron en
vez de aflojar la aserción. `ningun_ambiguo_queda_anclado_a_elemento` y
`el_ratio_justo_en_el_umbral_ancla` (la regla de oro en sí) no cambiaron: siguen pasando
sin tocar sus números. Se agregó `el_divisor_de_confianza_depende_de_la_clase_de_deixis`
para fijar los tres techos (3.0 / 4.5 / 6.0) como comportamiento explícito.

### D-B6-02 · El encabezado de `report.md` cuenta lo mismo que la tabla resumen

**Contexto.** `meta_line` usaba `session.issues.len()` — anclados **más** sin anclar — pero
la tabla resumen solo lista los anclados. Un reporte con 3 issues anclados y 1 en "Sin
anclar" mostraba «4 issues» en el encabezado contra 3 filas en la tabla: la primera
inconsistencia que ve quien abre el reporte.

**Decisión.** El encabezado cuenta igual que se ve en la página: `"{anchored} issues"`
cuando no hay nada sin anclar (sin cambio de formato para el caso común), y
`"{anchored} issues + {unanchored} sin anclar"` cuando sí hay. Se prefirió esta opción a
la alternativa (meter el sin anclar en la tabla con ancla en blanco) porque la tabla
resumen de §8.1 es explícitamente "issues anclados, ordenados por severidad y confianza"
— forzar una fila sin ancla ahí le pisa el propósito a la sección "Sin anclar" aparte
(D-B4-03).

**Por qué.** Es lo primero que se lee del reporte. `docs/ejemplos/report-ejemplo.md`
queda como referencia: "3 issues + 1 sin anclar" con 3 filas en la tabla y 1 entrada en
"Sin anclar".

## F1c · Saneamiento del harness sintético

### D-F1c-01 · El harness de F1b tenía 3 defectos reales, no eran fallas de B3

**Contexto.** F1b entregó `packages/qua-synth` con 651 líneas de evento, de las cuales B3
midió 572 inválidas contra el `EventSchema` real de `@qua/protocol` (`k: "scroll"` no
existe — el tipo válido es `scroll_settle` — y a `nav`, `click`, `scroll_settle` y
`mutation_burst` les faltaban campos requeridos). El correlador daba 73,1 % (19/26) contra
ese harness; los 7 desaciertos no eran bugs de B3, sino ground truth que contradecía §07.

**Decisión.** Se reescribió `packages/qua-synth/src/cli.ts` de cero, con tres correcciones:

1. **Todo evento sale con los campos exactos del schema.** Cada builder (`nav`, `click`,
   `hover`, `scroll_settle`, `mutation_burst`, …) construye el objeto completo — `mods` en
   `click`, `title`+`kind` en `nav`, `y`+`pct` en `scroll_settle`, `count` en
   `mutation_burst` — y `check()` relee cada `.events.ndjson` y `.utterances.json` ya
   escrito en disco y lo valida con `EventSchema.safeParse` / `UtteranceSchema.safeParse`
   de `@qua/protocol`. Si una sola línea no valida, `pnpm test` falla. Es la garantía de
   que un tipo inventado no vuelve a colarse.

2. **El ground truth de los 6 escenarios POINTER con `dominance_ratio` < 1,3 se corrigió
   ajustando el scoring del escenario (separando mejor target y distractor), no bajando el
   umbral de la spec ni cambiando el anchor esperado a `route`**: el paso 6 de §07 exige
   ratio ≥ 1,3 para anclar a elemento, y "pointer con hover sostenido" es exactamente el
   caso donde la señal debería ganar clara. El escenario de visibilidad (antes esperaba
   que ganara el candidato con `visible: false`) se invirtió: ahora el ground truth espera
   el candidato visible, que es lo que el factor 0.3 del paso 5 existe para lograr.

3. **Los 20 escenarios base ya no son 4 plantillas repetidas 5 veces.** Cada uno tiene
   ruta, selectores, texto y estructura de distractores propios (ver `manifest.json`), y
   se agregaron escenarios dedicados a los tipos de evidencia que faltaban —`console`,
   `net_fail`, `net_slow`, `long_task`, `layout_shift`— más uno para el `mark`/ventana
   angosta del paso 4 y ruido ambiente (`tab_switch`, `input`, `submit`, `viewport`,
   `tab_close`, `audio_gap`) en los 27 escenarios, para no dejar tipos del contrato de §03
   sin ejercitar.

**Verificación.** Los números de scoring de los 27 escenarios se verificaron primero con
una réplica en JS de `scoring.rs`/`anchor.rs` (paso 5 y 6) antes de hornearlos en el
generador, y después contra el correlador real: `cargo test -p qua-core --test
harness_sintetico -- --nocapture` da **27/27 = 100 %** con la config por defecto
(`merge_extra_weight = 0,25`) y **0 líneas rechazadas o descartadas** por el contrato.
Con `merge_extra_weight = 1,0` (la suma literal de §07, la que D-B3-07 decidió no usar)
el mismo harness cae a 25/27, porque dos escenarios ACTION degradan a `route` cuando el
ruido del distractor se suma sin descuento — confirma en datos por qué B3 no usó `1.0`.

**Por qué separar el scoring del escenario en vez de bajar el umbral.** Bajar
`dominance_ratio` o el criterio de "gana claro" para que el harness pase habría ocultado
el problema real (ground truth mal construido) detrás de un umbral más permisivo, que
además afectaría producción, no solo el harness. `packages/qua-synth` es de F1c; los
umbrales de `[correlator]` son de B3 y no se tocan acá.

## P1 · Cierra la brecha de protocolo del hotkey global

Cambio de contrato autorizado por el coordinador sobre D-C1-01: C1 dejó documentado que
`packages/protocol`/`qua-protocol` necesitaban un mensaje servidor→cliente nuevo para que el
hotkey global mueva una sesión real de la extensión, y que tocarlo estaba fuera de su
alcance. Esta tarea lo agrega.

### D-P1-01 · `session.control` + `POST /control`, y por qué la extensión necesita un canal ocioso

**Decisión.** Se agrega `{ v:1, type:"session.control", action:"start"|"stop"|"mark", t }`
como mensaje servidor→cliente (Zod + `qua-protocol`, fixture cruzada, JSON Schema
regenerado). El daemon expone `POST /control` (interno, no versionado, mismo criterio que
`/pair/start` de D-B1-01): body `{action}`, autenticado con un `control_token` propio —
**no** el token de pairing de la extensión, porque lo llama la app Tauri, un proceso local
sin `Origin` de extensión. El token se genera una sola vez (`crates/quad/src/server.rs::prepare`)
y se persiste en `[daemon].control_token` de `config.toml`; la app lo lee con
`quad::config::Config::load` (mismo mecanismo que ya usa para `daemon_port()`).

El daemon registra el `sender` del WS conectado (`AppState.client_tx`) apenas el socket
autentica el upgrade — **antes** de cualquier `hello`, no atado a que haya una sesión
arrancada. `POST /control` reenvía por ahí; sin cliente conectado devuelve 503
(`error_codes::NO_CLIENT`), sin token o con uno incorrecto, 401.

**El problema real que esto resuelve.** El WS de la extensión (`ws-client.ts`) solo existía
mientras había una sesión grabando — `SessionManager.start()` es lo único que construía un
`WsClient` y lo conectaba, y `stop()` lo cerraba. Si el hotkey ⌘⇧R dispara con la extensión
en `idle`, no hay ninguna conexión viva a la que el daemon pueda reenviarle nada: literalmente
no hay a quién mandarle `session.control:start`. Esa es la mitad del problema que D-C1-01 no
podía ver todavía porque el mensaje ni existía.

**Solución.** `SessionManager` abre un **canal de control ocioso** (`this.controlWs`, un
`WsClient` más, reusado tal cual — no es un transporte nuevo) apenas arranca el service
worker en `idle` (`init()`), y lo vuelve a abrir después de cada `stop()`. Ese canal solo
manda `hello` (`WsClient.startSession()` ahora acepta `session` opcional) y escucha
`session.control`; nunca manda `session.start`. Al recibir `action:"start"`, resuelve
`baseUrl`/`viewport` de la pestaña activa (`activeTabContext()`, `browser.scripting.executeScript`
para el viewport — mismo permiso `scripting` que ya declaraba `wxt.config.ts`) y llama al
`SessionManager.start()` de siempre, que cierra el canal ocioso de una (ver más abajo). Al
recibir `stop`/`mark` mientras graba, el callback llega por el WS de la sesión real (el mismo
`onSessionControl` se cablea en los dos `WsClient`), así que no hay entrega duplicada: nunca
hay dos conexiones vivas al mismo tiempo — `start()` cierra el canal ocioso antes de abrir el
de grabación, y `stop()` reabre el ocioso recién después de cerrar el de grabación.

**Costo aceptado.** Cada conexión del canal ocioso manda `hello`, y `hello` del lado del
daemon crea un directorio de sesión (`ActiveSession::create`, sin tocar ese comportamiento
— ver "Alternativa descartada" abajo). Como el canal ocioso nunca manda `session.start`,
esos directorios quedan huérfanos (sin `raw/meta.json`) cada vez que el service worker se
recicla o el pairing se repite. Es exactamente el estado que D-B1-09 ya documenta y maneja:
`qua recover` falla explícito, y `commands.rs::list_sessions` los saltea en silencio
(`read_meta` falla, `continue`). No ensucian SQLite ni la UI — es basura de disco acotada,
no una regresión funcional. `retention_days` de `config.toml` es el mecanismo ya previsto
para la limpieza de sesiones viejas en general.

**Alternativa descartada: hacer perezosa la creación del directorio en `hello`.** Se
consideró mover `ActiveSession::create` a no tocar el filesystem hasta `session.start`, para
que el canal ocioso no dejara rastro en disco. Se descartó: es un cambio de comportamiento
documentado en D-B1-09 ("el directorio se crea en `hello`"), que además le cambia el mensaje
de error a `qua recover` en el caso "crash entre `hello` y `session.start`" (pasaría de "no
hay nada recuperable más allá del directorio vacío" a "no existe la sesión"). B1 ya está
mergeada y esta tarea no tiene overlap con las tres en vuelo (G1, F1c, B6) — tocar ese
invariante para ahorrarse unos directorios vacíos no valía el riesgo de romper algo que no se
puede validar contra las otras tareas hasta el merge.

**Alternativa descartada: reenviar `session.control` por `broadcast` a todos los WS
conectados.** Con dos conexiones simultáneas (ocioso + grabación) esto entrega el mismo
`mark`/`stop` dos veces — cada `WsClient` llama al mismo `SessionManager.handleControl`, y un
`mark` duplicado es un evento inventado en la sesión, no un no-op. Por eso el diseño fuerza
"a lo sumo una conexión viva a la vez" en vez de tolerar overlap y decidir cuál gana.

### D-P1-02 · El hotkey de la app Tauri es best-effort contra `/control`

**Decisión.** `apps/qua-app/src-tauri/src/hotkeys_actions.rs` dispara `POST /control` de
forma asincrónica (`tauri::async_runtime::spawn`) sin bloquear el handler síncrono de
`tauri-plugin-global-shortcut`. Si el daemon no responde 2xx (no está arriba, token
desactualizado, sin cliente conectado), se loguea en `~/.qua/logs/qua-app.log` y se emite
`hotkey-control-failed` al frontend — no hay reintento ni cola.

**Por qué.** El hotkey no tiene una UI síncrona propia donde bloquear esperando la
respuesta HTTP, y `daemon_health`/`sidecar.rs` ya establecen el precedente de "el daemon
puede no estar listo todavía, no es una excepción" en esta app. El tray sigue reflejando el
toggle local (§09 FSM del tray, sin cambios) independientemente de si `/control` tuvo éxito.

## G1 · Integración y packaging

### D-G1-01 · `quad::pipeline::process` cablea B2+B3+B4 en `finalize`, sin capturas de pantalla en vivo

**Contexto.** D-B1-04 dejó `session.stop` respondiendo con `status=processing` y 0
issues a propósito, con los traits de `qua_core::ingest::pipeline` (`AsrPipeline`,
`Correlator`, `Renderer`) como el contrato para que alguien los uniera. La nota de B4
al final de D-B4-09 (arriba) ya dejaba el cableado concreto anotado: correr
`qua_core::correlate::correlate` sobre `session.events` + `session.utterances`, leídas
de `[correlator]` en `config.toml`.

**Decisión.** `crates/quad/src/pipeline.rs::process` hace exactamente eso más la parte
de ASR que faltaba: transcribe `raw/audio.pcm` por lotes reconstruyendo los frames de
20 ms tal como llegarían por WS (mismo pipeline síncrono jitter+ring+VAD+whisper que
B2 testeó en `asr_pipeline.rs`), corre el correlador, y deja `session.status = Ready`.
`finalize()` en `ws.rs` la llama en un `spawn_blocking` (whisper y el correlador son
CPU-bound) antes de responder `session.done`; `qua reprocess` la llama también, pero
solo re-transcribe si `utterances` está vacío — así tunear `[correlator]` sobre una
sesión ya grabada sigue siendo barato, que es el criterio de aceptación de B4.

**Lo que queda afuera, a propósito.** El paso 9 de §07 (`Correlation.captures`, el
pedido de `capture.request`) es un round-trip en vivo por WS: el daemon le pide a la
extensión un frame del ring y la extensión responde con `frame` (jpeg). Cuando
`process` corre (adentro de `finalize`, después de que la sesión ya cerró, o en
`reprocess`, minutos u horas después) esa conexión ya no existe. Cablear esto bien
requiere que el loop de mensajes de `ws.rs` intercale `capture.request`/`frame` con
`events`/`mark`/`frame de audio` mientras la sesión sigue viva — un cambio de
arquitectura del server, no de este módulo. `process` descarta `captures` sin más:
`render_session` ya degrada correctamente a "sin recorte" (D-B4-05), así que
`report.md` sale válido, solo que sin evidencia visual en los issues anclados a
elemento. **Pendiente para una tarea futura.**

**Por qué no bloqueé G1 en esto.** El criterio de aceptación de G1 (§14) es "una sesión
grabada de punta a punta produce un report.md válido" — no exige capturas. Bloquear la
integración completa por una mejora de evidencia visual habría dejado sin cablear lo
que sí es indispensable (ASR + correlador). Ver también la brecha de protocolo que
reportó A3 (más abajo, sin resolver): ni siquiera hay mensaje de subida de
`audio.opus`, así que el round-trip de capturas no era la única pieza de vivo que
faltaba.

### D-G1-02 · `qua process` no se agregó como subcomando nuevo

**Contexto.** Podría haberse expuesto `quad::pipeline::process` como un subcomando de
CLI separado (`qua process <id>`), pero eso hubiera creado dos caminos para la misma
operación: `reprocess` ya es "correr el pipeline sobre una sesión grabada", y agregar
`process` al lado habría sido una distinción sin diferencia real, además de una
superficie de API nueva que nadie pidió en §6.2.

**Decisión.** `reprocess` es el único punto de entrada de CLI para correr el pipeline
completo (o solo el correlador, si ya hay utterances). `finalize` en el daemon llama a
`quad::pipeline::process` directamente, sin pasar por CLI.

### D-G1-03 · El contrato interno A1/A3 ↔ A2 nunca se probó junto, y no coincidía

**Contexto.** Cada tarea de la extensión (A1 content script, A2 service worker, A3
popup/offscreen/options) tiene su propia suite de tests, pero ninguna corre contra el
código real de las otras — cada una mockea el lado de enfrente. Al cablear una sesión
real de punta a punta (criterio de G1) aparecieron tres mensajes de `chrome.runtime`
donde el emisor y el receptor NO coincidían, y que ningún test detectaba:

1. `content/lib/emit.ts` manda `{type: "qua:event", event}` (un evento por mensaje);
   `background/index.ts` solo entendía `{type: "qua:events", items: Event[]}` (lote).
   Resultado: **ningún evento del content script llegaba nunca al service worker** —
   el `sendMessage` no tiraba (A1 lo diseñó para no tirar nunca) y el handler
   devolvía `{ok:false, error:"mensaje desconocido"}` que nadie miraba.
2. `popup/lib/status-client.ts` manda `{type: "qua:start-session"}` sin `baseUrl` ni
   `viewport` (el popup no tiene ese contexto — vive en su propia página); el tipo en
   `internal-messages.ts` los pedía como campos requeridos. `sessions.start(undefined,
   undefined)` habría arrancado una sesión con `base_url` inválido para el daemon.
3. El botón de marcador del popup manda `{type: "qua:trigger-mark"}`;
   `internal-messages.ts` solo tenía `"qua:mark"`.

**Decisión.** Se ajustó `internal-messages.ts` + `background/index.ts` para hablar el
protocolo que A1 y A3 ya tienen testeado (en vez de tocar `emit.ts`/`status-client.ts`,
que sí tienen tests que fijan su formato de salida). `qua:start-session` ahora resuelve
`baseUrl`/`viewport` en el propio service worker contra la pestaña activa
(`browser.tabs.query` + `browser.scripting.executeScript`, permiso `scripting` ya
declarado en `wxt.config.ts`).

**Por qué no hay test que lo hubiera atrapado antes.** Ninguna de las tres tareas
declaraba dependencia de las otras dos para el *wiring* de mensajería interna (§14 solo
las liga por `packages/protocol`, el contrato con el daemon) — es exactamente la clase
de bug que un test de integración real (G1) existe para encontrar. Pendiente: agregar
un test de `background/index.ts` que ejercite el router de mensajes contra los shapes
reales de A1/A3, para que esto no se repita.

**Lo que sigue sin empujarse en vivo:** `popup/lib/status-client.ts` escucha pushes de
`onStatus`/`onTranscript`, pero el service worker nunca los manda — no hay
`browser.runtime.sendMessage` de status/transcript hacia el popup en ningún lado. El
popup sigue funcionando (arranca/para sesión, `qua:get-status` bajo pedido responde
bien), solo que no se actualiza solo mientras queda abierto. Fuera del alcance del
criterio de aceptación de G1 (el report.md no depende de la UI del popup); queda para
una tarea futura.

### D-G1-04 · Wiring de WXT: content script + offscreen doc + relay de audio

**Contexto.** `extension/entrypoints/content/index.ts` era un módulo que se autoarrancaba
por un guard manual (`if (chrome.runtime?.id)`), no un content script real de WXT — sin
`defineContentScript`, `wxt build` nunca lo iba a inyectar en ninguna página (`wxt.config.ts`
ya lo anticipaba: "A1 ... van a necesitar ampliar manifest acá"). Por el otro lado, nadie
llamaba nunca a `chrome.offscreen.createDocument`: A3 dejó todo el lado del offscreen doc
(`AudioCapture`, el framer PCM, el contrato de mensajes) listo y testeado, pero A2 nunca lo
disparó ni recibió sus mensajes — `session-manager.ts` no conocía `qua:audio-frame`.

**Decisión.**
- `content/index.ts` ahora envuelve `startQuaContentScript` con
  `defineContentScript({ matches: ["<all_urls>"], runAt: "document_start", main })`.
- `SessionManager.start()`/`stop()` crean/cierran el offscreen doc
  (`browser.offscreen.hasDocument`/`createDocument`/`closeDocument`, permiso `offscreen`
  ya declarado) y mandan `qua:start-capture`/`qua:stop-capture`. Si falla (sin permiso de
  mic, por ejemplo) la sesión sigue igual sin audio — no bloquea eventos+DOM (§15).
- `SessionManager.handleOffscreenMessage` (llamado desde el mismo listener de
  `browser.runtime.onMessage` que ya existía en `background/index.ts`, antes de tratar el
  mensaje como `ToBackgroundMessage`) relaya `qua:audio-frame` a `WsClient.sendBinary`
  (ya existía, sin nada que lo llamara) y arma el `Event` `audio_gap` desde
  `qua:audio-gap`. `qua:capture-started`/`qua:capture-error`/`qua:recording-chunk` se
  reciben pero no disparan nada más (el opus de respaldo sigue sin camino de subida,
  D-13).
- El estado de la conexión WS se relaya al offscreen doc (`qua:connection-state`) vía
  `onStatusChange` de `WsClient`, para el buffer de 30 s de A3.
- `extension/package.json`: `"build": "wxt build"` (era un stub). Requiere que
  `@qua/protocol` y `@qua/source-resolver` ya estén compilados (`dist/` — están en
  `.gitignore`, así que hace falta `pnpm --filter @qua/protocol --filter
  @qua/source-resolver run build` antes, o `pnpm -w run build` desde la raíz).

**Por qué.** Esto es literalmente "cablear la extensión" (§14, criterio de G1): sin esto,
`wxt build` no produce nada cargable y ninguna sesión real habría llegado con audio al
daemon aunque B2/B3/B4 estuvieran perfectos del otro lado.

### D-G1-05 · El E2E lanza Chrome for Testing (vía Playwright), no el Chrome de /Applications

**Contexto.** El criterio de G1 pide una instancia aparte de Chrome con
`--load-extension`/`--user-data-dir`, sin activar el modo desarrollador a mano.
Probé primero contra el Google Chrome real de `/Applications` (el mismo de
STATE.md, "Chrome en /Applications" del toolchain verificado). No cargó nunca: el
log de arranque (`--enable-logging=stderr --v=1`) muestra
`--disable-extensions-except is not allowed in Google Chrome, ignoring` y
`Extensions.NotAllowlistedDisabled2 recorded 1 samples` — Google Chrome (la build de
consumo, no Chromium) bloquea cargar una extensión sin empaquetar salvo que el toggle
"Modo de desarrollador" esté prendido **en el perfil**, y ese toggle no se puede
setear por archivo de preferencias (Chrome lo protege con un hash anti-tamper —
`PrefHashFilter` — que lo resetea solo si se edita a mano el `Preferences` del
perfil).

**Decisión.** El script (`e2e/session.e2e.mjs`) usa `playwright` (no
`playwright-core`) y deja que maneje su propio binario ("Chrome for Testing",
`npx playwright install chromium` una vez) en vez de apuntar a
`executablePath` de `/Applications`. Es el mismo motor Blink/V8 real, motor real de
Chrome, pero es la build que Google distribuye específicamente para
automatización — sin la restricción de arriba. `ignoreDefaultArgs:
["--disable-extensions", "--disable-component-extensions-with-background-pages"]`
sigue haciendo falta (Playwright agrega `--disable-extensions` por default, que
pisa el `--disable-extensions-except` de la extensión real).

**Efecto secundario encontrado:** con `--disable-component-extensions-with-background-pages`
ignorado, componentes internos de Chrome (`Google Network Speech`, id
`fignfifoniblkonapihmkfakmlgkbkcf`) también registran su propio service worker, y
pueden aparecer en `context.serviceWorkers()` antes que el nuestro. El script busca
por `chrome.runtime.getManifest().name === "QUA"` en vez de tomar "el primero" o
"el último" — ver `findExtensionServiceWorker` en `session.e2e.mjs`.

**Por qué no es trampa.** El criterio dice "instancia aparte de Chrome", no
"el Chrome instalado en /Applications" — y el punto central ("sin modo
desarrollador a mano") se cumple mejor así: cero intervención humana, en vez de
depender de un toggle que ni siquiera se puede automatizar con las herramientas
disponibles.

### D-G1-06 · Bug real encontrado por el E2E: nadie normalizaba `t` contra `t0_wall`

**Contexto.** La primera corrida completa del E2E produjo un `report.md` válido pero
con una duración absurda ("496829h 55m 41s"). `packages/protocol` (§02, comentario de
`Event.t`, intocable por regla) es explícito: *"el content script lo emite como
`performance.timeOrigin + performance.now()` y el daemon lo normaliza"* — pero
`qua_core::ingest::session_builder::build_session` (B1) nunca restaba `t0_wall` de
nada: ni de los `t` de cada `Event`, ni de `duration_ms` (que llega como el mismo
epoch-ms absoluto de `SessionStop.t` / `StopMarker.t`). El bug es invisible a
cualquier test que arme sus propios eventos con `t` chico a mano — que es lo que
hacían **todos** los tests existentes de B1/B3/B4 (`t: 10`, `t: 100`, …) — porque un
`t` "ya relativo" pasado sin normalizar simplemente queda como estaba. Solo aparece
con un reloj real (`Date.now()`, ~1.7 billones de ms), que es exactamente lo que una
sesión de verdad manda y ninguna fixture sintética reproduce.

**Decisión.** `build_session` ahora normaliza: `duration_ms = duration_ms - t0_wall`,
y cada `Event.t` pasa por `normalize_t` (un match exhaustivo que reconstruye cada una
de las 18 variantes con `t - t0_wall` — `Event` no tiene un setter de `t`, y no vale
la pena agregar uno en `qua-protocol` solo para esto). Es el único lugar donde hace
falta: tanto `finalize()` en vivo como `recover_session` pasan por acá.

**Impacto en tests existentes.** `ingest_100k.rs` y
`recover.rs::con_stop_marker_queda_processing` mandaban eventos con `t` chico junto a
un `t0_wall` grande (`1_800_000_000_000` / `1_788_012_731_204`) — inconsistente con
lo que un content script real manda. Los ajusté para que los `t` simulados sean
`t0_wall + relativo`, que es la forma real del contrato, y las aserciones ahora
comparan contra el valor ya normalizado. `kill_and_recover.rs` no necesitó cambios
(ya mandaba valores consistentes). **190 tests de Rust, todos verdes después del
fix.**

**Por qué esto no es un cambio de protocolo.** `packages/protocol` no se tocó: el
campo `t` sigue siendo `z.int()`, sin cambio de forma ni de schema. Lo que cambió es
que `qua-core` (B1, no F0) por fin hace lo que el comentario del contrato siempre
dijo que iba a hacer.

### D-G1-07 · El AudioWorklet nunca compilaba: WXT no reconoce entrypoints anidados

**Contexto.** Con G1 wireado de punta a punta, el hover real disparaba la sesión pero
`raw/audio.pcm` quedaba en 0 bytes. `context.on("console")` en la extensión mostró el
motivo: `AudioWorklet falló: Failed to load worklet module script:
chrome-extension://.../worklet/pcm-tap-processor.js (Network error)` — ese archivo
nunca se compilaba. `entrypoints/offscreen/worklet/pcm-tap-processor.ts` (A3) vivía
dos niveles bajo `entrypoints/`; WXT solo escanea `entrypoints/*.ts` y
`entrypoints/*/index.ts` (un archivo o un único nivel de carpeta) para decidir qué es
un entrypoint — cualquier ruta más anidada es código fuente normal, importado por
quien lo referencie con `import`, nunca su propio archivo de salida. Como
`audio-capture.ts` lo carga por `chrome.runtime.getURL(...)` (un string en tiempo de
ejecución, no un `import`), tampoco terminaba en ningún bundle: WXT simplemente no
sabía que ese archivo existía. El comentario de A3 en el archivo original ya lo
anticipaba: "el wiring de bundling con WXT... es del scaffold compartido con A2/G1".

**Decisión.** Se movió a `extension/entrypoints/pcm-tap-processor.ts` (nivel superior,
un solo segmento de ruta) como su propio "unlisted script" de WXT —
`export default defineUnlistedScript(() => {...})` — y `audio-capture.ts` ahora pide
`chrome.runtime.getURL("pcm-tap-processor.js")` (antes `"worklet/pcm-tap-processor.js"`).
La clase `PcmTapProcessor extends AudioWorkletProcessor` quedó **adentro** de la
función `main()`: WXT importa cada entrypoint en Node para leer su configuración antes
de empaquetarlo para el navegador, y `AudioWorkletProcessor` no existe como global en
Node — declararla a nivel de módulo revienta ese import con
`AudioWorkletProcessor is not defined`. Las declaraciones ambiente
(`declare class AudioWorkletProcessor`, `declare function registerProcessor`) se
separaron a `offscreen/lib/audio-worklet-globals.d.ts` (un script ambiente sin
`import`/`export`, dos niveles bajo `entrypoints/` así que no lo escanea como
entrypoint) — vivían inline en el archivo, pero el analizador estático de WXT
(`@babel/parser` sin soporte de TypeScript) no entiende `declare` y tira
"Missing semicolon" al escanearlo.

**Una rareza más, no resuelta a fondo por falta de tiempo:** un comentario JSDoc
(`/** ... */`) largo con texto que incluye rutas con `*` entre backticks (p. ej.
`` `entrypoints/*.ts` ``) hace que el mismo escaneo de WXT tire "Missing semicolon"
en una posición de línea/columna que no corresponde al archivo fuente real — probé
achicar el comentario, sacar backticks de patrones con `*`, y usar comentarios `//`
en vez de `/** */`, y con eso deja de reproducirse. No aislé la causa exacta (puede
ser el propio `@babel/parser` de WXT interpretando algo dentro del comentario, o un
plugin de Rollup buscando anotaciones tipo `@__PURE__` en cualquier comentario del
archivo — la build ya mostraba advertencias de ese estilo sobre comentarios de
`zod`). El archivo de `pcm-tap-processor.ts` que quedó usa comentarios `//` en vez de
`/** */` por eso — no es una preferencia de estilo, es lo que hace que compile.

**Impacto verificado.** Con esto, una sesión E2E real con
`--use-fake-device-for-media-stream` + `--use-file-for-fake-audio-capture` sobre
`fixtures/audio/es-hover-sidebar.wav` deja de tener `raw/audio.pcm` en 0 bytes.

### D-G1-08 · `chrome.runtime.sendMessage` no preserva `Uint8Array` — llega como objeto plano

**Contexto.** Con el worklet ya compilando (D-G1-07), la sesión E2E seguía sin
transcripción: `qua:audio-frame` SÍ llegaba al service worker (confirmado con logging
en vivo), pero `raw/audio.pcm` quedaba en 0 bytes. La guarda `isAudioFrameMessage`
chequeaba `msg.bytes instanceof Uint8Array` — y esa condición daba `false` en
producción. Depurado en vivo: `Array.isArray(msg.bytes)` también da `false`,
`msg.bytes.length` es `undefined`, y `Object.keys(msg.bytes)` da `['0','1','2',...]`.
`chrome.runtime.sendMessage`/`onMessage` **no preserva typed arrays** al cruzar de un
contexto de extensión a otro (offscreen doc → service worker): el `Uint8Array` que
`offscreen/main.ts` manda llega del otro lado convertido a un objeto plano indexado
por string, sin ninguna de las dos marcas (`Array.isArray`, `instanceof
Uint8Array`) que uno esperaría. Esto es distinto de un `MessagePort` real (el que
usa el worklet para hablar con `audio-capture.ts` en el mismo hilo del offscreen
doc, que sí preserva el `Uint8Array` — por eso ese primer tramo nunca mostró el
problema).

**Decisión.** `isAudioFrameMessage` (`offscreen/lib/messages.ts`) ya no exige
`instanceof Uint8Array`, solo el `type`. `toAudioFrameBytes` reconstruye el array
real con `Uint8Array.from(Object.values(msg.bytes))` — el orden de
`Object.values` sobre claves enteras está garantizado ascendente por la spec de JS,
así que los bytes quedan en el orden correcto sin necesidad de conocer la
longitud de antemano.

**Por qué no se encontró antes.** Ningún test de A2/A3 ejercita el mensaje
`qua:audio-frame` cruzando de verdad `chrome.runtime.sendMessage` entre dos
contextos reales — los tests de `audio-capture.ts` inyectan callbacks directos, y
no había ningún test de `session-manager.ts` para el lado de recepción (no existía
`handleOffscreenMessage` hasta esta misma tarea). Es la clase de bug que solo un
`chrome.runtime.sendMessage` real entre dos páginas de extensión reales expone.

**Impacto verificado.** Con este fix, la sesión E2E completa (Chrome real +
extensión real + daemon real, audio fake vía
`--use-file-for-fake-audio-capture` sobre `fixtures/audio/es-hover-sidebar.wav`)
produce una `Utterance` real, transcripta por whisper, y el correlador la ancla
con confianza 0.80 vía deixis. `report.md` sale con la transcripción y el issue
anclado — no vacío. **Este es el primer `report.md` de punta a punta con
contenido real que produjo el proyecto.**

## M1 · La integración final: `g1` sobre `main`

### D-M1-01 · `SessionManager` compone el canal de control (P1) y el offscreen de audio (G1) sin que ninguno de los dos ceda

**Contexto.** P1 y G1 salieron del mismo commit base (el merge de A3) y los dos
reescribieron `extension/entrypoints/background/session-manager.ts`, incluida la firma
del constructor. No es un conflicto de texto que git pueda alinear: son dos features
distintas que tocan el mismo ciclo de vida (`init` → `start` → `stop`).

- **P1** agregó el canal de control ocioso de D-P1-01 (`controlWs`, `handleControl`,
  `openControlChannel`, la función suelta `activeTabContext`) y, para poder testearlo,
  un segundo parámetro de constructor `createSocket?: (url) => WebSocketLike`.
- **G1** agregó el puente al offscreen document de §05.4 (`ensureOffscreenDocument`,
  `sendToOffscreen`, `handleOffscreenMessage`, el arranque/cierre del doc dentro de
  `start`/`stop`, y `onStatusChange` en `openTransport`) y dejó el constructor con solo
  `now`.

**Decisión.** Unión completa, sin elegir un lado en ningún punto. Las dos features son
ortogonales — una habla con el daemon por WS cuando *no* hay sesión, la otra habla con
una página de extensión cuando *sí* la hay — así que el criterio fue componerlas en el
orden del ciclo de vida y no dejar que ninguna pisara a la otra:

- **Constructor**: se toma el de P1 (`now`, `createSocket`). El de G1 es un subconjunto
  estricto — `createSocket` es opcional y default `undefined`, así que todo llamador de
  G1 sigue compilando y andando sin tocarlo. Éste era el nudo real: no había que elegir,
  había que ver que uno contenía al otro.
- **`init()`**: se toma la forma de P1 (early `return` en `recording` en vez del
  `else if` de G1 — equivalentes) y se conserva el `openControlChannel()` final. Grabando
  no se abre canal ocioso; en cualquier otro caso sí.
- **`start()`**: primero el cierre de `controlWs` de P1 (arriba de todo, antes de mover
  la FSM), después todo el arranque que ya existía, y al final el bloque de audio de G1.
  El orden importa: el `try/catch` del offscreen es lo último a propósito, porque G1 lo
  diseñó para degradar en silencio (§15) y no debe poder abortar una sesión que la FSM
  ya confirmó.
- **`stop()`**: el apagado del offscreen de G1 antes de cerrar el WS (el doc tiene que
  dejar de emitir frames antes de que se caiga el transporte), y el `openControlChannel()`
  de P1 al final, después de `fsm.finish()` — recién ahí la fase volvió a `idle`, que es
  la precondición que `openControlChannel` chequea.
- **`openTransport()`**: es el único punto donde los dos lados escriben en el mismo
  objeto literal. Las `WsClientOptions` ya admitían las cuatro (`createSocket`,
  `onCaptureRequest`, `onSessionControl`, `onStatusChange`) desde antes del fork, así que
  el merge es aditivo y no hubo que tocar `ws-client.ts`.
- **`openControlChannel()`** queda sin `onStatusChange` a propósito: `qua:connection-state`
  le informa al offscreen doc si el transporte *de la sesión* está vivo, y en idle no hay
  offscreen doc ni sesión de la cual informar.

**Efecto colateral deseado.** `handleControl("start")` llama a `this.start()`, que ahora
arranca el offscreen doc — o sea que el hotkey global de P1 captura audio, sin haber
escrito una línea para unirlos. Los tests de control de P1
(`session-manager.test.ts`) pasan sin modificarse y ejercitan de paso el camino de
degradación de G1: `@webext-core/fake-browser` no implementa `offscreen.hasDocument`,
tira, y la sesión arranca igual con un `console.warn`. Es exactamente el
comportamiento que §15 pide, verificado gratis.

### D-M1-02 · Los otros ocho conflictos

Todos mecánicos, se anotan para que no haya que redescubrirlos si alguien rebasea:

- `crates/quad/src/cli.rs` → **la de `g1`**. `reprocess` llama a `crate::pipeline::process`
  (ASR + correlador + renderer, D-G1-01); la de `main` era el cableado inline de B5, más
  pobre. Es un reemplazo, no una unión.
- `crates/qua-core/Cargo.toml` → **reescrito a mano**. La unión por clave que intenta git
  rompe las secciones `[target.'cfg(...)']`: `whisper-rs` aparece dos veces *a propósito*
  (macOS con feature `metal`, y el resto sin). `g1` además había quedado con la sección
  `cfg(not(macos))` vacía, así que la de `main` es la buena; se le suma
  `image.workspace = true`, que git había duplicado en `[dependencies]`.
- `crates/qua-core/src/lib.rs` → unión de módulos (asr, correlate, ingest, render, store);
  el conflicto real era solo el doc-comment de `render`, se queda el de `main` que también
  nombra `transcript.txt`.
- `.gitignore`, `pnpm-workspace.yaml`, `docs/DECISIONS.md` → unión de líneas/secciones.
- `STATE.md` → **la de `main`**.
- `Cargo.lock`, `pnpm-lock.yaml` → **los de `g1` como punto de partida, y después
  regenerados**. Los dos lados de un lockfile no se unen a mano. Ojo con el detalle: `g1`
  salió de antes de que C1 agregara `apps/qua-app`, así que su lock *no tiene* las
  entradas de Tauri; tomarlo tal cual las borra. `pnpm install` y el primer `cargo build`
  las vuelven a poner, y recién esos archivos regenerados son la unión real. Tomar el
  lock de un lado sin regenerarlo después deja el árbol inconsistente aunque el merge
  cierre limpio.

### D-M1-03 · Los sidecars de Tauri no están en el repo, y `cargo test --workspace` los necesita

**Síntoma.** Después del merge, `cargo test --workspace` muere antes de correr un solo
test: el build script de `qua-app` falla con ``resource path `binaries/quad-aarch64-apple-darwin`
doesn't exist``. No lo causa el merge — `apps/qua-app/src-tauri/binaries/` está en
`.gitignore` desde C1 (dos binarios de ~25 MB) y un worktree nuevo nunca los tiene.

**Cómo se destraba.** `bash apps/qua-app/scripts/build-sidecars.sh` antes del primer
`cargo test --workspace` en cada worktree. Se anota acá porque el error apunta a un
recurso faltante y no al script que lo genera.

## Z1 · Pase final de pulido

### D-Z1-01 · El reporte anclaba a "(ruta desconocida)": el `nav` de arranque se
descartaba, no se perdía en el correlador ni en el renderer

**Síntoma.** `node e2e/session.e2e.mjs` producía un `report.md` válido, con
transcripción real, pero el único issue anclaba a `` `(ruta desconocida)` `` en vez de
a la URL real de la página de prueba — a pesar de que
`extension/entrypoints/content/main.ts:51` sí emite un `nav` con `kind: "load"` y
`url: win.location.href` en cuanto el content script arranca.

**Dónde NO estaba el bug.** `qua-core::correlate::route_context`
(`crates/qua-core/src/correlate/mod.rs`) busca el último `Event::Nav`/`TabSwitch`
`<= t` en la lista de eventos de la sesión y ya tenía tests que cubrían exactamente
ese camino (`el_ancla_siempre_lleva_pestaña_y_url` en `correlate/anchor.rs`). El
renderer (`render/report.rs`) solo formatea lo que el `Anchor` trae — no hay nada que
"arreglar" ahí sin que sea un parche cosmético sobre datos que ya llegaron mal.

**Causa real.** El content script corre en `document_start` sobre `<all_urls>`
(`extension/entrypoints/content/index.ts`) — emite su `nav` de carga **siempre**,
haya o no una sesión abierta, porque no tiene forma de saberlo. Ese evento llega al
service worker por `qua:event` → `SessionManager.enqueue` → `onEvent`, y
`onEvent` (`session-manager.ts`) descarta cualquier evento si
`fsm.current.phase !== "recording"`:

```ts
private onEvent(event: Event): void {
  if (this.fsm.current.phase !== "recording") return;
  this.ws?.enqueue(event);
}
```

En el caso común — y en el E2E — la página ya está cargada cuando se manda
`qua:start-session`: el `nav` salió minutos u horas antes, mientras la fase todavía
era `idle`, y `onEvent` lo tiró. `baseUrl` sí llegaba bien al daemon (viaja aparte, en
el mensaje `session.start`, y queda correcto en `session.json`), pero eso es solo
metadata de la sesión — nunca se sintetiza como un `Event::Nav` que el correlador
pueda leer. Sin ningún `nav` en la lista de eventos, `route_context` no tiene de
dónde sacar la URL y devuelve `url: None` — de ahí "(ruta desconocida)", exactamente
como predice el fallback de `anchor_label`/`route_line` en `report.rs`.

**Fix.** `SessionManager.start()` (`extension/entrypoints/background/session-manager.ts`)
reconstruye el `nav` de arranque él mismo, inmediatamente después de
`fsm.confirmRecording()` — o sea, ya en fase `recording`, así que `onEvent` no lo
descarta — con la misma `baseUrl` que ya se resolvió para `session.start`. Para que
lleve `tab` (necesario para que `derive_tabs` en `qua-core::ingest::session_builder`
arme bien `tabs[]`, y para sesiones multi-pestaña en general), los dos caminos que
llaman a `start()` ahora resuelven también el id y el título de la pestaña activa:
`resolveActiveTabSessionInfo()` en `index.ts` (arranque desde el popup/`qua:start-session`)
y `activeTabContext()` en `session-manager.ts` (arranque por `session.control` del
hotkey global, D-P1-01). Sin pestaña conocida, el `nav` sintético sale igual, solo
que sin `tab` — `route_context` ya tolera eso (cae al primer `tab` conocido en la
sesión, o a ningún filtro de pestaña si no hay ninguno).

No es un parche general de "no descartar nada antes de recording": el resto de
eventos pre-sesión (viewport, hovers, etc.) se sigue descartando a propósito — no
hay nada útil que grabar de algo que pasó antes de que el usuario apretara grabar.
Lo único que se reconstruye es la ubicación de arranque, porque es la única pieza de
contexto pre-sesión que el correlador necesita y que además ya se conoce (viene de
la misma resolución de pestaña activa que arma `baseUrl`).

**Test.** `session-manager.test.ts` — describe `"nav sintético al arrancar (D-Z1-01)"`,
dos casos: con pestaña conocida (`tab`/`title` en el evento) y sin ella (mismo `nav`,
sin `tab`). Ambos fallan sin el fix (`daemon.allEvents()` no trae ningún `nav`) y
pasan con él. Nota de implementación: el `nav` no fuerza flush inmediato del
`WsClient` (§04: solo `mark` y `console.error` lo hacen), así que el test llama
`manager.stop()` para vaciar el buffer antes de inspeccionar lo que llegó al daemon
falso — igual que haría un flush por el timer de 500 ms en producción. El test
preexistente de `mark` (que si fuerza flush y de paso arrastra el `nav` ya
buffereado) se ajustó para filtrar por `k === "mark"`, en vez de comparar el batch
completo, porque no es su responsabilidad verificar el `nav`.

**Verificado end-to-end.** `node e2e/session.e2e.mjs` ahora ancla al `/` real de la
página de prueba (`` `Ancla` `/` `` en vez de `` `(ruta desconocida)` ``) — mismo
`report.md` de siempre, ruta correcta.

### D-Z1-02 · README.md desactualizado: decía "no hay app de bandeja" con C1+P1+M1 ya
mergeadas en `main`

**Síntoma.** `README.md` decía *"No hay todavía una app de bandeja (Tauri, C1 en
`STATE.md` — sin cerrar)"*. Falso desde `88deeca` (C1 mergeada, `2026-09-05 02:38`,
ver `STATE.md`): `apps/qua-app` existe, compila como parte del workspace, y tiene
tray + sidecar + hotkeys globales + onboarding + ventana de sesiones. G1 escribió esa
línea del README antes de que C1 se mergeara y nadie la tocó después.

**Qué se verificó, corriendo cada comando documentado (no solo leyendo el código):**
- `pnpm install`, `pnpm --filter @qua/protocol --filter @qua/source-resolver run
  build`, `pnpm --filter @qua/extension run build` — los tres, verdes.
- `apps/qua-app/scripts/build-sidecars.sh` — compila y copia los dos sidecars; sin
  esto `cargo test --workspace` muere (D-M1-03, ya documentado arriba).
- `pnpm tauri --version` (`apps/qua-app`) resuelve el CLI de Tauri. **No** se lanzó
  `pnpm tauri dev` de punta a punta: abre una ventana real y pide pairing manual, así
  que no es automatizable en este entorno sin intervención humana — el README ahora
  lo dice explícitamente en vez de dar a entender que se probó.
- `./packaging/macos/build-dmg.sh` — corre limpio, produce
  `target/dist/qua-cli-macos-0.1.0.dmg` con `hdiutil`. Su comentario interno todavía
  decía "C1 no cerró" — corregido de paso (apunta ahora a `pnpm tauri build` como el
  equivalente con la app real).
- `~/.cargo/bin/cargo build --release -p quad` + `./target/release/quad` — arranca,
  `GET /health` responde `{"ok":true,...}`.
- `qua sessions` / `qua show <id>` / `qua show <id> --format json` / `qua reprocess
  <id>` — ejercitados contra el `QUA_HOME` que dejó el E2E de D-Z1-01, los cuatro
  funcionan como los describe el README.
- `pnpm gen:schema` — regenera `fixtures/schema/*.json` sin diff (esquemas ya al día).
- `pnpm test` y `~/.cargo/bin/cargo test --workspace` — verdes (ver el resumen al pie
  de este archivo / `STATE.md`).
- `pnpm --filter @qua/e2e run e2e` resuelve al mismo `node session.e2e.mjs` que ya se
  corrió completo para D-Z1-01.

**Decisión de contenido.** El README ahora presenta las dos formas de usar QUA (app de
bandeja vs. daemon+extensión a mano) sin que ninguna sea "la de mentira", con una
sección de arranque rápido nueva que es honesta sobre qué se corrió de punta a punta en
este pase (el camino sin la app, vía `e2e/`) y qué no (`pnpm tauri dev`, que necesita
una ventana real). El `Layout` y el link a `apps/qua-app/README.md` se actualizaron
para no seguir arrastrando "(C1 — sin cerrar)".

### D-Z1-03 · `qua refine`: el archivo no avisaba que es un placeholder, solo el stdout

**Contexto.** D-B4-10 ya había decidido correctamente que `qua refine` es un
placeholder determinístico sin LLM real (§8.3 pide mandar `issues.json` a un LLM que
agrupe duplicados y reescriba cada issue como ticket; este repo no tiene credenciales
ni cliente de ningún proveedor, y no hay ninguna forma limpia de configurar uno sin
pedírselas a Gabriel — sigue sin haberla). Revisé si valía la pena cablear un LLM de
verdad en este pase: no hay decisión de proveedor, ni variable de entorno, ni sección
`[llm]` en `config.toml` en ningún lado del repo — inventar una acá, a las 4 de la
mañana, sin que Gabriel eligiera proveedor ni pusiera una API key, sería peor que dejar
el placeholder explícito. Se mantiene la decisión de D-B4-10 de no llamar a nada.

**El defecto real.** El aviso de "esto es un placeholder" solo vivía en el string que
`refine()` devuelve por stdout (`crates/quad/src/cli.rs`, la función `qua refine`
imprime). Eso lo ve quien corre `qua refine <id>` a mano en una terminal — pero no
quien abre `report.refined.md` directamente días después, ni quien le pega al botón
"refine" de la ventana de sesiones de la app Tauri (`apps/qua-app`), que dispara el
mismo binario `qua` pero nunca muestra su stdout. Sin nada dentro del archivo, un
título truncado a 72 caracteres + el texto completo del issue se lee exactamente como
lo que produciría un LLM barato — no hay forma de distinguirlos a simple vista.

**Fix.** `refine()` ahora escribe una nota fija arriba del todo de `report.refined.md`
(constante `NO_LLM_NOTICE` en `cli.rs`): deja explícito que no pasó por ningún
proveedor, qué transformación determinística sí se aplicó (título + cuerpo, sin
agrupar duplicados), y dónde está la decisión completa. El mensaje de stdout se deja
como estaba — es una segunda señal, no un reemplazo de la de adentro del archivo.

**Test.** `crates/quad/src/cli.rs`, módulo `refine_tests`:
`report_refined_md_deja_explicito_que_no_hay_llm` arma una `Session` mínima con un
issue, corre `refine()`, y verifica que `report.refined.md` contenga el aviso y el
texto del issue. Falla sin el fix (el archivo no tenía ningún string con "LLM" antes de
este cambio — no existía ningún test de `refine` en el repo).

## U1 · Emparejar en un click

### D-U1-01 · `POST /pair/auto`: trust-on-first-use para saltar el código de 6 dígitos

**El problema.** Emparejar la extensión era la peor fricción del producto: abrir una
terminal, `curl -X POST localhost:7331/pair/start`, leer un código de 6 dígitos de la
respuesta JSON, abrir `chrome://extensions` → Opciones de QUA, y tipearlo antes de que
venza a los 60 s (`pairing::PAIRING_WINDOW`). Gabriel se frustró con esto — con razón:
no hay ninguna razón de seguridad real para exigirle ese ritual a quien ya tiene la
extensión cargada y el daemon corriendo en su propia máquina.

**La decisión: trust-on-first-use, acotado al primer emparejamiento de la vida del
daemon.** `POST /pair/auto` (`crates/quad/src/server.rs`, `pair_auto_handler`) entrega
un token sin código de 6 dígitos si y solo si se cumplen las dos condiciones a la vez:

1. El header `Origin` es `chrome-extension://<id>` bien formado (mismo chequeo que ya
   usa `/pair`, `pairing::is_valid_extension_origin`) — un sitio web normal no puede
   falsificar ese Origin, el navegador lo pone él solo.
2. `paired_extensions` está vacío: nadie emparejó nunca con este daemon.

Con la lista ya no vacía, `/pair/auto` devuelve 409 (`error_codes::ALREADY_PAIRED`) y
el cliente cae al flujo existente de `/pair/start` + `/pair` (código de 6 dígitos) para
re-emparejar — ese flujo no cambió, sigue siendo el mecanismo de recuperación si hay
que reemplazar la extensión emparejada.

**Por qué es razonable y no un agujero de seguridad.** QUA es una herramienta local de
un solo usuario: el daemon bindea exclusivamente a 127.0.0.1 (§12, cero egreso de red,
ver el comentario de `server.rs`), así que solo puede pegarle algo que ya corre en la
misma máquina. El código de 6 dígitos de `/pair` defiende contra *otro proceso local*
que intente emparejarse sin permiso — pero el primer emparejamiento no tiene ningún
"otro" con quien competir: es, por definición, la primera vez que alguien habla con
este daemon. Exigir el código ahí no agrega seguridad real, solo fricción. La ventana
de exposición es exactamente una vez por instalación del daemon (`~/.qua/config.toml`
recién creado, sin `[[paired_extensions]]`) — de ahí en más, cualquier otro intento de
`/pair/auto` (extensión reinstalada, otro navegador, un script malicioso corriendo en
la misma máquina) rebota con 409 y necesita el código de 6 dígitos como antes. Esto es
el mismo modelo que SSH "TOFU" para host keys, o que un router doméstico que acepta el
primer dispositivo que le habla por Ethernet sin PIN: confiar en "quién llegó primero"
es razonable cuando el canal ya está acotado a un solo usuario/máquina, y es lo que
hace que la herramienta sea usable en vez de un ritual de terminal.

**Qué NO cambia.** El código de 6 dígitos (`/pair/start` + `/pair`) sigue existiendo
tal cual, para re-emparejar cuando `paired_extensions` ya no está vacío. `PairedExtension`,
`Config::add_paired_extension`, `Config::is_allowed` — nada de eso se tocó. `/pair/auto`
es un tercer endpoint, no un reemplazo.

**El popup (D-U1-02).** Antes: si no había token en `chrome.storage.local`, el popup
mostraba igual el botón "Grabar" — clickearlo llamaba a `SessionManager.start()`, que
tira porque no hay token, y el error se perdía en el `.catch()` silencioso de
`StatusClient.start()` (fire-and-forget, ver `status-client.ts`). Cero señal visible:
exactamente el bug de `TOKEN_STORAGE_KEY` que motivó este pase (ver el comentario de
`extension/shared/storage-keys.ts`) — un daemon sin sesión que fallaba en silencio.

Ahora (`extension/entrypoints/popup/main.ts`, `lib/connection.ts`, `lib/connect-controller.ts`):
sin token, el popup muestra un estado explícito "Sin conectar al daemon" con un botón
"Conectar" — un click hace `POST /pair/auto` (el `Origin` lo pone Chrome solo, no hace
falta setearlo a mano) y guarda el token en `TOKEN_STORAGE_KEY` (la clave única de
`shared/storage-keys.ts`, no una nueva). Si el daemon no responde a `GET /health`, dice
"El daemon no está corriendo" con el comando exacto (`./target/release/quad`, el mismo
del README) copiable con un click — nunca un error genérico. Si `/pair/auto` devuelve
409, el popup ofrece abrir las opciones en vez de reintentar a ciegas, porque ese caso
sí necesita el código de 6 dígitos.

**Test.**
- `crates/quad/tests/pair_auto_endpoint.rs`: acepta y devuelve un token válido con
  `paired_extensions` vacío, 409 con la lista no vacía, 401 sin `Origin` o con uno
  inválido, y el token emitido queda en la allowlist (`Config::is_allowed`).
- `extension/entrypoints/popup/lib/connection.test.ts`: `autoPair`/`isDaemonRunning`
  contra `fetchFn` inyectado — éxito guarda el token, 409 devuelve `already_paired`,
  fetch que rechaza (daemon caído) devuelve `daemon_down`.
- `extension/entrypoints/popup/lib/connect-controller.test.ts`: sin token muestra
  "Conectar"; con el daemon caído muestra "El daemon no está corriendo" + comando;
  éxito llama a `onConnected`; 409 ofrece "Abrir opciones" en vez de reintentar.
- `extension/entrypoints/popup/main.test.ts`: integración de punta a punta contra el
  DOM real del popup — sin token no se ve la UI de grabación, con token sí, un click en
  "Conectar" pasa de uno a otro.

**Sobre `shared/storage-keys.ts`.** `TOKEN_STORAGE_KEY` seguía siendo la única clave —
tanto `options/lib/pairing.ts` (código de 6 dígitos) como `popup/lib/connection.ts`
(`/pair/auto`) la importan del mismo lugar. No se agregó ninguna clave nueva de
storage; el `connection.test.ts` de este pase la importa explícitamente en vez de
hardcodear el string, siguiendo la regla ya establecida: si dos entrypoints comparten
un valor, vive en `shared/` y se importa, nunca se duplica.

### D-U2-01 · Que los errores se vean: `StatusClient` se tragaba todo, `start()` fallaba en silencio

**EL PECADO ORIGINAL.** `extension/entrypoints/popup/lib/status-client.ts` tenía un
`catch { return undefined }` en `send()`: si `chrome.runtime.sendMessage` tiraba (SW
recién reciclado, contexto invalidado) o el service worker respondía `{ok:false,
error}`, el popup lo descartaba entero. El bug real que motivó esta tarea (D-Z1 en el
commit anterior: options guardaba el token de pairing como `"quaPairToken"`, el
service worker lo leía de `"qua:daemon-token"`, nunca coincidían) tardó horas en
diagnosticarse exactamente por esto — `openTransport()` fallaba, pero lo único visible
era un contador de eventos en cero. Nada decía "no hay token" ni "el daemon no
responde": el síntoma era indistinguible de "no está pasando nada".

**Fix, cuatro capas:**

1. **`StatusClient` ya no se traga nada.** `send()` devuelve
   `{ok:true,value} | {ok:false,error}` en vez de `unknown | undefined`. `getStatus()`
   propaga ese error como `PopupStatus.lastError` (campo nuevo, opcional para no
   romper los literales de test existentes — se lee siempre con `?? null`).
   `start()`/`stop()`/`mark()` dejaron de ser fire-and-forget (`void this.send(...)`):
   ahora devuelven `Promise<CommandResult>`, y si el service worker responde
   `{ok:false, error}` ese `error` real llega hasta el controller. De paso,
   `getStatus()` mapea `StatusResponse.phase` → `PopupStatus.state` — antes ese merge
   comparaba contra un campo (`state`) que el service worker nunca mandó (mandaba
   `phase`), así que el estado en vivo del popup jamás reflejaba el `phase` real de la
   FSM. Nadie lo notó porque el test viejo mockeaba una respuesta con la forma
   incorrecta en vez de la real (mismo patrón que D-G1-03: cada lado testeaba su
   propia mentira del contrato del otro).

2. **Franja de estado nueva en el popup** (`popup/index.html` +
   `popup/lib/diagnostics.ts`, tres líneas siempre visibles, en español):
   - **Daemon** — `conectado` / `no responde` / `sin emparejar`. Sale de
     `StatusResponse.paired` + `wsStatus` (`internal-messages.ts` ahora expone
     `paired: boolean`, vía `SessionManager.isPaired()`), NO de la fase de sesión: el
     canal de control puede estar conectado en `idle` (D-P1-01), y una sesión puede
     seguir en `recording` mientras el WS está a mitad de una reconexión — son ejes
     independientes, mezclarlos habría sido el mismo tipo de bug que esto arregla.
   - **Micrófono** — reusa `checkMicPermission` de `options/lib/mic-permission.ts`
     tal cual (ya era framework-agnóstico con deps inyectables); el popup corre en un
     contexto de ventana real, así que `navigator.permissions.query` funciona igual
     que en options.
   - **Content script de la pestaña activa** — el problema es real y conocido: un
     content script `matches: ["<all_urls>"]` (§05) no se inyecta solo en pestañas
     que ya estaban abiertas antes de instalar/recargar la extensión, y antes de esto
     no había ninguna forma de saberlo salvo "la grabación no generó ningún evento".
     `content/lib/ping.ts` agrega un responder explícito (`qua:ping` → `qua:pong`);
     `diagnostics.checkContentScript()` le manda un ping a la pestaña activa
     (`chrome.tabs.sendMessage`) y si rechaza ("Could not establish connection")
     marca `hace_falta_recargar`. Si es así, aparece el botón "Recargar la pestaña"
     (`chrome.tabs.reload`, `diagnostics.reloadActiveTab()`).
   No hay polling en vivo todavía — la franja se refresca al abrir el popup y después
   de cada intento de start/stop/mark o de recargar la pestaña. Un refresco periódico
   (ej. cada pocos segundos mientras el popup esté abierto) queda para un pase
   siguiente; no era necesario para que el error deje de ser invisible.

3. **`SessionManager.start()` falla con la causa concreta, no un genérico.**
   `getToken()` tira `"[qua] sin token: emparejá primero desde options."` (antes:
   un párrafo genérico sin prefijo). Más importante: `openTransport()` antes era
   fire-and-forget — `start()` confirmaba la FSM a `"recording"` sin esperar a que el
   WS conectara de verdad, así que un daemon caído (o un token que el daemon
   rechazara) nunca producía un error, solo dejaba el `WsClient` reintentando en
   silencio de fondo con backoff mientras la sesión "grababa" sin transportar nada.
   Ahora `start()` llama `openTransport(..., {waitForConnection: true})`: espera el
   primer `hello.ok` o rechaza a los `connectTimeoutMs` (5 s por defecto, 3er
   parámetro del constructor — inyectable para tests) con
   `"[qua] el daemon no responde en 127.0.0.1:7331 — revisá que quad esté
   corriendo."`, y la FSM vuelve a `idle` (`abortStart()`) en vez de quedar
   "recording" para siempre. `init()` retomando una sesión tras un reciclado del
   worker sigue usando el modo fire-and-forget (`waitForConnection` default
   `false`) — ahí la sesión ya estaba confirmada, no hay nada que abortar.

4. **Prefijo `[qua]` en todos los `console.warn`/`console.error` del service
   worker**, para poder filtrarlos en `chrome://serviceworker-internals` en medio del
   ruido de la página. Ya estaba así en `session-manager.ts` (nadie lo había roto),
   pero no había ningún test que lo garantizara — `console-prefix.test.ts` escanea
   `extension/entrypoints/background/*.ts` y falla si aparece un `console.warn(...)`
   o `console.error(...)` sin `"[qua] "` al principio.

**Regla nueva para el futuro** (ya vale para D-anterior, la de `storage-keys.ts`, pero
queda explícita acá): si dos entrypoints de la extensión necesitan compartir un valor
o un contrato, va en `extension/shared/` con un test que falle si divergen — no
"cada lado define el suyo y confía en que coincidan". El bug de `quaPairToken` vs.
`qua:daemon-token` y el de `state` vs. `phase` en `getStatus()` son la misma clase de
error, encontrada dos veces en el mismo módulo.

**Tests** (`extension/entrypoints/background/session-manager.test.ts`, describe
`start(): mensajes de error concretos`; `extension/entrypoints/popup/lib/*.test.ts`):
cinco escenarios de fallo — sin token, daemon caído (con connectTimeoutMs chico para
no hacer lento el test suite), reintento posterior exitoso tras el timeout, content
script ausente, y verificación explícita de que los mensajes de las tres capas son
todos distintos entre sí (`Set(...).size === 3`) — más los tests de
`status-client.test.ts`/`controller.test.ts`/`diagnostics.test.ts` que verifican que
cada error real (no un `undefined` inventado) llega hasta el DOM. `pnpm test` (211
tests en `extension/`, 302 en el monorepo) y
`~/.cargo/bin/cargo test --workspace` (~197 tests, todos los binarios) quedan verdes —
el workspace de Rust
necesitó `apps/qua-app/scripts/build-sidecars.sh` primero (D-M1-03, ya documentado
arriba: sin los sidecars compilados, `cargo test --workspace` ni siquiera compila
`qua-app`).

## V1 · Tres bugs de la primera sesión real de Gabriel

La sesión se grabó y proceso bien (`report.md` válido, whisper transcribió, el
correlador ancló), pero la experiencia de grabarla tuvo tres problemas concretos.
Ninguno de los tres cambia protocolo ni cascadas ya cerradas — son fixes acotados.

### D-V1-01 · El popup no reflejaba la sesión en curso: cierra el "queda para un pase siguiente" de D-U2-01

**El bug.** "Le doy a Grabar y no se actualiza la UI de la extensión, le doy a
Detener y pasa lo mismo." `background/index.ts` solo tenía
`browser.runtime.onMessage.addListener` — responde cuando le preguntan, nunca
empuja nada — y `popup/lib/controller.ts` llamaba a `client.getStatus()` una única
vez al abrirse (`.then(applyStatus)`, antes de esta tarea) y de ahí en más solo
corría un timer que redibujaba la duración con el `startedAtWall` que ya tenía. La
sesión arrancaba de verdad del lado del daemon; el popup se quedaba en "Inactivo"
para siempre porque nunca volvía a preguntar.

**Decisión: opción (a) del enunciado — polling de `getStatus()` cada 500 ms
mientras el popup está abierto, no (b).** `startPopupController`
(`extension/entrypoints/popup/lib/controller.ts`) arranca un único timer al montar
(`pollTimer`, inyectable vía `setIntervalFn`/`clearIntervalFn` como ya hacía el
timer de duración viejo, que este reemplaza) que en cada tick llama
`client.getStatus()` y `refreshDiagnostics()` — la MISMA franja de daemon/micrófono/
pestaña de D-U2-01, que ese pase había dejado anotada como "no hay polling en vivo
todavía, queda para un pase siguiente". Se descartó (b) — que `SessionManager`
emita el estado por `chrome.runtime.sendMessage` en cada transición de la FSM — por
lo que el propio enunciado adelantaba: un popup MV3 puede no estar vivo en el
instante exacto de la transición (se cerró, se está reabriendo) y perdería el
mensaje sin nadie escuchando; sin un fallback de poll, esa pérdida es permanente
hasta el próximo cambio de estado. El scaffold de push (`client.onStatus`,
`StatusPushMessage` en `popup/lib/messages.ts`) se deja cableado — no hace daño
tenerlo — pero hoy nada del lado de `background/index.ts` lo emite; documentado acá
para que quien lo agregue después sepa que sería un complemento del poll, no un
reemplazo.

**Efecto secundario que había que resolver para que el poll sirviera de algo:**
`internal-messages.ts::StatusResponse` no traía `eventsCount` ni `startedAtWall` —
`StatusClient.getStatus()` los rellenaba siempre con los valores de `IDLE_STATUS`
(`null`/`0`), sin importar la fase real. `SessionManager` ahora expone
`getStartedAtWall()` (el `t0Wall` de la sesión en `SessionFsm.current`, o `null` en
`idle`) y `getEventsCount()` (contador propio, incrementado en `onEvent()` — cuenta
al encolar en la FSM, no al `ack` del daemon: un contador que se queda congelado
esperando la confirmación de red es peor que uno optimista que puede estar unos
milisegundos adelantado). `background/index.ts` los agrega a la respuesta de
`qua:get-status`.

**`applyStatus` ya no puede pisar `lastError` a ciegas.** Antes de este pase, el
único llamador de `applyStatus` era el push (nunca disparado) y el fetch inicial —
pisar `status` entero no importaba. Con un poll cada 500 ms, un `getStatus()` que
siempre trae `lastError: null` (porque un fallo de `start()`/`stop()` vive en el
`CommandResult`, no en `StatusResponse`) hubiera borrado el banner de error de
D-U2-01 casi apenas aparecía — el usuario ni llegaría a leerlo. `applyStatus` ahora
mergea: `{ ...next, lastError: next.lastError ?? status.lastError ?? null }`. Como
`getStatus()` real siempre manda `lastError: null` explícito (nunca `undefined`),
`??` lo trata como nullish igual y conserva el error que ya estaba mostrado — sigue
así hasta que un comando nuevo (`applyCommandResult`/`setError`) lo reemplace o lo
limpie.

**Se aprovechó para simplificar el timer de duración**, que antes vivía aparte
(`syncDurationTimer`, arrancaba/paraba según `status.state`): ahora la duración se
recalcula en `renderStatus()` en cada tick del mismo poll, sin un segundo timer.
Con 500 ms de cadencia el segundero se ve tan fluido como antes (1000 ms) y hay un
solo `setInterval` que cuidar en el teardown.

**Tests** (`extension/entrypoints/popup/lib/controller.test.ts`, describe "la UI se
actualiza sin cerrar el popup"): simula click en Grabar, no cierra el popup, dispara
un tick manual del poll (`fakePollTimer` captura el callback que se le pasa a
`setIntervalFn` en vez de depender de temporizadores reales) y verifica que la
etiqueta pasa de "Inactivo" a "● Grabando" y el botón a "Detener" — el criterio
exacto de esta tarea. Más: Detener sin cerrar el popup, la franja de diagnóstico se
refresca en el mismo tick, y un error real mostrado por un comando sobrevive al
siguiente tick del poll en vez de desaparecer solo. Los tests viejos de
`setIntervalFn`/`clearIntervalFn` que asumían un timer dedicado a la duración se
reescribieron para el timer único de poll; los del resto de D-U2-01 no cambiaron.

### D-V1-02 · El daemon ya no crea el directorio de sesión en `hello` — revierte la "alternativa descartada" de D-P1-01

**El bug.** `~/.qua/sessions/` acumulaba directorios como
`2026-09-05T14-23-08Z-dec3/` con `raw/audio.pcm` y `raw/events.ndjson` de cero bytes
y sin `session.json`: el canal de control ocioso de D-P1-01 (`SessionManager`
reabre uno en cada `init()`/`stop()`) manda `hello` sin nunca mandar
`session.start`, y `ActiveSession::create` (`crates/quad/src/session.rs`) creaba
`raw/` y abría los dos logs crudos apenas llegaba el `hello`. D-P1-01 ya documentaba
esto como "costo aceptado" y explícitamente descartó la alternativa perezosa citando
riesgo de romper algo en medio de tres tareas en vuelo (G1, F1c, B6) — esas tres ya
mergearon hace rato, y en la práctica el directorio huérfano confunde a cualquiera
que mire `~/.qua/sessions/` a mano, que es exactamente lo que le pasó a Gabriel.

**Decisión: la primera alternativa del enunciado — no crear basura, no barrerla
después.** `ActiveSession::create(data_dir)` ahora solo mintea el `id` y calcula el
`PathBuf` de `<data_dir>/sessions/<id>/` — cero I/O, ya no devuelve `Result`. El
directorio, los dos `RawEventLog`/`RawAudioLog` (ahora `Option<...>`, `None` hasta
que arranca) y `raw/meta.json` se crean recién en `ActiveSession::start()`, que es
cuando de verdad hay algo que escribir (`t0_wall`, `env`, `base_url` llegan con
`session.start`, no con `hello`). `ingest_events`/`ingest_audio`/`ingest_mark`
asumen con `.expect(...)` que la sesión ya arrancó — invariante que `ws.rs` ya
garantizaba filtrando por `is_started()` antes de llamarlos, así que el `expect`
documenta la garantía en vez de forzar un `Result` que ningún caso real dispara.
`sync()` devuelve `Ok(None)` sin tocar disco si todavía no hay logs. El `Hello` de
`ws.rs` ya no tiene rama de error: crear la sesión en memoria no puede fallar.

**Consecuencia aceptada (la misma que D-P1-01 ya había anticipado y descartó
evitar):** si el proceso muere entre `hello` y `session.start`, ya no hay ningún
directorio que inspeccionar — `qua recover <id>` cambia de mensaje ("no existe la
sesión sin nada recuperable más allá del directorio vacío") a
`crates/quad/src/cli.rs::recover`'s `if !dir.exists() { bail!("no existe la sesión
{id} en {}") }`, que ya existía para el caso "nunca hubo ni `hello`". Es un mensaje
más preciso, no uno peor — D-B1-09 sigue vigente para el rasgo que sí importa (sin
`meta.json` no hay `t0_wall`/`env` que inventar), solo que ahora ese caso pasa por
la rama de "no existe" en vez de la de "existe vacío".

**Tests** (`crates/quad/tests/hello_no_crea_directorio_huerfano.rs`, nuevo):
`hello` sin `session.start` no crea nada bajo `sessions/`, ni siquiera tras cerrar
la conexión sin `session.stop` (el crash exacto del canal ocioso); un segundo test
confirma que `session.start` de verdad sigue creando el directorio con
`raw/meta.json` como siempre. `kill_and_recover.rs` e `ingest_100k.rs` (que sí
mandan `session.start`) no necesitaron cambios — solo usan `session_dir` de
`hello.ok` para extraer el id del path, nunca asumieron que el directorio ya
existiera en ese punto.

### D-V1-03 · `css-path` enriquece el `TargetRef` con contexto legible — sin tocar la cascada de §5.2

**El bug.** Sobre `pediloapp.com` (sin `data-testid`) el builder cae a `css-path` y
produce selectores como `div:nth-of-type(2) > main:nth-of-type(1) > section` —
correcto según la cascada, pero inservible para que un reporte o un agente
entiendan qué es el elemento. `report.rs::anchor_label` además solo mostraba el
selector crudo entre backticks para CUALQUIER anchor `element`, sin importar que
`TargetRef` ya traía `text`/`name`/`role`/`classes` calculados.

**Decisión: no tocar la cascada de selectores — agregar contexto al `TargetRef` y
usarlo en el reporte solo cuando hace falta.**

1. **`extension/entrypoints/content/lib/target.ts`**: campo nuevo
   `TargetRef.ancestorText` (`packages/protocol/src/target.ts` +
   `crates/qua-protocol/src/target.rs`, `#[serde(rename = "ancestorText")]` porque el
   resto de los campos de `TargetRef` no usa `rename_all = "camelCase"` — son todos
   de una palabra). Se calcula SOLO cuando `strategy === "css-path"` y ni `text` ni
   `name` identifican al elemento (con cualquiera de los dos ya hay algo legible, no
   hace falta subir): `nearestAncestorText` sube hasta 5 niveles (mismo tope que
   `cssPathSelector` en `selector.ts`) buscando el primer ancestro con texto propio,
   pasado por `redactText` (mismas reglas de §12 que el texto del elemento). Un
   elemento dentro de un subárbol privado nunca llega a intentar la subida: `name`
   ya viene forzado a `"[redactado]"` en ese caso, así que la condición
   `!target.name` es falsa y no hay ninguna puerta lateral por la que el fallback
   filtre texto privado.
2. **`crates/qua-core/src/render/report.rs`**: línea nueva `**Elemento**` en el
   detalle de cada issue (`element_description_line`, antes de `**Fuente**`), SOLO
   con `strategy == CssPath` — con testid/id/rol-nombre el selector de `**Ancla**`
   ya es legible y esta línea sería ruido repetido. `human_description` arma la
   frase en orden de confianza: texto propio → nombre accesible → texto del
   ancestro más cercano (con el rol entre paréntesis si lo hay) → solo el rol. Con
   texto propio ("Comprar") queda `el botón que dice "Comprar"` — el ejemplo
   textual del enunciado — vía un mapeo chico tag→palabra en español
   (`tag_word`: button/a/input/select/textarea/img/svg; cualquier otro tag entre
   backticks). Las **Clases** (ya en el reporte, sin cambios) siguen siendo la
   pieza más identificatoria con Tailwind, tal como pide el enunciado — no había
   que agregar nada ahí, ya viajaban completas desde D-Z1/G1.
3. No se tocó la cascada de `buildSelector` (`selector.ts`) ni el criterio de
   unicidad — el pedido explícito era "agregá contexto", no cambiar cuándo se cae a
   `css-path`.

**Tests**: `extension/entrypoints/content/lib/target.test.ts` (describe
"ancestorText en el fallback css-path") — sube al ancestro cuando no hay texto ni
nombre, no sube si hay texto propio, no sube si hay `name` (aria-label) aunque el
selector haya caído a css-path por duplicado, no calcula nada si la estrategia no
es css-path, y confirma que un subárbol privado nunca expone `ancestorText`.
`crates/qua-core/src/render/report.rs` (mod `element_description_tests`): las
cuatro combinaciones de `human_description` más "otras estrategias no agregan
línea". `fixtures/session-full.json` no tiene ningún anchor `css-path`, así que el
golden de `report_fixture.rs` (`report_md_reproduce_exacto_el_formato_de_8_1`) no
cambió — la línea nueva es aditiva y solo aparece cuando la estrategia lo pide.

**Housekeeping de esquema**: `pnpm gen:schema` regenerado
(`fixtures/schema/target-ref.schema.json` gana `ancestorText`); los tres
call-sites de Rust que construían un `TargetRef` a mano
(`qua-core/src/correlate/testkit.rs`, `qua-core/src/store/mod.rs`,
`quad/tests/reprocess_idempotent.rs`) necesitaron el campo nuevo
`ancestor_text: None`.

**Tests de cierre de V1**: `pnpm test` (316 tests en el monorepo — 244 en
`extension/`, 62 en `packages/protocol`, el resto en los paquetes chicos) y
`~/.cargo/bin/cargo test --workspace` (todos los binarios, sidecars compilados
primero vía `apps/qua-app/scripts/build-sidecars.sh` — D-M1-03) quedan verdes.
### D-DIST-01 · El último reporte se consulta al daemon, no depende de `session.done`

El cliente cerraba el WebSocket inmediatamente después de `session.stop`, mientras el daemon
procesa ASR antes de emitir `session.done`. El popup ahora consulta `GET /last/report` con el
mismo token+Origin del pairing y muestra las acciones sólo cuando el archivo existe. Esto
además sobrevive cerrar/reabrir el popup. `POST /last/reveal` delega al SO sin exponer una
ruta arbitraria: siempre abre el directorio de la última sesión indexada con reporte.

### D-DIST-02 · Sin `[[projects]]`, el nombre visible es el host

El mapeo a repo sigue siendo enriquecimiento opcional. En vez de `unknown`, una URL no
mapeada usa su host (`pediloapp.com`) como etiqueta; el renderer omite `Fuente` cuando no
hay datos, sin placeholders. La única información adicional con repo sigue siendo la fuente/git.

### D-DIST-03 · El DMG distribuye la app y la extensión como recurso

`build-dmg-app.sh` compila extensión y sidecars antes de Tauri. La carpeta Chrome MV3 se
incluye en `QUA.app/Contents/Resources/extension` y el onboarding resuelve esa ruta mediante
la API de recursos, para que el usuario pueda cargarla sin conocer el repo. Firma y
notarización quedan fuera por falta de Developer ID; Gatekeeper se explica en el flujo visible.

### D-DIST-04 · Abrir QUA siempre muestra ventana y sólo permite una instancia

Una app `LSUIElement` sin ícono de Dock que sólo abre onboarding una vez puede quedar viva sin
ninguna señal visible. QUA ahora muestra onboarding en cada lanzamiento; cerrar conserva el modo
tray. `tauri-plugin-single-instance` se registra primero y convierte aperturas posteriores en
un foco de la ventana existente, evitando dos sidecars compitiendo por el puerto 7331.

## L1 · Modo local: QUA sin app ni daemon

Pedido de Gabriel (2026-10-14): que QUA funcione entero sin instalar una app. Hoy hacen
falta cuatro procesos (extensión, `quad`, app Tauri, `qua-mcp`), un pairing y compilar
Rust. Condición: si la transcripción en el navegador sale muy mala, se vuelve atrás.

### D-L1-01 · Todo corre dentro de la extensión; Rust se reusa como WASM

| Pieza de `quad` | En el modo local |
|---|---|
| whisper.cpp (large-v3-turbo) | el mismo modelo vía transformers.js 3.8, WebGPU (encoder fp16 + decoder q4) o WASM q8 sin GPU |
| silero VAD vía `ort` | el mismo `silero_vad.onnx` vía onnxruntime-web, con la misma llamada (`[1,512]`, estado `[2,1,128]`) |
| segmentador, correlador, render | `qua-core` compilado a wasm32 (`crates/qua-wasm`), sin reescribir nada |
| `~/.qua/sessions/` + SQLite | IndexedDB `qua-local` (eventos, sesiones, capturas) |
| hotkey global de la app Tauri | `chrome.commands` con `global: true` (Ctrl+Shift+1 / Ctrl+Shift+2) |
| pairing de 6 dígitos | no existe: no hay nada que conectar |
| `qua-mcp` | "Copiar reporte" y "Descargar" (`Descargas/qua/<id>/report.md` + `assets/`) |

`qua-core` gana la feature `native` (default) que agrupa whisper-rs, rusqlite,
voice_activity_detector y ureq. Sin ella compila a `wasm32-unknown-unknown`; `quad` y
`qua-mcp` la piden explícita. `cargo test` de los crates nativos sigue verde.

**Dónde corre cada cosa.** El SW junta eventos (lotes de 500 ms a IndexedDB) y el ring
de capturas. El offscreen doc guarda el PCM en memoria (`PcmStore`, ubicado por el `t_ms`
de cada frame) y al detener procesa ahí mismo: es el único contexto con WebGPU y sin el
límite de vida del service worker. El modelo empieza a cargarse al arrancar la grabación,
en paralelo.

**Capturas.** `quad` nunca usó los `CaptureRequest` del paso 9 (D-G1-01): la sesión ya
había terminado cuando corría el pipeline. Acá la sesión entera está en el navegador, así
que cada issue con ancla de elemento y confianza ≥ 0.5 recibe el recorte del frame más
cercano (si está a menos de 3 s). Para eso el ring en IndexedDB pasa de 40 frames a 30
minutos de retención.

### D-L1-02 · Medición antes de decidir: calidad y paridad

Sobre sesiones reales de Gabriel (`~/.qua/sessions`), con el mismo pipeline TS que usa la
extensión corrido en Node (`onnxruntime-node`):

- **Segmentación idéntica**: mismas utterances y mismos `t_start` al milisegundo que `quad`.
- **Transcripción**: large-v3-turbo difiere de whisper.cpp en 0,5–0,6 % de las palabras
  (puntuación, "uno" → "1"). whisper-small difiere en 8 % y rompe frases que el correlador
  necesita ("Después esto me gusta" → "y le ponen a tomar uja"): por eso el default es turbo.
- **Correlador**: con las mismas utterances, `qua-wasm` da los mismos issues que `quad`
  en las 9 sesiones (solo cambia el último decimal de un `f64` y la etiqueta del proyecto,
  que ahora es el host — D-DIST-02).
- **`t_end`**: whisper.cpp termina cada utterance en el fin del segmento del VAD (±12 ms);
  el timestamp que predice transformers.js cae 400–600 ms antes, y eso rompía la fusión
  del paso 1 (`merge_gap_ms`). Se usa el fin del segmento. Con eso, mismos issues, anclas y
  categorías que `quad` en las sesiones medidas.
- `avg_logprob` y `no_speech_prob` (filtro de ruido del paso 2) se calculan con un logits
  processor propio, porque transformers.js no los expone.

En Chrome de verdad (Chrome for Testing, Mac con Apple Silicon, WebGPU):

- **Laboratorio** (`e2e/asr-lab.mjs`, build con `QUA_LAB=1`): PCM crudo de una sesión de 153 s
  → 0,3 % de diferencia con whisper.cpp, 34/34 utterances, 65 s de proceso con el modelo ya
  en caché. Con o sin `return_timestamps`, igual.
- **E2E completo** (`e2e/local.e2e.mjs`): la misma sesión reproducida como micrófono falso,
  grabada, transcripta y reportada por la extensión → 1,0 % de diferencia, 34/34
  utterances, 72 s de proceso, 2 capturas recortadas. La primera corrida baja el modelo
  (~1 GB): 83 s en esta conexión.
- **Trampa del E2E**: el WAV ya pasó por supresión de ruido y AGC cuando se grabó. Si el
  micrófono falso lo vuelve a procesar, se pierden tramos enteros de voz (15,5 % de
  diferencia, 31/34 utterances). El E2E compila con `WXT_QUA_RAW_MIC=1`, que apaga ese
  procesamiento solo en ese build. Con un micrófono real el audio pasa una sola vez, igual
  que con `quad`: el código de captura no cambió.

### D-L1-04 · Sin WebGPU se usa whisper-small

Medido en Chrome con `e2e/asr-lab.mjs` sobre una sesión de 109 s, WASM de un solo hilo
(sin aislamiento de origen no hay SharedArrayBuffer):

| Modelo | Diferencia con whisper.cpp | Tiempo de proceso |
|---|---|---|
| turbo, WebGPU (default) | 0,5 % | 58 s |
| turbo, WASM q8 | 0,5 % | 1745 s (29 min) |
| small, WASM q8 | 2,6 % | 324 s |
| base, WASM q8 | 12,7 % | 82 s |

Turbo sin GPU es inusable y base se equivoca demasiado. Sin WebGPU se carga small, y el
popup lo dice ("sin GPU: más lento y menos preciso").

### D-L1-05 · El micrófono tardaba hasta 13 s en entregar audio (bug que ya existía)

Con un clip corto el E2E daba cero utterances de forma intermitente. Instrumentando la
captura (`capture` en la fila de la sesión): `getUserMedia` tardaba 1–2 s y
`audioWorklet.addModule` entre 0,3 y 6,3 s, y no se capturaba nada hasta que terminaban
los dos. El primer frame llegaba entre 1,3 y 13 s después de apretar Grabar: todo lo que
se dijera antes se perdía. El código de captura es el mismo de la era daemon; el E2E
viejo no lo detectaba porque aceptaba cero utterances con una advertencia.

- El worklet pesaba 95 KB porque `pcm-framer` importaba `@qua/protocol` entero (zod
  incluido). Con `"sideEffects": false` en `packages/protocol` queda en 2,5 KB.
- `AudioCapture.start` prepara el `AudioContext` y el worklet en paralelo con el micrófono.
- El popup dice "Abriendo el micrófono… esperá para hablar" hasta `qua:capture-started`.
- La precarga del modelo solo corre si nunca se bajó: inicializar ~1 GB en la GPU durante
  la grabación también competía con el hilo de audio.

Resultado: primer frame a ~200 ms en 4 de 4 corridas. Sesión real de 153 s con el build
final: 1,0 % de diferencia con whisper.cpp, 34/34 utterances, 7 issues (los mismos 7 de
`quad`), 3 capturas, 77 s de proceso.

### D-L1-06 · Grabar en una pestaña abierta antes de instalar ya no pierde los clicks

Primera prueba real de Gabriel: reporte con "0 issues + 2 sin anclar" y solo la ruta `/`
(el `nav` sintético del SW). La pestaña estaba abierta desde antes de cargar la extensión,
y Chrome no inyecta los `content_scripts` del manifest en pestañas existentes: no llegó
ningún evento. Antes había que ver el aviso "recargá la pestaña" en el popup. Ahora, al
grabar y al cambiar de pestaña durante la grabación, el SW manda `qua:ping` y si nadie
contesta inyecta `content-scripts/content.js` con `chrome.scripting`. El content script
tiene una guarda contra doble inyección.

### D-L1-07 · Las capturas fallaban en pantallas retina

Segunda prueba real de Gabriel: issue anclado con confianza 1.00 pero sin captura. El ring
reduce cada frame a 1280 px de ancho (§5.3) y el recorte escalaba el rect por el `dpr`:
en su Mac (1710 px CSS a 2x) el rect caía debajo del borde del frame, el recorte quedaba
de 0 px y el issue salía sin imagen. En el E2E no se veía porque la ventana medía justo
1280 px a 1x. `crop` de qua-wasm ahora recibe el ancho del viewport y escala por
`ancho del frame / ancho del viewport`; test en Rust con el caso exacto.

### D-L1-03 · Lo que se pierde, a propósito

- **MCP**: sin proceso local no hay servidor stdio. El reporte se copia o se baja a una
  carpeta que el agente lee. El daemon y `qua-mcp` siguen en el repo y compilan.
- **Priming con `vocab.txt`**: transformers.js 3.8 no acepta `initial_prompt` en whisper. Con
  turbo no se notó en las sesiones medidas.
- **Timestamps por palabra** (`words`): quedan vacíos. El correlador no los usa.
- **Sesiones de más de 30 min**: las capturas del principio se podan del ring.

### D-L1-08 · Rediseño de la UI (2026-10)

Toda la UI de la extensión se rediseñó en Penpot (archivo "QUA") y se implementó completa:
popup con estados e historial, primera vez en cuatro pasos, pastilla en la página, ícono de
la barra dibujado por estado, notificación al terminar, visor del reporte y Ajustes. Una
sola marca guía todo: el anillo (gira abriendo el mic, late grabando, se llena procesando,
un punto por issue al terminar). Se borraron el popup y las opciones del modo daemon
(pairing, conexión, descarga manual del modelo); el daemon sigue compilando aparte.

### D-L1-09 · Bugs que aparecieron al implementarla

- **El content script moría en `document_start`.** `observers.ts` observaba `doc.body`, que
  todavía es `null` en ese momento: tiraba y no se instalaba nada más. Ahora observa
  `documentElement` y `main.ts` instala cada parte en su propio `try`.
- **La migración de IndexedDB quedaba bloqueada.** Subir `qua-local` a v2 para guardar el
  audio esperaba para siempre si había otra conexión abierta (popup, offscreen). El audio
  va a una base aparte, `qua-audio`; `qua-local` sigue en v1 y las conexiones se cierran en
  `onversionchange`.
- **Sesiones trabadas en "procesando".** Si Chrome cerraba el documento offscreen a mitad
  de camino, la sesión quedaba en `processing` para siempre. Al iniciar y al grabar, una
  sesión así sin offscreen pasa a `failed` ("Se interrumpió el procesamiento") y se puede
  reintentar desde el audio guardado.
- **Carrera al despertar el service worker.** Los mensajes llegaban antes de que el manager
  leyera su estado y el popup veía "inactivo" con una grabación en curso. El SW ahora hace
  `await ready` antes de atender cualquier mensaje.

### D-L1-10 · Diferencias con el diseño

- **Historial desde el header**: el diseño no tenía cómo llegar al historial desde el popup;
  se agregó un botón de reloj.
- **"Ver reporte" en el estado listo**, además de copiar y descargar, para abrir el visor.
- **Probar el micrófono en Ajustes es un botón**, no un medidor siempre encendido: tenerlo
  en vivo dejaba el micrófono abierto (y el indicador de Chrome prendido) mientras la
  página estuviera abierta.
- **Sin modo oscuro todavía** en las páginas: el diseño es claro. El ícono de la barra sí
  se adapta al tema de Chrome.
