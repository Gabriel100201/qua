# extension

Extensión Chrome MV3 con WXT (§05). Stub creado por F0, alcance repartido en:

- **A1 ✅** — `entrypoints/content/`: hooks, listeners, observers, tracker de hover,
  builder de `TargetRef`, redacción. Ver más abajo.
- **A2** (pendiente) — `entrypoints/background/`: FSM de sesión, ciclo de pestañas,
  WebSocket + outbox en IndexedDB, ring de screenshots, keepalive.
- **A3 ✅** — `entrypoints/offscreen/`, `popup/`, `options/`: AudioWorklet PCM,
  MediaRecorder opus, transcript vivo, pairing y grant de micrófono. Ver más abajo.

Los tres consumen los tipos desde `@qua/protocol` y no redefinen nada.

## Content script (A1)

`entrypoints/content/`:

- `main.ts` — `startQuaContentScript(opts)`: instala todo e emite los eventos iniciales
  (`nav` load + `viewport`). Devuelve un teardown (lo usan los tests).
- `index.ts` — punto de entrada real; se autoarranca solo dentro de una extensión de
  verdad. El wiring con `defineContentScript`/manifest de WXT queda para A2/G1 (comparten
  el `wxt.config.ts` del proyecto — ver `docs/DECISIONS.md` D-09).
- `lib/hooks.ts` — patch de `fetch`, `XMLHttpRequest`, `console.error`/`warn` +
  `onerror`/`unhandledrejection`, `history.pushState`/`replaceState` + `popstate`.
- `lib/listeners.ts` — listeners en fase capture (`click`, `focusin`, `input` con
  debounce 800 ms, `submit`, `scroll` con settle de 150 ms, `resize` con debounce
  300 ms) y el tracker de hover (dwell ≥ 400 ms, sube al ancestro interactivo).
- `lib/observers.ts` — `PerformanceObserver` (`longtask`, `layout-shift`) y
  `MutationObserver` (`mutation_burst`, > 20 mutaciones en 100 ms).
- `lib/selector.ts` — cascada de §5.2 (testid → id → role-name → css-path).
- `lib/target.ts`, `lib/field.ts`, `lib/dom.ts` — builder de `TargetRef`/`FieldRef`.
- `lib/redact.ts` — redacción de §12 (subárboles privados, campos sensibles, query
  strings).
- `lib/source-resolver.ts` — interfaz `ComponentSourceResolver` hacia `@qua/source-resolver`
  (E1). Hoy ese paquete es un stub, así que degrada siempre a un resolver nulo — el día que
  E1 exporte `createSourceResolver()`, se recoge solo, sin tocar A1.
- `lib/mark.ts`, `lib/tab-events.ts` — ver `docs/DECISIONS.md` D-09: `tab_switch`,
  `tab_close` y el disparo real de `mark` no pueden nacer en el content script (necesitan
  `chrome.tabs`/`chrome.commands`, que solo existen en el service worker). Acá quedan los
  builders y el relay que A2 va a usar.

**Tests:** `pnpm --filter @qua/extension test` (`tsc --noEmit` + `vitest run`, ambiente
jsdom). `entrypoints/content/test/content-script.test.ts` corre el content script completo
sobre `test/fixtures/page.html`, dispara los 17 tipos de evento que no son `audio_gap` y
verifica que el selector reidentifica el mismo nodo después de un re-render.

## Offscreen + popup + options (A3)

Alcance de §5.4: captura de micrófono continua, transcript en vivo del popup, y el
onboarding crítico de options.html. El service worker (A2) no existía todavía al escribir
esto — el contrato completo offscreen ↔ SW y popup ↔ SW queda documentado en
`docs/DECISIONS.md` D-11 a D-15, con tipos y guards ya armados para que A2 los consuma sin
re-diseñar nada.

### `entrypoints/offscreen/` — micrófono → PCM 16 kHz + archivo opus

