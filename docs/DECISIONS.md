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

### D-09 · Harness sintético no trivial (F1b)

El harness genera 26 escenarios (20 reforzados y 6 discriminantes), con 15–24 eventos por sesión y 4–6 candidatos por ventana. Cada escenario declara en el manifiesto qué regla ejercita y por qué el baseline temporal falla; el runner mide ese baseline y exige menos de 60% (resultado actual: 15.4%).

Se eligieron fixtures con rutas y selectores de la aplicación (`/agenda/semana`, `button[data-testid=...]`) y distractores de tipos reales. La intención es que el 20/20 valide el ground truth, pero además que una implementación que ignore deixis, visibilidad o dominancia no pueda pasar por casualidad.

### D-08 · Alcance de los stubs

`packages/{source-resolver,babel-plugin-source,vite-plugin-source}`, `extension/`,
`crates/{quad,qua-mcp}` y todo `crates/qua-core` salvo `store/` quedan como stubs que
compilan y cuyo `test` pasa trivialmente. Cada uno tiene un comentario de cabecera que dice
qué tarea lo implementa.

**Por qué.** §14 asigna esas piezas a otras tareas. F0 solo tiene que dejar el esqueleto en
pie para que `pnpm test` y `cargo test --workspace` sean verdes desde el commit uno, que es
lo que permite que las ocho tareas de la ola 1 arranquen sin pisarse.

---

## A1 · Content script

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
