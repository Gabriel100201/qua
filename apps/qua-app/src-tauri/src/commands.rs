//! Comandos invocables desde el frontend (`src/main.ts`). Todo lo que necesita hablar
//! con el daemon o leer `~/.qua/` vive acá — el webview no toca `fetch` directo contra
//! `127.0.0.1:7331` para no pelear con CSP/CORS.

use std::collections::BTreeMap;
use std::io::BufRead;
use std::path::{Path, PathBuf};

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
    /// `recording` | `processing` | `ready` | `failed`. Sale de qué archivos existen:
    /// `session.json` recién se escribe cuando termina el pipeline (`ws.rs::finalize`),
    /// así que `stop.json` sin `session.json` es "procesando", y ninguno de los dos es
    /// "grabando" (el frontend lo cruza con `/health` para detectar una sesión cortada).
    status: &'static str,
    /// Título de la primera pestaña grabada.
    title: Option<String>,
    project: Option<String>,
    duration_ms: Option<i64>,
    issue_count: Option<usize>,
    unanchored_count: usize,
    categories: BTreeMap<String, usize>,
    has_refined: bool,
    dir: String,
}

/// Título de la primera navegación en `raw/events.ndjson`, para sesiones que todavía
/// no tienen `session.json`.
fn first_nav_title(dir: &Path) -> Option<String> {
    let file = std::fs::File::open(dir.join("raw").join("events.ndjson")).ok()?;
    for line in std::io::BufReader::new(file).lines().take(20).flatten() {
        let Ok(batch) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        for item in batch["items"].as_array().into_iter().flatten() {
            if item["k"] == "nav" {
                if let Some(title) = item["title"].as_str().filter(|t| !t.is_empty()) {
                    return Some(title.to_string());
                }
            }
        }
    }
    None
}

#[tauri::command]
pub async fn list_sessions() -> Result<Vec<SessionSummary>, String> {
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
        let session = std::fs::read_to_string(dir.join("session.json"))
            .ok()
            .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok());
        let issues = std::fs::read_to_string(dir.join("issues.json"))
            .ok()
            .and_then(|s| serde_json::from_str::<Vec<serde_json::Value>>(&s).ok());

        let status = match &session {
            Some(s) if s["status"] == "ready" => "ready",
            Some(_) => "failed",
            None if dir.join("raw").join("stop.json").exists() => "processing",
            None => "recording",
        };
        let mut categories = BTreeMap::new();
        let mut unanchored_count = 0;
        for issue in issues.iter().flatten() {
            if let Some(cat) = issue["category"].as_str() {
                *categories.entry(cat.to_string()).or_insert(0) += 1;
            }
            if issue["anchor"]["confidence"].as_f64().unwrap_or(0.0)
                < qua_protocol::UNANCHORED_CONFIDENCE
            {
                unanchored_count += 1;
            }
        }
        let title = session
            .as_ref()
            .and_then(|s| s["tabs"][0]["title"].as_str())
            .filter(|t| !t.is_empty())
            .map(str::to_string)
            .or_else(|| first_nav_title(&dir));

        out.push(SessionSummary {
            id: meta.id,
            base_url: meta.base_url,
            started_at: meta.started_at,
            status,
            title,
            project: session
                .as_ref()
                .and_then(|s| s["project"]["label"].as_str())
                .map(str::to_string),
            duration_ms: session.as_ref().and_then(|s| s["duration_ms"].as_i64()),
            issue_count: issues.as_ref().map(Vec::len),
            unanchored_count,
            categories,
            has_refined: dir.join("report.refined.md").exists(),
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

#[tauri::command]
pub fn read_refined_report(id: String) -> Result<String, String> {
    std::fs::read_to_string(session_dir(&id).join("report.refined.md")).map_err(to_err)
}

/// `issues.json` tal cual: la vista de sesiones arma una tarjeta por issue con esto.
#[tauri::command]
pub fn read_issues(id: String) -> Result<serde_json::Value, String> {
    let raw = std::fs::read_to_string(session_dir(&id).join("issues.json")).map_err(to_err)?;
    serde_json::from_str(&raw).map_err(to_err)
}

#[tauri::command]
pub fn extension_path(app: AppHandle) -> Result<String, String> {
    app.path()
        .resource_dir()
        .map(|dir| dir.join("extension").display().to_string())
        .map_err(to_err)
}

/// Ruta cruda en disco — el frontend la pasa por `convertFileSrc` (el esquema exacto
/// del protocolo de asset varía por plataforma, no hay que armarlo a mano acá).
#[tauri::command]
pub fn session_audio_path(id: String) -> Result<Option<String>, String> {
    let path = session_dir(&id).join("audio.opus");
    Ok(path.exists().then(|| path.display().to_string()))
}

/// `reprocess`/`refine` de §8.2 son subcomandos del binario `qua`, lanzado con el mismo
/// mecanismo de sidecar que `quad`. Espera a que termine para que la vista pueda
/// mostrar un loader y releer la sesión recién cuando hay resultado.
async fn run_qua(app: &AppHandle, args: &[&str]) -> Result<(), String> {
    let (mut rx, _child) = app
        .shell()
        .sidecar("qua")
        .map_err(to_err)?
        .args(args)
        .spawn()
        .map_err(to_err)?;
    let mut stderr = String::new();
    while let Some(event) = rx.recv().await {
        match event {
            tauri_plugin_shell::process::CommandEvent::Stderr(line) => {
                stderr.push_str(&String::from_utf8_lossy(&line));
                stderr.push('\n');
            }
            tauri_plugin_shell::process::CommandEvent::Terminated(payload) => {
                return if payload.code == Some(0) {
                    Ok(())
                } else {
                    Err(stderr.trim().to_string())
                };
            }
            _ => {}
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn reprocess_session(app: AppHandle, id: String) -> Result<(), String> {
    run_qua(&app, &["reprocess", &id]).await
}

#[tauri::command]
pub async fn refine_session(app: AppHandle, id: String) -> Result<(), String> {
    run_qua(&app, &["refine", &id]).await
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
pub fn select_input_device(app: AppHandle, name: String) -> Result<(), String> {
    let state = app.state::<std::sync::Arc<crate::state::AppState>>();
    *state.selected_input_device.lock().unwrap() = Some(name.clone());
    let meter_state = app.state::<crate::MeterHandle>();
    let inner = std::sync::Arc::clone(&state.inner());
    let meter = crate::audio::start_level_meter(Some(&name), inner).map_err(to_err)?;
    *meter_state.inner().0.lock().unwrap() = Some(meter);
    Ok(())
}
