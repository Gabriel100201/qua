# extension

Extensión Chrome MV3 con WXT (§05). **Stub creado por F0** — solo la estructura de
`entrypoints/`. La implementan:

- **A1** — `entrypoints/content/`: hooks, listeners, observers, tracker de hover,
  builder de `TargetRef`, redacción.
- **A2** — `entrypoints/background/`: FSM de sesión, ciclo de pestañas, WebSocket +
  outbox en IndexedDB, ring de screenshots, keepalive.
- **A3** — `entrypoints/offscreen/`, `popup/`, `options/`: AudioWorklet PCM,
  MediaRecorder opus, transcript vivo, pairing y grant de micrófono.

Los tres consumen los tipos desde `@qua/protocol` y no redefinen nada.
