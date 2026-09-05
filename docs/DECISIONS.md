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
