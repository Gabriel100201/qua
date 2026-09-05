//! Comandos invocables desde el frontend (`src/main.ts`). Todo lo que necesita hablar
//! con el daemon o leer `~/.qua/` vive acá — el webview no toca `fetch` directo contra
//! `127.0.0.1:7331` para no pelear con CSP/CORS.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::ShellExt;

use crate::paths;

fn to_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

#[tauri::command]
pub async fn daemon_health(
    state: tauri::State<'_, std::sync::Arc<crate::state::AppState>>,
) -> Result<qua_protocol::HealthResponse, String> {
    let url = format!("{}/health", paths::daemon_base_url());
    state
        .http
        .get(url)
        .send()
        .await
        .map_err(to_err)?
        .json::<qua_protocol::HealthResponse>()
        .await
        .map_err(to_err)
}

#[derive(Serialize, Deserialize)]
pub struct PairStartResponse {
    code: String,
    expires_in_ms: u64,
}

#[tauri::command]
pub async fn pairing_start(
    state: tauri::State<'_, std::sync::Arc<crate::state::AppState>>,
) -> Result<PairStartResponse, String> {
    let url = format!("{}/pair/start", paths::daemon_base_url());
    let resp = state.http.post(url).send().await.map_err(to_err)?;
    resp.json::<PairStartResponse>().await.map_err(to_err)
}

#[derive(Serialize)]
pub struct SessionSummary {
    id: String,
    base_url: String,
    started_at: String,
    duration_s: Option<f64>,
    issue_count: Option<usize>,
    dir: String,
}

#[tauri::command]
pub fn list_sessions() -> Result<Vec<SessionSummary>, String> {
    let root = paths::sessions_dir();
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(&root) else {
        return Ok(out);
    };
    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        let Ok(meta) = qua_core::read_meta(&dir) else {
            continue;
        };
        let issue_count = std::fs::read_to_string(dir.join("issues.json"))
            .ok()
            .and_then(|s| serde_json::from_str::<Vec<serde_json::Value>>(&s).ok())
            .map(|v| v.len());
        out.push(SessionSummary {
            id: meta.id,
            base_url: meta.base_url,
            started_at: meta.started_at,
            duration_s: None,
            issue_count,
            dir: dir.display().to_string(),
        });
    }
    out.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    Ok(out)
}

fn session_dir(id: &str) -> PathBuf {
    paths::sessions_dir().join(id)
}

#[tauri::command]
pub fn read_report(id: String) -> Result<String, String> {
    std::fs::read_to_string(session_dir(&id).join("report.md")).map_err(to_err)
}

/// Ruta cruda en disco — el frontend la pasa por `convertFileSrc` (el esquema exacto
/// del protocolo de asset varía por plataforma, no hay que armarlo a mano acá).
#[tauri::command]
pub fn session_audio_path(id: String) -> Result<Option<String>, String> {
    let path = session_dir(&id).join("audio.opus");
    Ok(path.exists().then(|| path.display().to_string()))
}

/// `reprocess`/`refine` de §8.2 son subcomandos del binario `qua` (B4, todavía stub
/// para esos dos — ver `crates/quad/src/bin/qua.rs`). El botón dispara el proceso vía
/// el mismo mecanismo de sidecar que `quad` y no espera: el resultado se ve
/// releyendo la sesión.
fn spawn_qua(app: &AppHandle, args: &[&str]) -> Result<(), String> {
    app.shell()
        .sidecar("qua")
        .map_err(to_err)?
        .args(args)
        .spawn()
        .map(|_| ())
        .map_err(to_err)
}

#[tauri::command]
pub fn reprocess_session(app: AppHandle, id: String) -> Result<(), String> {
    spawn_qua(&app, &["reprocess", &id])
}

#[tauri::command]
pub fn refine_session(app: AppHandle, id: String) -> Result<(), String> {
    spawn_qua(&app, &["refine", &id])
}

#[tauri::command]
pub async fn run_doctor(app: AppHandle) -> Result<String, String> {
    let (mut rx, _child) = app
        .shell()
        .sidecar("qua")
        .map_err(to_err)?
        .args(["doctor"])
        .spawn()
        .map_err(to_err)?;
    let mut out = String::new();
    while let Some(event) = rx.recv().await {
        match event {
            tauri_plugin_shell::process::CommandEvent::Stdout(line)
            | tauri_plugin_shell::process::CommandEvent::Stderr(line) => {
                out.push_str(&String::from_utf8_lossy(&line));
                out.push('\n');
            }
            tauri_plugin_shell::process::CommandEvent::Terminated(_) => break,
            _ => {}
        }
    }
    Ok(out)
}

#[derive(Serialize)]
pub struct ModelStatus {
    present: bool,
    path: String,
}

#[tauri::command]
pub fn model_status() -> ModelStatus {
    let (present, path) = crate::model::status();
    ModelStatus {
        present,
        path: path.display().to_string(),
    }
}

#[tauri::command]
pub fn download_model(app: AppHandle) {
    crate::model::spawn_download(app);
}

#[tauri::command]
pub fn request_mic_permission() -> Result<String, String> {
    crate::audio::probe_permission()
        .map(|_| "granted".to_string())
        .map_err(to_err)
}

#[tauri::command]
pub fn list_input_devices() -> Result<Vec<String>, String> {
    crate::audio::list_input_devices().map_err(to_err)
}

#[tauri::command]
pub fn select_input_device(
    app: AppHandle,
    name: String,
) -> Result<(), String> {
    let state = app.state::<std::sync::Arc<crate::state::AppState>>();
    *state.selected_input_device.lock().unwrap() = Some(name.clone());
    let meter_state = app.state::<crate::MeterHandle>();
    let inner = std::sync::Arc::clone(&state.inner());
    let meter = crate::audio::start_level_meter(Some(&name), inner).map_err(to_err)?;
    *meter_state.inner().0.lock().unwrap() = Some(meter);
    Ok(())
}
