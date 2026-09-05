# QUA — Especificación de implementación

> Fuente de verdad del proyecto. Artifact original:
> https://claude.ai/code/artifact/cb478d4b-195c-4e41-ba7c-764bc1836c4b



## 01. Decisiones tomadas

Todas cerradas. Cada una con el motivo, para que un agente que agarre una tarea suelta entienda por qué no puede cambiarla unilateralmente.

| Área | Decisión | Motivo |
|---|---|---|
| Nombre | QUA — CLI qua · daemon quad · MCP qua-mcp · dir ~/.qua/ | Un QA que mira todo mientras hablás. El daemon sigue la convención -d (sshd, dockerd). Descartados: Relato (no dice qué hace) y QAI (el sufijo AI es genérico y describe mal: QUA graba, la IA consume). |
| Captura | Extensión Chrome MV3, no app nativa | El valor es la semántica del DOM. Desde afuera del navegador solo hay píxeles. |
| Audio | Offscreen Document + AudioWorklet → PCM Int16 16 kHz mono | Sobrevive cambios de pestaña. PCM crudo evita decodificar WebM/Opus en Rust. |
| Transcripción | Continua con VAD, no push-to-talk | El push-to-talk reintroduce el ritual que el proyecto elimina. El hotkey queda como marcador de precisión. |
| ASR | whisper.cpp · large-v3-turbo-q5_0 vía whisper-rs | Mejor español técnico que Parakeet; compila en las 3 plataformas (Metal/CUDA/CPU). |
| VAD | silero-vad ONNX (voice_activity_detector) | ~2 MB, mucho mejor que WebRTC VAD con ruido de fondo. |
| Daemon | Rust + tokio + axum, binario aparte (sidecar) | Corre headless sin GUI; si crashea no se lleva la UI puesta. |
| App | Tauri 2, menu bar, lanza el sidecar | No captura nada: orquesta, hotkey global y navegador de sesiones. |
| Extensión | WXT + TypeScript | Maneja MV3, offscreen y HMR sin pelear con el manifest. |
| Persistencia | SQLite (WAL) para índice + archivos para contenido | El MCP consulta el índice mientras el daemon escribe. WAL permite lectores concurrentes. |
| Interfaz de agente | Archivos en disco y servidor MCP | Archivos para leer directo; MCP para que el agente busque sin que le pases rutas. |
| Source mapping | Fiber de React 19 primero, plugin de build como refuerzo | Tu stack es Next 16 + React 19 + Turbopack: no hay Babel y _debugSource ya no existe. Ver §11. |
| Fuente de verdad | TypeScript + Zod en packages/protocol | Rust espeja a mano; un test de fixtures doradas garantiza que no divergen. |
| Refinamiento LLM | Comando opcional, fuera del daemon | El daemon se mantiene 100 % local. Vos decidís cuándo gastar tokens. |

## 02. Arquitectura

Cuatro procesos. Cada uno hace una cosa que los otros no pueden hacer.

```
┌─ Extensión Chrome (MV3) ───────────────────── "el sensor" ─┐
│  content script   DOM, hover, geometría, rutas, consola,   │
│                   red, selector estable, source de React   │
│  service worker   FSM de sesión, ciclo de pestañas,        │
│                   outbox IndexedDB, ring de screenshots    │
│  offscreen doc    micrófono → PCM 16 kHz + archivo opus    │
│  popup / options  start·stop, transcript vivo, pairing     │
└─────────────────────────┬──────────────────────────────────┘
                          │ ws://127.0.0.1:7331/ws  (token + Origin allowlist)
┌─────────────────────────▼─ Daemon `quad` (Rust) ───────────┐
│  ingest      jitter buffer · ring f32 · ndjson append      │
│  asr         silero VAD → whisper.cpp → Utterance          │
│  correlate   voz ↔ eventos → Issue  (§7)                   │
│  render      report.md · issues.json · recortes PNG        │
│  store       SQLite WAL + ~/.qua/sessions/<id>/            │
└────────┬───────────────────────────────────┬───────────────┘
         │ sidecar stdio + health            │ lectura SQLite (RO)
┌────────▼── App Tauri 2 ────────┐  ┌────────▼── qua-mcp ────┐
│ tray · hotkey global · picker  │  │ stdio MCP → Claude     │
│ de mic · medidor · sesiones    │  │ Code → Zygos → Linear  │
└────────────────────────────────┘  └────────────────────────┘
```

### Reloj único

Cada content script tiene su propio performance.now(). Todo evento sale del content script con t_wall = performance.timeOrigin + performance.now() en milisegundos. El service worker no lo toca. El daemon guarda t0_wall al recibir session.start y normaliza t = t_wall − t0_wall. Todos los t del sistema son enteros en ms desde el inicio de la sesión. El audio lleva su propio t_ms en el header del frame binario, calculado con el mismo origen.

## 03. Modelo de datos

Fuente de verdad: packages/protocol/src/schema.ts con Zod. De ahí salen los JSON Schema y las fixtures doradas que Rust tiene que parsear.

**Session**

