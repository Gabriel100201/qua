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
