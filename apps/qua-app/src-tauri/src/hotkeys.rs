//! Hotkeys globales (§09): ⌘⇧R start/stop, ⌘⇧E marcador. Es lo único que la extensión
//! sola no puede dar — tienen que disparar con cualquier app en foco, Chrome incluido.
//!
//! **Límite conocido, ver `docs/DECISIONS.md` (C1-01):** el canal para que este
//! proceso le ordene a la extensión arrancar/parar una sesión de verdad no existe en
//! §04 — los mensajes `session.start`/`session.stop`/`mark` son cliente→servidor
//! (los manda la extensión), no hay un mensaje servidor→cliente para empujar la orden
//! en sentido contrario. Agregarlo es un cambio de contrato de `packages/protocol`,
//! fuera del alcance de C1. Mientras tanto el hotkey togglea el estado local del tray
//! y lo deja registrado en el log unificado — queda probado que el atajo global
//! dispara con cualquier app en foco (el criterio de aceptación de §14), pero todavía
//! no mueve una grabación real del otro lado del WS.

use tauri::AppHandle;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use crate::hotkeys_actions;

fn toggle_shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::SUPER.union(Modifiers::SHIFT)), Code::KeyR)
}

fn mark_shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::SUPER.union(Modifiers::SHIFT)), Code::KeyE)
}

pub fn register(app: &AppHandle) -> anyhow::Result<()> {
    app.plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(|app, shortcut, event| {
                if event.state() != ShortcutState::Pressed {
                    return;
                }
                if shortcut == &toggle_shortcut() {
                    hotkeys_actions::toggle_recording(app);
                } else if shortcut == &mark_shortcut() {
                    hotkeys_actions::drop_mark(app);
                }
            })
            .build(),
    )?;
    app.global_shortcut().register(toggle_shortcut())?;
    app.global_shortcut().register(mark_shortcut())?;
    tracing::info!("hotkeys globales registrados: Cmd+Shift+R, Cmd+Shift+E");
    Ok(())
}
