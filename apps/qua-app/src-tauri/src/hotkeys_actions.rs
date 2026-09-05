//! Acciones compartidas entre el hotkey global y el ítem equivalente del menú del
//! tray — dos disparadores, un solo camino de código.

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
}

pub fn drop_mark(app: &AppHandle) {
    tracing::info!("drop_mark");
    let _ = app.emit("hotkey-mark", ());
}