```
{
  <span class="s">"schema"</span>: <span class="s">"qua/session@1"</span>,
  <span class="s">"id"</span>: <span class="s">"2026-09-04T14-32-11Z-a3f9"</span>,        <span class="c">// ISO compacto + 4 hex</span>
  <span class="s">"status"</span>: <span class="s">"recording|processing|ready|failed"</span>,
  <span class="s">"t0_wall"</span>: 1788012731204,
  <span class="s">"started_at"</span>: <span class="s">"2026-09-04T14:32:11.204Z"</span>,
  <span class="s">"ended_at"</span>: <span class="s">"2026-09-04T14:39:03.512Z"</span>,
  <span class="s">"duration_ms"</span>: 412308,
  <span class="s">"project"</span>: { <span class="s">"label"</span>: <span class="s">"Agendi"</span>, <span class="s">"repo"</span>: <span class="s">"/Users/g/Projects/personal/agendi"</span> },
  <span class="s">"git"</span>: { <span class="s">"branch"</span>: <span class="s">"main"</span>, <span class="s">"sha"</span>: <span class="s">"9f21ac3"</span>, <span class="s">"dirty"</span>: true },
  <span class="s">"env"</span>: { <span class="s">"ua"</span>: <span class="s">"..."</span>, <span class="s">"chrome"</span>: <span class="s">"142.0"</span>, <span class="s">"platform"</span>: <span class="s">"macOS 15.1"</span>,
            <span class="s">"viewport"</span>: {<span class="s">"w"</span>:1512,<span class="s">"h"</span>:857,<span class="s">"dpr"</span>:2}, <span class="s">"ext"</span>: <span class="s">"1.0.0"</span> },
  <span class="s">"audio"</span>: { <span class="s">"path"</span>: <span class="s">"audio.opus"</span>, <span class="s">"sample_rate"</span>: 16000, <span class="s">"gaps_ms"</span>: 0 },
  <span class="s">"stats"</span>: { <span class="s">"events_raw"</span>: 3184, <span class="s">"events_kept"</span>: 147,
              <span class="s">"utterances"</span>: 24, <span class="s">"issues"</span>: 9 },
  <span class="s">"tabs"</span>: [{ <span class="s">"tab"</span>:42, <span class="s">"url"</span>:<span class="s">"..."</span>, <span class="s">"title"</span>:<span class="s">"..."</span>, <span class="s">"first_ms"</span>:0, <span class="s">"last_ms"</span>:412000 }],
  <span class="s">"events"</span>: Event[], <span class="s">"utterances"</span>: Utterance[], <span class="s">"issues"</span>: Issue[]
}
```

**Event — unión discriminada por k**

Todos comparten { t: number, k: string, tab?: number }.

| k | Campos | Emitido cuando |
|---|---|---|
| nav | url, title, kind: load\|spa\|back\|forward | Carga o cambio de ruta SPA (patch de history.pushState + popstate) |
| tab_switch | from, to, url | chrome.tabs.onActivated |
| tab_close | tab | chrome.tabs.onRemoved |
| click | target: TargetRef, button, mods[] | Captura en fase capture sobre document |
| hover | target, dwell_ms | Al salir de un elemento con permanencia ≥ 400 ms |
| focus_change | target | focusin |
| input | target, field:{name,type,label} sin value | input con debounce 800 ms |
| submit | target | submit |
| scroll_settle | y, pct, top_target? | 150 ms sin scroll tras haber scrolleado |
| viewport | w, h, dpr | Inicio y resize con debounce 300 ms |
| console | level: error\|warn, text, stack? | Wrap de console.error/warn + onerror + unhandledrejection |
| net_fail | method, url, status, duration_ms | status ≥ 400 o error de red (patch fetch + XHR) |
| net_slow | method, url, status, duration_ms | duración > 1200 ms |
| long_task | duration_ms | PerformanceObserver('longtask'), > 200 ms |
| layout_shift | value, sources?: TargetRef[] | layout-shift sin input reciente, value > 0.05 |
| mutation_burst | target?, count | > 20 mutaciones en 100 ms — proxy de "se abrió un modal" |
| mark | source: hotkey\|popup | El ancla dura de precisión |
| audio_gap | duration_ms | Se perdió audio por desconexión del WS |

**TargetRef**

```
{
  <span class="s">"sel"</span>: <span class="s">"button[data-testid=\"nuevo-turno\"]"</span>,
  <span class="s">"strategy"</span>: <span class="s">"testid | id | role-name | css-path"</span>,
  <span class="s">"tag"</span>: <span class="s">"button"</span>,
  <span class="s">"text"</span>: <span class="s">"Nuevo turno"</span>,               <span class="c">// innerText, 80 chars, redactado</span>
  <span class="s">"role"</span>: <span class="s">"button"</span>, <span class="s">"name"</span>: <span class="s">"Nuevo turno"</span>,   <span class="c">// nombre accesible</span>
  <span class="s">"rect"</span>: { <span class="s">"x"</span>:1180, <span class="s">"y"</span>:96, <span class="s">"w"</span>:88, <span class="s">"h"</span>:32 },
  <span class="s">"visible"</span>: true,
  <span class="s">"classes"</span>: <span class="s">"px-3 py-1.5 text-sm rounded-md bg-zinc-900"</span>,  <span class="c">// completo: es Tailwind v4</span>
  <span class="s">"computed"</span>: { <span class="s">"fontSize"</span>:<span class="s">"14px"</span>, <span class="s">"padding"</span>:<span class="s">"6px 12px"</span>,
                 <span class="s">"color"</span>:<span class="s">"rgb(250,250,250)"</span>, <span class="s">"backgroundColor"</span>:<span class="s">"rgb(24,24,27)"</span> },
  <span class="s">"component"</span>: [<span class="s">"AgendaHeader"</span>, <span class="s">"Button"</span>],           <span class="c">// cadena de _debugOwner</span>
  <span class="s">"src"</span>: { <span class="s">"file"</span>:<span class="s">"src/components/AgendaHeader.tsx"</span>, <span class="s">"line"</span>:42, <span class="s">"tier"</span>:2 }
}
```

> **DECISIÓN** — Notaclasses va completo, no truncado. Con Tailwind v4 la cadena de clases es el estilo — es exactamente lo que el agente tiene que editar. computed solo se calcula en click y en hover con dwell > 800 ms, porque getComputedStyle fuerza reflow.

**Utterance · Issue**

```
Utterance {
  id, t_start, t_end, text, lang,
  words: [{ w, t, d, p }],       <span class="c">// p = probabilidad por palabra</span>
  avg_logprob, no_speech_prob,
  marked: boolean                <span class="c">// hubo un evento `mark` adentro</span>
}

Issue {
  id: <span class="s">"i03"</span>, utterance_ids: [<span class="s">"u07"</span>,<span class="s">"u08"</span>], t, text,
  anchor: {
    kind: <span class="s">"element" | "route" | "session"</span>,
    target?: TargetRef, tab, url,
    confidence: 0.82,
    reason: [<span class="s">"click −0.9s"</span>, <span class="s">"deixis:este"</span>, <span class="s">"hover 2.1s"</span>]
  },
  evidence: { console: [], net: [], timings: [{label, ms}], screenshot?: <span class="s">"assets/i03.png"</span> },
  category: <span class="s">"ui|bug|perf|copy|idea"</span>,
  severity: <span class="s">"low|med|high"</span>,
  exported_to: null | <span class="s">"https://linear.app/..."</span>
}
```

