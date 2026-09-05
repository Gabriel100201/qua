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

### D-B3-07 · La fusión por selector es una perilla, con el valor de la spec como default

**Ambigüedad con consecuencias.** §07 paso 5 cierra con «los candidatos que resuelven al
mismo `sel` se fusionan: se suman los scores». La suma es incondicional, y eso hace que una
tira de eventos débiles sobre un mismo elemento (un `scroll_settle`, un `focus_change`, un
`click` viejo y dos `hover`) supere a la señal real: cinco aportes chicos suman 7.07 contra
los 5.04 de un hover sostenido más un click. Además rompe la escala de la confianza: el
divisor 6.0 del propio paso 6 es exactamente el score máximo de **un** candidato
(`click 3.0 × recency ≤1 × bias ACTION 2.0 × visibility 1.0`), así que con scores sumados
la confianza satura en 1.0 seguido.

**Decisión.** Se implementa la suma literal de §07 y se deja como **default**. El peso de
los aportes que no son el más fuerte se expone como `merge_extra_weight` (default `1.0` =
la suma de la spec; `0.0` = solo el aporte más fuerte).

**Por qué así y no cambiando la fórmula.** La spec es explícita y B3 no la modifica por su
cuenta. Pero la consecuencia es medible y contradice dos cosas de la propia spec —la regla
de oro del paso 6 y el criterio de aceptación de B3 en §14 («ningún caso ambiguo anclado a
elemento con confianza > 0.5»)—, así que la perilla existe y está documentada. Sobre el
harness de F1b: `1.0` da 46,2 % y `0.0` da 73,1 %, cambiando **una línea del
`config.toml`**, sin recompilar. **Queda reportado para que lo decida el coordinador.**

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