- `lib/pcm-framer.ts` — `PcmFramer`: acumula bloques f32 (los quanta de 128 muestras que
  entrega `AudioWorkletProcessor.process()`) y arma frames de 320 muestras (20 ms @ 16 kHz),
  codificados con `encodeAudioFrame` de `@qua/protocol` — no reimplementa el layout de §04,
  lo reusa de la fuente de verdad. El `t_ms` se deriva contando muestras, no leyendo el
  reloj por frame (D-14). **Acá vive el criterio de aceptación de A3**: el test reproduce
  byte a byte la fixture dorada `fixtures/audio-frame.{bin,json}` de F0 a partir de muestras
  f32 equivalentes.
- `worklet/pcm-tap-processor.ts` — el `AudioWorkletProcessor` real registrado como
  `"pcm-tap"` (§5.4). Corre en `AudioWorkletGlobalScope`; declara sus propios tipos porque
  `lib.dom` no los trae (D-15). Pegamento fino sobre `PcmFramer` — sin lógica propia que
  testear aparte.
- `lib/audio-capture.ts` — `AudioCapture`: orquesta `getUserMedia` (constraints exactas de
  §5.4) → `AudioContext` a 16 kHz → `AudioWorkletNode("pcm-tap")` → `MediaRecorder` opus en
  paralelo. Todas las fábricas son inyectables (jsdom no implementa Web Audio) — los tests
  mockean `getUserMedia`/`AudioContext`/`AudioWorkletNode`/`MediaRecorder` enteros.
- `lib/gap-buffer.ts` — `GapBuffer`: buffer de 30 s en memoria para cuando el WS está caído
  (§04 "Resiliencia"), descarta lo más viejo al desbordar y reporta la duración perdida.
- `lib/messages.ts` — contrato `chrome.runtime` con el service worker (D-11): `qua:start-capture`,
  `qua:stop-capture`, `qua:connection-state` de entrada; `qua:audio-frame`, `qua:audio-gap`,
  `qua:capture-started`, `qua:capture-error`, `qua:recording-chunk` de salida.
- `main.ts`/`index.ts`/`index.html` — wiring real con `chrome.offscreen`, mismo patrón
  framework-agnóstico que A1 (se autoarranca solo dentro de una extensión real).

### `entrypoints/popup/` — start/stop, duración, transcript en vivo, contador de eventos

- `lib/status-client.ts` — `StatusClient`: wrapper de `chrome.runtime` hacia el service
  worker (`qua:get-status`/`qua:start-session`/`qua:stop-session`/`qua:trigger-mark`, más
  los pushes `qua:status`/`qua:transcript-partial`). Nunca tira: sin SW del otro lado,
  degrada a `IDLE_STATUS`.
- `lib/controller.ts` — `startPopupController`: cablea los botones, la duración en vivo
  (tickea cada segundo mientras graba), el transcript (`transcript.partial`, §04, recorta a
  las últimas N líneas) y el contador de eventos. Recibe el DOM ya armado — testeable con
  jsdom sin `chrome`.
- `lib/format.ts` — `formatDuration` (`mm:ss`, `hh:mm:ss` si pasa la hora).

### `entrypoints/options/` — el paso crítico de §5.4 y el pairing de §04

- `lib/mic-permission.ts` — **el bloque "⚠️ CUIDADO" de §5.4**: un offscreen document no
  puede pedir el permiso de micrófono, así que `options.html` (mismo origen
  `chrome-extension://<id>`) lo pide una vez con `grantMicPermission()` y suelta el track de
  inmediato — el offscreen doc hereda el permiso del origen cuando arranca de verdad.
  `checkMicPermission()` pinta el estado actual sin re-disparar el prompt.
- `lib/pairing.ts` — `pair(code)`: `POST /pair` (§04) contra `127.0.0.1:<puerto>` con el
  código de 6 dígitos, valida la respuesta con `PairResponseSchema` de `@qua/protocol` y
  guarda el token en `chrome.storage.local`.
- `lib/controller.ts` — `startOnboardingController`: cablea el botón de mic y el form de
  pairing sobre el DOM ya armado.

**Tests:** mismo comando (`pnpm --filter @qua/extension test`). Las suites de A3
(`entrypoints/{offscreen,popup,options}/**/*.test.ts`) no dependen de A1/A2 ni de un
navegador real — mockean `getUserMedia`/`AudioContext`/`MediaRecorder`/`chrome.runtime`/
`fetch` por completo.