**Esquema SQLite**

```
<span class="k">CREATE TABLE</span> sessions (
  id <span class="k">TEXT PRIMARY KEY</span>, status <span class="k">TEXT</span>, project <span class="k">TEXT</span>, started_at <span class="k">TEXT</span>,
  duration_ms <span class="k">INTEGER</span>, issue_count <span class="k">INTEGER</span>, dir <span class="k">TEXT</span>, git_sha <span class="k">TEXT</span>
);
<span class="k">CREATE TABLE</span> issues (
  id <span class="k">TEXT PRIMARY KEY</span>, session_id <span class="k">TEXT REFERENCES</span> sessions(id),
  t <span class="k">INTEGER</span>, text <span class="k">TEXT</span>, category <span class="k">TEXT</span>, severity <span class="k">TEXT</span>,
  confidence <span class="k">REAL</span>, anchor_kind <span class="k">TEXT</span>, sel <span class="k">TEXT</span>, url <span class="k">TEXT</span>,
  src_file <span class="k">TEXT</span>, src_line <span class="k">INTEGER</span>, exported_to <span class="k">TEXT</span>, json <span class="k">TEXT</span>
);
<span class="k">CREATE INDEX</span> idx_pending <span class="k">ON</span> issues(exported_to, confidence <span class="k">DESC</span>);
<span class="k">CREATE VIRTUAL TABLE</span> issues_fts <span class="k">USING</span> fts5(text, content=issues, content_rowid=rowid);
```

## 04. Protocolo extensión ↔ daemon

WebSocket en ws://127.0.0.1:7331/ws?token=…. Frames de texto para control, binarios para audio.

### Pairing y autenticación

- La app Tauri abre una ventana de pairing de 60 s y muestra un código de 6 dígitos.
- La página de opciones de la extensión hace POST /pair con {code}.
- El daemon valida: ventana abierta, código correcto, y header Origin = chrome-extension://<id>. Guarda el id en config.toml.
- Devuelve un token de 32 bytes. La extensión lo guarda en chrome.storage.local.
- Todo WS posterior valida token + Origin contra la allowlist. Bind exclusivo a 127.0.0.1.

### Mensajes cliente → servidor

```
{ v:1, type:<span class="s">"hello"</span>,          ext_version, chrome, platform }
{ v:1, type:<span class="s">"session.start"</span>,  session:{ t0_wall, base_url, env } }
{ v:1, type:<span class="s">"events"</span>,         seq:12, items: Event[] }
{ v:1, type:<span class="s">"mark"</span>,           t }
{ v:1, type:<span class="s">"frame"</span>,          t, tab, jpeg_b64 }   <span class="c">// respuesta a capture.request</span>
{ v:1, type:<span class="s">"session.stop"</span>,   t }
{ v:1, type:<span class="s">"ping"</span> }
```

**Frames binarios (audio)**

```
offset 0   u8    magic = 0xA0
offset 1   u32le seq
offset 5   u64le t_ms          <span class="c">// desde t0_wall</span>
offset 13  i16le[320]          <span class="c">// 20 ms @ 16 kHz mono = 640 bytes</span>
                               <span class="c">// total 653 B/frame · 50 fps · ~32 KB/s</span>
```

### Mensajes servidor → cliente

```
{ v:1, type:<span class="s">"hello.ok"</span>,           daemon_version, session_dir }
{ v:1, type:<span class="s">"ack"</span>,                seq:12 }
{ v:1, type:<span class="s">"transcript.partial"</span>, utterance }        <span class="c">// para el popup</span>
{ v:1, type:<span class="s">"capture.request"</span>,    tab, t_target }    <span class="c">// pedí el frame más cercano</span>
{ v:1, type:<span class="s">"session.done"</span>,       report_path, issues:9 }
{ v:1, type:<span class="s">"error"</span>,              code, message }
```

### Resiliencia

- Outbox. Los eventos se escriben en IndexedDB antes de mandarse y solo se borran al recibir ack con seq ≥. Reconexión con backoff exponencial (250 ms → 8 s) y replay desde el último seq confirmado.
- Batching. Flush cada 500 ms o cada 50 eventos, lo que ocurra primero. mark y console.error fuerzan flush inmediato.
- Audio en desconexión. Buffer en memoria en el offscreen doc de hasta 30 s. Si se desborda, se descarta lo más viejo y se emite un evento audio_gap con la duración perdida.
- Crash del daemon. Los eventos ya llegados están en raw/events.ndjson (append-only, fsync cada 2 s) y el audio en raw/audio.pcm. qua recover <id> reconstruye la sesión desde ahí.

## 05. Extensión Chrome

**Manifest**

```
permissions:      [<span class="s">"tabs"</span>, <span class="s">"storage"</span>, <span class="s">"offscreen"</span>, <span class="s">"alarms"</span>, <span class="s">"scripting"</span>, <span class="s">"webNavigation"</span>]
host_permissions: [<span class="s">"<all_urls>"</span>]   <span class="c">// filtrado en runtime por config de proyectos</span>
commands:         { toggle_recording: <span class="s">"Ctrl+Shift+R"</span>, drop_mark: <span class="s">"Ctrl+Shift+E"</span> }
background:       { service_worker, type: <span class="s">"module"</span> }
```

### 5.1 Content script

Se inyecta en todos los orígenes configurados. Responsabilidades, en orden de ejecución:

- Instalación de hooks en document_start: patch de fetch, XMLHttpRequest, console.error/warn, history.pushState/replaceState. Todos preservan el comportamiento original y nunca tiran.
- Listeners en fase capture sobre document: click, focusin, input, submit, mouseover/mouseout, scroll, resize.
- Observers: PerformanceObserver para longtask y layout-shift; MutationObserver en document.body con conteo por ventana de 100 ms.
- Tracker de hover: en mouseover arranca timer; en mouseout, si dwell ≥ 400 ms emite hover. Sube al ancestro interactivo más cercano (button, a, input, select, textarea, [role], [onclick]) antes de emitir, para no anclar a un <span> interno.
- Builder de TargetRef (§5.2).
- Redacción (§12) antes de mandar nada al service worker.

### 5.2 Estrategia de selector

En cascada, primer match gana. Cada candidato se valida con document.querySelectorAll(sel).length === 1; si no es único, se pasa al siguiente nivel.

