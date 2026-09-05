//! Descarga del modelo whisper con progreso (§09 onboarding). Reusa
//! `qua_core::asr::model` (B2) en vez de reimplementar la descarga + verificación
//! SHA-256 — es el mismo modelo que carga el daemon.

use qua_core::asr::model::{ensure_model, ModelSpec, BASE, LARGE_V3_TURBO_Q5_0};
use tauri::{AppHandle, Emitter};

use crate::paths;

fn configured_spec() -> ModelSpec {
    let cfg = qua_core::asr::AsrConfig::load(&paths::config_path()).unwrap_or_default();
    ModelSpec::by_id(&cfg.model).unwrap_or(LARGE_V3_TURBO_Q5_0)
}

pub fn status() -> (bool, std::path::PathBuf) {
    let spec = configured_spec();
    let dest = spec.dest_path(&paths::models_dir());
    (dest.exists(), dest)
}

/// Corre la descarga en un thread bloqueante (la librería de B2 usa `ureq`,
/// sincrónico) y emite progreso al front por eventos — es el enganche de "barra de
/// progreso vía la app" de §06.1.
pub fn spawn_download(app: AppHandle) {
    std::thread::spawn(move || {
        let spec = configured_spec();
        let models_dir = paths::models_dir();
        let app_progress = app.clone();
        let result = ensure_model(&spec, &models_dir, move |p| {
            let _ = app_progress.emit(
                "model-download-progress",
                serde_json::json!({
                    "downloaded": p.downloaded_bytes,
                    "total": p.total_bytes,
                }),
            );
        });
        match result {
            Ok(_) => {
                let _ = app.emit("model-download-done", spec.id);
            }
            Err(e) => {
                let _ = app.emit("model-download-error", e.to_string());
            }
        }
    });
}

/// El otro modelo conocido, para referencia futura de un selector en la UI (§06.1
/// menciona fallback a `base` en máquinas sin aceleración). No hay todavía un
/// selector en la ventana de onboarding — queda para cuando C1 se retome, ver
/// `docs/DECISIONS.md`.
#[allow(dead_code)]
pub fn fallback_spec() -> ModelSpec {
    BASE
}
