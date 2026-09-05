# extension

Extensión Chrome MV3 con WXT (§05). Stub creado por F0, alcance repartido en:

- **A1 ✅** — `entrypoints/content/`: hooks, listeners, observers, tracker de hover,
  builder de `TargetRef`, redacción. Ver más abajo.
- **A2** (pendiente) — `entrypoints/background/`: FSM de sesión, ciclo de pestañas,
  WebSocket + outbox en IndexedDB, ring de screenshots, keepalive.
- **A3** (pendiente) — `entrypoints/offscreen/`, `popup/`, `options/`: AudioWorklet PCM,
  MediaRecorder opus, transcript vivo, pairing y grant de micrófono.

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