| # | Estrategia | Forma |
|---|---|---|
| 1 | testid | [data-testid="x"] — también data-test, data-cy |
| 2 | id | #x, descartado si matchea /^(:r\|radix-\|headlessui-\|«)/ (ids generados) |
| 3 | role-name | button[aria-label="Nuevo turno"] o [role="dialog"] button |
| 4 | css-path | Camino más corto único hasta un ancestro con id estable, con :nth-of-type. Máx. 5 niveles. Se omiten clases de Tailwind (ruidosas) salvo que no haya alternativa. |

### 5.3 Service worker

- FSM de sesión: idle → starting → recording → stopping → idle. Estado persistido en chrome.storage.session para sobrevivir el reciclado del worker.
- Ciclo de pestañas: onActivated, onUpdated, onRemoved, webNavigation.onHistoryStateUpdated.
- Transporte: dueño del WebSocket y del outbox en IndexedDB.
- Ring de screenshots: chrome.tabs.captureVisibleTab throttleado a 1 fps (el límite duro de Chrome es 2/s), JPEG q60 reescalado a 1280 px de ancho vía OffscreenCanvas. Se guardan los últimos 40 frames con su t en IndexedDB. El daemon pide retroactivamente el más cercano a un instante — así hay captura del momento aunque ya hayas navegado.
- Keepalive: el tráfico del WS (audio a 50 fps) ya resetea el timer de 30 s del worker. Como red de seguridad, chrome.alarms cada 25 s.

### 5.4 Offscreen document

```
chrome.offscreen.createDocument({
  url: <span class="s">"offscreen.html"</span>,
  reasons: [<span class="s">"USER_MEDIA"</span>],
  justification: <span class="s">"Captura de micrófono continua durante la sesión"</span>
})

getUserMedia({ audio: { channelCount:1, echoCancellation:false,
                        noiseSuppression:true, autoGainControl:true } })
  → AudioContext({ sampleRate: 16000 })      <span class="c">// resample nativo del navegador</span>
  → AudioWorkletNode(<span class="s">"pcm-tap"</span>)             <span class="c">// f32 → i16, frames de 320 muestras</span>
  → postMessage → service worker → WS binario
  + MediaRecorder(<span class="s">"audio/webm;codecs=opus"</span>)  <span class="c">// archivo de archivo, en paralelo</span>
```

