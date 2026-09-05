# apps/qua-app

App Tauri 2 en la barra de menú (§09). **Stub creado por F0** — la implementa la tarea **C1**,
que arranca apenas B1 exponga `GET /health`.

No captura nada: gestiona.

- Sidecar: lanza `quad`, health check cada 5 s contra `GET /health`, reinicio con backoff.
- Hotkey global (`tauri-plugin-global-shortcut`): ⌘⇧R start/stop, ⌘⇧E marcador.
- Tray: estado, duración, medidor de nivel de mic, selector de dispositivo.
- Ventana de sesiones: lista, `report.md` renderizado, reproductor, `reprocess` · `refine`.
- Onboarding: descarga del modelo, permiso de micrófono del SO, pairing de 6 dígitos, `qua doctor`.

El contrato con el daemon está en `@qua/protocol` (`HealthResponse`, `PairRequest`,
`PairResponse`) y en `qua-protocol` del lado Rust.
