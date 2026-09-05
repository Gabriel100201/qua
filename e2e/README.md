# G1 — E2E de punta a punta

Criterio de aceptación de G1 (§14): "Sesión grabada de punta a punta produce un
`report.md` válido". Este directorio es exactamente eso: un script, no un test de
`vitest`/`cargo test`, porque necesita Chrome real, un daemon compilado, y toca la
red la primera vez que baja el modelo whisper (~148 MB, cacheados después en
`~/.qua/models/`).

**No corre con `pnpm test`.** Es deliberado — un test tan pesado no pertenece al gate
rápido de CI. Se corre a mano o desde un pipeline separado:

```
pnpm --filter @qua/e2e run e2e
```

La primera vez, instalá el navegador que usa (una sola vez, no hace falta repetirlo):

```
npx --prefix e2e playwright install chromium
```

## Qué hace

1. Compila `@qua/protocol` + `@qua/source-resolver` (dependencias de la extensión),
   la extensión (`wxt build`) y el daemon (`cargo build -p quad`).
2. Lanza un Chrome real con la extensión cargada vía `--load-extension` +
   `--user-data-dir` temporal — **sin activar el modo desarrollador a mano** (ver
   `docs/DECISIONS.md` D-G1-05 para por qué usa el Chrome que maneja Playwright y no
   el de `/Applications`: Google Chrome de consumo bloquea `--load-extension` sin ese
   toggle prendido en el perfil).
3. Arranca el daemon (`quad`) real contra un `--data-dir` temporal, y lo empareja con
   la extensión escribiendo `config.toml` directamente (sin pasar por el flujo manual
   de pairing de 6 dígitos — no hay humano para tipearlo).
4. Abre una página local de prueba y le manda `qua:start-session` a la extensión.
5. Hace un hover real sobre un botón (§05.1, dwell ≥ 400 ms) mientras Chrome le
   inyecta a `getUserMedia` el WAV de `fixtures/audio/es-hover-sidebar.wav` (de B2)
   como si fuera el micrófono real, vía `--use-file-for-fake-audio-capture` +
   `--use-fake-device-for-media-stream` — audio real, no un mock.
6. Manda `qua:stop-session` y espera a que el daemon escriba `report.md` (ASR +
   correlador + render corren en `finalize()`, ver D-G1-01/06/08).
7. Valida que `report.md` existe, tiene el header de §8.1, y que `session.json`
   quedó en `status: "ready"` con eventos reales. Si la transcripción salió vacía,
   avisa pero no falla — el contenido de voz depende de que Chrome soporte bien el
   audio fake, que puede variar entre versiones; la validez estructural del reporte
   no.

## Qué encontró

Corriéndolo de verdad (no leyendo el código) aparecieron cinco bugs reales que
ningún test unitario existente detectaba — cada uno documentado con el detalle
completo en `docs/DECISIONS.md`:

- **D-G1-03** — el content script mandaba `qua:event` y el service worker esperaba
  `qua:events`: ningún evento de la extensión llegaba nunca al daemon.
- **D-G1-06** — nadie normalizaba `t` contra `t0_wall`: con un reloj real, la
  duración de la sesión salía en cientos de miles de horas.
- **D-G1-07** — el `AudioWorklet` vivía en una ruta que WXT no compila; nunca se
  serviría en producción (`addModule` fallaba con "Network error").
- **D-G1-08** — `chrome.runtime.sendMessage` no preserva `Uint8Array` entre
  contextos de extensión: los frames de audio llegaban, pero como objeto plano, no
  como bytes reconocibles.

## Qué queda pendiente

- **Capturas de pantalla** (D-G1-01): el paso 9 del correlador pide un recorte en
  vivo por WS; acá la sesión ya cerró cuando corre el pipeline, así que
  `report.md` sale sin capturas. Documentado, no bloqueante para este criterio.
- Solo se probó el camino feliz (una sesión corta, un hover, un WAV). No hay
  todavía un caso de desconexión del daemon a mitad de una sesión E2E real (eso sí
  está cubierto en Rust, `kill_and_recover.rs`, con el daemon real pero sin Chrome).