> **⚠️ CUIDADO** — Trampa conocidaUn offscreen document no puede pedir el permiso de micrófono. Se otorga una sola vez desde options.html (mismo origen chrome-extension://<id>) y el offscreen lo hereda. El onboarding de la extensión tiene que forzar ese paso o el primer getUserMedia falla en silencio.

## 06. Daemon

**Crates**

tokio · axum (ws) · whisper-rs (features metal/cuda/vulkan) · voice_activity_detector (silero ONNX vía ort) · rusqlite (bundled) · serde · image (recortes) · git2 · clap · tracing · notify-rust.

### 6.1 Pipeline de audio

```
frames WS → jitter buffer (reordena por seq, ventana 200 ms)
          → ring buffer f32 · 16 kHz · 60 s
          → VAD silero, ventanas de 30 ms
               threshold 0.5 · min_speech 250 ms
               min_silence 600 ms · padding 300 ms a cada lado
          → segmento cerrado (o corte forzado a 25 s)
          → cola acotada (cap 8) → 1 worker whisper
          → Utterance → sesión + transcript.partial
```

> **DECISIÓN** — Parámetros de whisperlanguage="es", temperature=0.0, token_timestamps=true, suppress_blank=true, no_speech_thold=0.6, un solo contexto (no es thread-safe para inferencia paralela). A ~20× tiempo real en Apple Silicon la cola nunca se llena; --asr-workers N existe igual para máquinas lentas.

**Priming del prompt**

Es lo que más mueve la aguja en calidad de transcripción con spanglish técnico:

```
initial_prompt = read(<span class="s">"~/.qua/vocab.txt"</span>)             <span class="c">// vocabulario del usuario</span>
               + <span class="s">" "</span> + last_utterance.text.slice(-200)   <span class="c">// continuidad</span>

<span class="c">// vocab.txt sembrado por defecto:</span>
Agendi, Supabase, Next.js, Tailwind, modal, hover, viewport, sidebar,
endpoint, skeleton, toast, dropdown, padding, breakpoint, deploy, log,
componente, estado, spinner, placeholder, responsive, tooltip
```

**Gestión del modelo**

Descarga en el primer arranque desde Hugging Face a ~/.qua/models/, con verificación SHA-256 y barra de progreso vía la app. ggml-large-v3-turbo-q5_0.bin, ~574 MB. Fallback configurable a ggml-base (~148 MB) para máquinas sin aceleración.

### 6.2 CLI

```
quad                       <span class="c"># arranca el servidor (lo hace el sidecar)</span>
qua sessions [--project X] [--limit N]
qua show <id> [--json|--md]
qua recover <id>           <span class="c"># reconstruye desde raw/</span>
qua reprocess <id>         <span class="c"># re-corre VAD+ASR+correlador sin regrabar</span>
qua refine <id>            <span class="c"># pase LLM opcional (§8.3)</span>
qua export <id> --format md|json
qua doctor                 <span class="c"># chequea modelo, mic, puerto, pairing</span>
```

> **DECISIÓN** — Por qué reprocess importaDesacopla la grabación del procesamiento. Podés tunear los pesos del correlador y volver a correr sobre sesiones viejas sin regrabar nada — es lo que hace que el §7 sea iterable en vez de adivinanza.

## 07. El correlador

Acá está el producto. No es un join por timestamp: es un scoring con sesgo hacia atrás, porque uno habla después de ver la cosa.

### Paso 1 — Agrupar utterances en issues candidatos

Se fusionan utterances consecutivas si: gap < 1500 ms y no hay nav ni tab_switch entre medio y la duración combinada < 45 s.

Se fuerza corte si la utterance arranca con un marcador de cambio de tema:

```
/^\s*(otra cosa|después|además|ah,? y|bueno|otro tema|y acá|volviendo|aparte)/i
```

### Paso 2 — Filtro de ruido

Se descarta el grupo si: no_speech_prob > 0.6 · avg_logprob < −1.0 · el texto es solo muletillas (/^[\s,.]*(eh+|mm+|ah+|ok|bueno|a ver|dale|listo)[\s,.]*$/i) · menos de 3 palabras y marked === false.

### Paso 3 — Clasificación de deixis

Sobre el texto en minúsculas y sin acentos. Define hacia dónde sesgar el anclaje:

| Clase | Patrón | Efecto |
|---|---|---|
| POINTER | este\|esta\|esto\|ese\|esa\|eso\|acá\|aquí\|ahí\|el botón\|este campo\|este ícono | Prefiere hover y click · peso ×1.5 |
| ACTION | cuando (le doy\|hago clic\|clickeo\|toco\|aprieto)\|al (entrar\|abrir\|guardar) | Prefiere el click anterior · peso ×2 · adjunta timings |
| SCREEN | esta pantalla\|esta página\|esta vista\|esta sección\|el layout\|el header\|el sidebar | anchor.kind = "route" |
| GLOBAL | en general\|en toda la app\|en todos lados\|siempre que | anchor.kind = "session" |

### Paso 4 — Ventana de candidatos

```
t_ref = marked ? t_del_mark : t_start_del_grupo
W     = marked ? [t_ref − 2500, t_ref + 500]
                : [t_ref − 4500, t_ref + 1500]

candidatos = eventos en W de tipo:
  click · hover (dwell ≥ 400 ms) · focus_change · scroll_settle.top_target
```

La ventana asimétrica es deliberada: mira 4,5 s hacia atrás y solo 1,5 s hacia adelante. Cuando decís "este botón es muy chico", el hover ocurrió antes de que abrieras la boca.

### Paso 5 — Scoring

```
score(c) = base(c.k) × recency(c) × bias(c) × visibility(c)

base:        click 3.0 · hover 2.5 · focus 1.8 · scroll_top 1.0
recency(c) = exp(−|t_ref − c.t| / 2500)
bias(c)    = 1.5  si deixis POINTER y c.k ∈ {hover, click}
             2.0  si deixis ACTION  y c.k = click y c.t < t_ref
             1.0  en otro caso
visibility = 1.0 si c.target.visible y área > 0, si no 0.3
```

Los candidatos que resuelven al mismo `sel` se fusionan con **rendimientos decrecientes**, no sumando: `score_final = aporte_max + merge_extra_weight × suma_del_resto`, con `merge_extra_weight = 0.25` en `[correlator]`. Se conserva el `rect` más reciente.

> **CORRECCIÓN (2026-09-05, reportada por B3).** La versión original decía «se suman los scores». Eso está mal: los aportes del mismo `sel` no son evidencia independiente —scrollear hasta un elemento, enfocarlo y clickearlo son una sola interacción vista tres veces— así que sumarlos cuenta la misma evidencia varias veces y deja que N eventos débiles sobre un distractor le ganen a un hover sostenido más click sobre el elemento real. Anclaba al elemento equivocado con confianza 1.00, violando la regla de oro del paso 6.

### Paso 6 — Decidir el ancla

```
si deixis = SCREEN  → kind = <span class="s">"route"</span>
si deixis = GLOBAL  → kind = <span class="s">"session"</span>
si no:
  best, second = top-2 por score
  si best.score ≥ 2.0 y (second = ∅ o best.score / second.score ≥ 1.3)
       → kind = <span class="s">"element"</span>, target = best.target
  si no → kind = <span class="s">"route"</span>

max_posible(deixis) = 3.0 × bias(deixis) × 1.0 × 1.0   # POINTER → 4.5 · ACTION → 6.0 · sin deixis → 3.0
confidence = clamp(aporte_max / max_posible(deixis), 0, 1)   # del MAXIMO, no del score fusionado
             × 0.7 si el ratio best/second < 1.3
reason[]   = [<span class="s">"click −0.9s"</span>, <span class="s">"deixis:este"</span>, <span class="s">"hover 2.1s"</span>]
```

> **CORRECCIÓN (2026-09-05, reportada por B6).** La versión original normalizaba siempre
> contra `6.0`, el score máximo alcanzable solo con deixis ACTION (`click 3.0 × bias 2.0`).
> Con POINTER el máximo real es `3.0 × 1.5 = 4.5`, así que ni un match perfecto podía pasar
> de `0.75`, y con decaimiento de recencia un hover sostenido + click + deixis POINTER sobre
> el mismo elemento — el caso más nítido posible — salía con confianza 0.48: por debajo del
> umbral de screenshot del paso 9. El divisor pasa a depender de la clase de deixis en juego.
> Ver `docs/DECISIONS.md`, D-B6-01.

> **DECISIÓN** — Regla de oroAnte duda, degradar a route. Un issue anclado a la ruta correcta es útil; uno anclado al elemento equivocado manda al agente a editar el archivo equivocado, que es peor que no anclar.

### Paso 7 — Evidencia

Ventana E = [t_ref − 6000, t_ref + 4000], misma pestaña. Se adjuntan: eventos console (error/warn), net_fail, net_slow, long_task, layout_shift. Si hay un click en E seguido de mutation_burst o nav, se emite timings: [{label:"click → primer render", ms: Δ}].

### Paso 8 — Categoría y severidad

```
bug   ← evidence.console ≠ ∅ ∨ net_fail ∨ /error|falla|rompe|no anda|no funciona|bug/
perf  ← net_slow ∨ long_task ∨ /lento|tarda|demora|se cuelga|freeza|carga mucho/
copy  ← /dice|texto|redacción|typo|falta la tilde|el título|mal escrito/
ui    ← /chico|grande|color|espacio|padding|margen|alineado|centrado|se ve mal|feo/
idea  ← /estaría bueno|me gustaría|podría|sería bueno|debería|estaría copado/

precedencia: bug > perf > copy > ui > idea      default: ui
severidad:   high  si bug con console.error
             med   si perf o net_fail o /no anda|no funciona/
             low   resto
```

### Paso 9 — Screenshot

Para issues con kind = "element" y confidence ≥ 0.5, el daemon manda capture.request con t_ref. La extensión devuelve el frame del ring más cercano. El daemon recorta al rect del target con 24 px de padding, y guarda el recorte más un contexto de 640 px de ancho en assets/<issue>.png.

> **DECISIÓN** — Cómo se ajusta esto sin adivinarTodos los umbrales viven en [correlator] de config.toml. La tarea F1 genera sesiones sintéticas con anclaje esperado conocido; el test mide precisión de anclaje sobre ese set. Tunear = cambiar el toml y correr qua reprocess sobre las sesiones reales guardadas.

## 08. Formato de salida

### 8.1 report.md

```
<span class="k"># QUA — Agendi</span>
2026-09-04 14:32 · 6m 52s · rama `main` @ `9f21ac3` (dirty) · 9 issues

| # | Categoría | Sev | Confianza | Ancla |
|---|-----------|-----|-----------|-------|
| 1 | ui   | low  | 0.91 | `button[data-testid="nuevo-turno"]` |
| 2 | bug  | high | 0.74 | `/agenda/semana` |
| 3 | perf | med  | 0.88 | `form#filtros` |

<span class="k">---</span>

<span class="k">## 01 · ui · low</span>
<span class="k">**Dicho**</span> (00:02:14) — "este botón de nuevo turno es re chico, en mobile
casi no lo encuentro, y además tarda un montón en abrir el modal"

<span class="k">**Ancla**</span> `button[data-testid="nuevo-turno"]` · confianza 0.91
  · hover 2.1s · deixis:este · click −0.9s
<span class="k">**Ruta**</span> `/agenda/semana` (pestaña 42, volvió desde Supabase a las 00:01:58)
<span class="k">**Fuente**</span> `src/components/AgendaHeader.tsx:42` — `AgendaHeader > Button`
<span class="k">**Geometría**</span> 88×32 px @ (1180, 96) · viewport 1512×857 @2x
<span class="k">**Clases**</span> `px-3 py-1.5 text-sm rounded-md bg-zinc-900 text-zinc-50`
<span class="k">**Timing**</span> click → primer render del modal: 1412 ms
<span class="k">**Captura**</span> ![](assets/i01.png)
```

Se ordena por severidad y después por confianza. Los issues con confidence < 0.35 caen en una sección final Sin anclar con el texto crudo y la ruta — no se descartan, pero no ensucian la lista principal.

### 8.2 Archivos por sesión

```
~/.qua/sessions/2026-09-04T14-32-11Z-a3f9/
  session.json        <span class="c">// todo, incluidos los 147 eventos</span>
  issues.json         <span class="c">// solo issues — es lo que lee el agente</span>
  report.md           <span class="c">// legible por humano y por agente</span>
  transcript.txt      <span class="c">// texto plano con timestamps</span>
  audio.opus          <span class="c">// para reescuchar</span>
  assets/i01.png …
  raw/events.ndjson   <span class="c">// append-only, crash-safe</span>
  raw/audio.pcm       <span class="c">// idem; borrable tras el render</span>
```

Presupuesto de tokens de una sesión de 7 min: report.md ≈ 2,8 k tokens sin capturas. Cada PNG recortado suma ~1,2 k. issues.json solo, ≈ 1,9 k.

### 8.3 Refinamiento opcional

qua refine <id> manda issues.json a un LLM y reescribe cada issue como título + cuerpo de ticket, agrupando duplicados. Nunca corre solo: es un comando explícito, fuera del daemon, y el resultado va a report.refined.md sin pisar el original.

## 09. App Tauri

Tauri 2, ícono en la barra de menú. No captura nada: gestiona.

- Sidecar: lanza quad como proceso externo, health check contra GET /health cada 5 s, reinicio automático con backoff. Log unificado en ~/.qua/logs/.
- Hotkey global (tauri-plugin-global-shortcut): ⌘⇧R start/stop, ⌘⇧E marcador. Funciona con cualquier app en foco, que es la única cosa que la extensión sola no puede dar.
- Tray: estado (idle · ● grabando · procesando), duración corriendo, medidor de nivel de mic en vivo, selector de dispositivo de entrada.
- Ventana de sesiones: lista, vista del report.md renderizado, reproductor de audio, botones reprocess · refine · revelar en Finder · copiar ruta.
- Onboarding: descarga del modelo con progreso, permiso de micrófono del SO, ventana de pairing con el código de 6 dígitos, y test de humo (qua doctor).

> **DECISIÓN** — Enfoque de plataformaLa app se pule primero en macOS (tray, permisos, notarización). Windows y Linux funcionan desde el día uno porque Tauri, Rust y la extensión son portables — lo que falta ahí es empaquetado y pulido, no arquitectura.

## 10. Servidor MCP

Binario qua-mcp, transporte stdio, solo lectura sobre SQLite en modo WAL.

| Herramienta | Parámetros | Devuelve |
|---|---|---|
| qua_sessions_list | limit, since, project | id, fecha, proyecto, duración, cantidad de issues, estado |
| qua_session_get | id, include_events=false | report.md + issues.json |
| qua_issues_pending | project, min_confidence, category | Issues con exported_to IS NULL, ordenados por severidad |
| qua_issues_search | query, project | Búsqueda FTS5 sobre el texto de todos los issues |
| qua_issue_mark_exported | issue_id, ticket_url | OK única escritura |

> **DECISIÓN** — Por qué mark_exported cierra el círculoSin eso, cada vez que le pedís al agente "creá los tickets de las sesiones de esta semana" te duplica todo. Con eso, el flujo es: issues_pending → tasks_create de Zygos → mark_exported con la URL de Linear. Idempotente.

## 11. Source mapping en React 19

Tu stack es Next 16 · React 19 · Turbopack · Tailwind v4. Eso invalida el camino habitual y obliga a invertir la cascada.

> **⚠️ CUIDADO** — Lo que no sirve en tu stackfiber._debugSource se eliminó en React 19. Y Next 16 compila con Turbopack/SWC, así que no hay pipeline de Babel donde meter un plugin sin salirse del camino soportado. El plan original de "plugin de build primero" no aplica: pasa a ser refuerzo opcional.

**Cascada real, tier 1 → 4**

| Tier | Mecanismo | Rinde | Requiere |
|---|---|---|---|
| 1 | data-qua-src en el DOM | archivo + línea + columna | Plugin de build (opcional) |
| 2 | Parseo de fiber._debugStack | archivo + línea | React 19 en dev |
| 3 | Cadena de _debugOwner.type.name | ["AgendaHeader","Button"] | React en dev |
| 4 | Selector + texto + clases | El agente grepea | Nada |

**Resolver en runtime (tiers 2 y 3)**

```
<span class="c">// Publicado como @qua/source-resolver, usado por el content script</span>
<span class="k">function</span> fiberOf(el) {
  <span class="k">const</span> k = Object.keys(el).find(k => k.startsWith(<span class="s">"__reactFiber$"</span>));
  <span class="k">return</span> k ? el[k] : null;
}

<span class="c">// Tier 3 — cadena de componentes, siempre disponible en dev</span>
<span class="k">function</span> componentChain(fiber, max = 4) {
  <span class="k">const</span> out = [];
  <span class="k">let</span> f = fiber;
  <span class="k">while</span> (f && out.length < max) {
    <span class="k">const</span> n = f.type?.displayName ?? f.type?.name;
    <span class="k">if</span> (n && /^[A-Z]/.test(n)) out.unshift(n);
    f = f._debugOwner;
  }
  <span class="k">return</span> out;
}

<span class="c">// Tier 2 — React 19 guarda un Error de creación en dev</span>
<span class="k">function</span> sourceFromStack(fiber) {
  <span class="k">const</span> stack = fiber?._debugStack?.stack;
  <span class="k">if</span> (!stack) <span class="k">return</span> null;
  <span class="k">for</span> (<span class="k">const</span> line <span class="k">of</span> stack.split(<span class="s">"\n"</span>).slice(1, 8)) {
    <span class="k">const</span> m = line.match(/\(?(?:turbopack|webpack-internal|file):\/{2,3}(?:\[project\]\/)?(.+?):(\d+):(\d+)\)?/);
    <span class="k">if</span> (!m) <span class="k">continue</span>;
    <span class="k">const</span> file = m[1].replace(/^\.\//, <span class="s">""</span>).split(<span class="s">"?"</span>)[0];
    <span class="k">if</span> (/node_modules|react-dom|\/next\//.test(file)) <span class="k">continue</span>;
    <span class="k">return</span> { file, line: +m[2], col: +m[3], tier: 2 };
  }
  <span class="k">return</span> null;
}
```

El daemon normaliza file contra projects[].repo del config y verifica que exista en disco. Si no existe, degrada el tier a 3 en vez de escribir una ruta mentirosa en el reporte.

**Refuerzo opcional (tier 1)**

@qua/babel-plugin-source y @qua/vite-plugin-source estampan data-qua-src="src/components/Button.tsx:42:11" en cada apertura de JSX, solo en dev. Sirven para Vite, CRA, Remix, y para Next si alguna vez optás por Babel. Se construyen igual porque son 60 líneas y hacen determinístico lo que en el tier 2 es heurístico — pero QUA funciona sin ellos en tu stack actual.

## 12. Privacidad

- Cero egreso de red. El daemon bindea 127.0.0.1 exclusivamente. La única salida a internet es la descarga del modelo (una vez) y el qua refine explícito.
- Nunca se capturan valores de inputs. Solo name, type y label asociado. Los campos type="password", autocomplete de tarjeta y todo lo que matchee /pass|card|cvv|token|secret|ssn|dni|cbu/i se omiten enteros.
- Redacción por subárbol. Nada bajo [data-private] ni bajo los selectores de capture.redact_selectors aporta texto: TargetRef.text sale como "[redactado]". La geometría y el selector sí se conservan.
- Screenshots. Antes de subir un frame al daemon, el service worker pinta rectángulos opacos sobre los rect de todos los nodos redactados visibles.
- Query strings. Los parámetros de URL se recortan a una allowlist configurable; el resto se reemplaza por ?….
- Retención. retention_days en el config (default 90). Un GC al arrancar borra raw/ de sesiones ya renderizadas y sesiones enteras vencidas.

## 13. Repo y configuración

```
qua/
  packages/
    protocol/          <span class="c">// TS + Zod — FUENTE DE VERDAD de los tipos</span>
    source-resolver/   <span class="c">// tiers 2 y 3 de React (§11)</span>
    babel-plugin-source/
    vite-plugin-source/
  extension/           <span class="c">// WXT + TypeScript</span>
    entrypoints/{background,content,offscreen,popup,options}
  crates/
    qua-protocol/   <span class="c">// espejo Rust + tests contra fixtures</span>
    qua-core/       <span class="c">// ingest · asr · correlate · render · store</span>
    quad/           <span class="c">// binario axum</span>
    qua-mcp/        <span class="c">// binario MCP stdio</span>
  apps/qua-app/     <span class="c">// Tauri 2</span>
  fixtures/            <span class="c">// sesiones doradas — contrato compartido TS↔Rust</span>
  .github/workflows/
```

**~/.qua/config.toml**

```
[daemon]
port = 7331
retention_days = 90

[asr]
model = <span class="s">"large-v3-turbo-q5_0"</span>
language = <span class="s">"es"</span>
workers = 1
vad_threshold = 0.5
min_silence_ms = 600
min_speech_ms = 250

[capture]
screenshot_fps = 1
screenshot_buffer = 40
mask_inputs = true
redact_selectors = [<span class="s">"[data-private]"</span>, <span class="s">".sensitive"</span>]
url_param_allowlist = [<span class="s">"page"</span>, <span class="s">"tab"</span>, <span class="s">"view"</span>]

[correlator]
window_back_ms = 4500
window_fwd_ms = 1500
decay_ms = 2500
min_score = 2.0
dominance_ratio = 1.3

[[projects]]
label = <span class="s">"Agendi"</span>
origins = [<span class="s">"http://localhost:3000"</span>, <span class="s">"https://agendi.app"</span>]
repo = <span class="s">"/Users/gabrielfunes/Projects/personal/agendi"</span>

[[projects]]
label = <span class="s">"Portfolio"</span>
origins = [<span class="s">"http://localhost:3001"</span>]
repo = <span class="s">"/Users/gabrielfunes/Projects/personal/portfolio-2026"</span>
```

## 14. Plan de agentes

Trece tareas en cuatro olas. La clave del paralelismo está en F0 y F1: cerrar los contratos y fabricar sesiones sintéticas hace que el correlador y el renderer se construyan y se testeen sin que existan ni la extensión ni whisper.

| ID | Tarea | Dep. | Entregable | Criterio de aceptación |
|---|---|---|---|---|
| F0 | Scaffold + contratos | — | Monorepo, packages/protocol con Zod, JSON Schema generados, crates/qua-protocol, esquema SQLite, CI | Las fixtures de fixtures/ parsean idénticas en TS y en Rust; cargo test y pnpm test verdes |
| F1 | Generador sintético + harness | F0 | qua-synth: genera events.ndjson + utterances.json realistas con el anclaje esperado anotado | 20 escenarios cubriendo las 4 clases de deixis, cambio de pestaña, error de consola y ancla ambigua |
| A1 | Content script | F0 | Hooks, listeners, observers, tracker de hover, builder de TargetRef, redacción | En una página de prueba emite los 17 tipos de evento; el selector reidentifica el mismo nodo tras un re-render; cero excepciones con los hooks puestos |
| A2 | Service worker | F0 | FSM, ciclo de pestañas, WS + outbox IndexedDB, ring de screenshots, keepalive | Sesión de 10 min con 5 cambios de pestaña y el daemon caído 30 s en el medio: cero eventos perdidos tras el replay |
| A3 | Offscreen + UI | F0 | AudioWorklet PCM, MediaRecorder opus, popup con transcript vivo, options con pairing y grant de mic | El audio sigue ininterrumpido al cambiar de pestaña, navegar y cerrar la pestaña de origen; PCM validado a 16 kHz mono |
| B1 | Daemon: servidor y store | F0 | axum WS, pairing, ingesta, ndjson append, SQLite WAL, recover, /health | Ingesta de 100 k eventos sin pérdida; kill -9 a mitad de sesión y qua recover reconstruye |
| B2 | Daemon: audio y ASR | F0 | Jitter buffer, ring, silero VAD, pool whisper, descarga del modelo, priming del prompt | WER razonable sobre 5 min de audio en español grabado por vos; latencia de segmento < 1 s en M-series; sin alucinaciones en silencio |
| B3 | Correlador | F0, F1 | Los 9 pasos de §7, umbrales desde config | ≥ 85 % de anclaje correcto sobre los 20 escenarios de F1; ningún caso ambiguo anclado a elemento con confianza > 0.5 |
| B4 | Renderer y CLI | F0, F1 | report.md, issues.json, recorte de PNG, todos los subcomandos de §6.2 | El markdown de §8.1 se reproduce exacto desde una fixture; reprocess es idempotente |
| C1 | App Tauri | B1 | Tray, sidecar, hotkey global, medidor de mic, navegador de sesiones, onboarding | Build firmado en macOS; el hotkey dispara con Chrome en segundo plano; el sidecar se reinicia solo si lo matás |
| D1 | Servidor MCP | F0 | Binario stdio con las 5 herramientas de §10 | Claude Code lo descubre y lista sesiones; mark_exported hace que issues_pending deje de devolver ese issue |
| E1 | Source mapping | F0 | source-resolver con los 4 tiers + los dos plugins de build | Sobre portfolio-2026 en dev, resuelve archivo + línea correctos para ≥ 8 de 10 elementos probados |
| G1 | Integración y packaging | todas | Test E2E con Chrome headless + daemon real, .dmg / .msi / .AppImage, README | Sesión grabada de punta a punta produce un report.md válido en CI |

### Olas

- Ola 0 — ContratosF01 agente · secuencial     Bloquea todo. Nadie arranca hasta que las fixtures doradas parseen en los dos lenguajes. Es la tarea más importante del plan.
- Ola 1 — Construcción paralelaF1 · A1 · A2 · A3 · B1 · B2 · D1 · E18 agentes     Ocho tareas sin dependencias entre sí. Cada una tiene un contrato cerrado en F0 y no necesita ver el código de las otras.
- Ola 2 — Lógica y shellB3 · B4 · C13 agentes     B3 y B4 arrancan apenas F1 entrega las fixtures, sin esperar a la extensión ni a whisper. C1 arranca apenas B1 expone /health.
- Ola 3 — IntegraciónG11 agente     Cablear todo junto, E2E y empaquetado.

### Reglas para los subagentes

- Nadie modifica packages/protocol ni fixtures/ fuera de F0. Si una tarea necesita un cambio de contrato, lo reporta en vez de aplicarlo — un cambio unilateral rompe en silencio a las otras siete.
- Cada tarea entrega tests que corren sin las demás. Si tu test necesita otro componente, mockealo contra la fixture.
- Los umbrales van a config.toml, nunca hardcodeados. Es lo que hace posible tunear el correlador sin recompilar.
- Una tarea = una rama = un PR. Los criterios de aceptación de la tabla son la definición de "listo".

## 15. Riesgos conocidos

| Riesgo | Mitigación |
|---|---|
| El service worker MV3 se recicla a los 30 s de inactividad y corta la sesión | El audio fluye a 50 fps sobre el WS, lo que resetea el timer continuamente. chrome.alarms cada 25 s como red. Estado en chrome.storage.session para rehidratar si igual muere. |
| Whisper alucina texto sobre silencio | El VAD compuerta antes de llamar a whisper, y se descarta por no_speech_prob > 0.6 y avg_logprob < −1.0. |
| Selectores frágiles: el reporte apunta a un nodo que ya no existe | Cascada de 4 estrategias con validación de unicidad, más component[] y src como respaldo independiente del DOM. |
| El permiso de micrófono falla silenciosamente en el offscreen doc | Onboarding obligatorio desde options.html; qua doctor lo verifica y la app lo bloquea hasta resolverlo. |
| captureVisibleTab tiene límite de 2 llamadas/segundo | Throttle duro a 1 fps y ring retroactivo: no hace falta capturar en el instante exacto. |
| El anclaje sale mal seguido y el reporte no sirve | Es el riesgo real del proyecto. Se ataca con el harness de F1 (métrica objetiva), reprocess (iterar sin regrabar) y la regla de degradar a route ante duda. |
| Tier 2 de source mapping se rompe con una versión de React o Turbopack | Degradación explícita a tier 3, verificación de existencia del archivo en disco, y los plugins de build como camino determinístico si hace falta. |
| El transcript queda largo y con poca señal | Filtro de muletillas, agrupación por marcadores de tema, y sección "Sin anclar" separada para no ensuciar la lista principal. |

