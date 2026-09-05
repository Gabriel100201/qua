//! Acciones compartidas entre el hotkey global y el ítem equivalente del menú del
//! tray — dos disparadores, un solo camino de código.
//!
//! Desde D-P1-01, además de reflejar el estado local del tray (§09), dispara
//! `POST /control` al daemon — el mensaje `session.control` de `packages/protocol`
//! reenviado por B1 al WS conectado es lo que cierra la brecha de D-C1-01: ya mueve
//! una sesión real de la extensión, no solo el tray.

use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager};

use crate::state::{AppState, RecState};
use crate::tray;

pub fn toggle_recording(app: &AppHandle) {
    let state = app.state::<Arc<AppState>>();
    let next = match state.rec_state() {
        RecState::Idle => RecState::Recording,
        RecState::Recording => RecState::Idle,
        RecState::Processing => RecState::Processing,
    };
    state.set_rec_state(next);
    tracing::info!(estado = next.label(), "toggle_recording");
    let _ = app.emit("hotkey-toggle-recording", next.label());
    tray::refresh(app);

    // `Processing`: ya hay un `session.stop` en vuelo (§09 FSM del tray) — no hay
    // una acción de control que mandar hasta que vuelva a `Idle`.
    let action = match next {
        RecState::Recording => Some("start"),
        RecState::Idle => Some("stop"),
        RecState::Processing => None,
    };
    if let Some(action) = action {
        dispatch_control(app, action);
    }
}

pub fn drop_mark(app: &AppHandle) {
    tracing::info!("drop_mark");
    let _ = app.emit("hotkey-mark", ());
    dispatch_control(app, "mark");
}

/// `POST /control` es best-effort desde el punto de vista del hotkey: si el daemon
/// no está arriba o el token no matchea todavía (primer arranque del sidecar), el
/// hotkey no tiene una UI propia donde mostrar el error — queda en el log unificado
/// (§09), igual que el resto de los fallos de `daemon_health` en `sidecar.rs`.
fn dispatch_control(app: &AppHandle, action: &'static str) {
    let state = Arc::clone(&app.state::<Arc<AppState>>());
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let url = format!("{}/control", crate::paths::daemon_base_url());
        let token = crate::paths::daemon_control_token();
        let result = state
            .http
            .post(url)
            .bearer_auth(token)
            .json(&serde_json::json!({ "action": action }))
            .send()
            .await;
        match result {
            Ok(resp) if resp.status().is_success() => {}
            Ok(resp) => {
                tracing::warn!(status = %resp.status(), action, "POST /control no tuvo éxito");
                let _ = app.emit("hotkey-control-failed", action);
            }
            Err(error) => {
                tracing::warn!(%error, action, "no se pudo alcanzar el daemon para /control");
                let _ = app.emit("hotkey-control-failed", action);
            }
        }
    });
}
