//! Sidecar de `quad` (§09): lo lanza como proceso externo, health-check cada 5 s
//! contra `GET /health`, reinicio automático con backoff, logs unificados en
//! `~/.qua/logs/`.

use std::io::Write;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::sync::Mutex as AsyncMutex;

use crate::paths;
use crate::state::AppState;

const HEALTH_INTERVAL: Duration = Duration::from_secs(5);
const HEALTH_FAILS_BEFORE_KILL: u32 = 3;
const BACKOFF_INITIAL: Duration = Duration::from_millis(250);
const BACKOFF_MAX: Duration = Duration::from_secs(8);
/// Si el proceso aguantó más que esto antes de morir, no fue un crash-loop: se
/// resetea el backoff al mínimo en vez de seguir duplicándolo (mismo criterio que la
/// reconexión WS de §04).
const HEALTHY_UPTIME_RESET: Duration = Duration::from_secs(30);

/// El child del sidecar en curso, para que el chequeo de salud pueda matarlo si deja
/// de responder — eso reentra al mismo camino de reinicio que una muerte espontánea.
pub struct SidecarHandle(pub AsyncMutex<Option<CommandChild>>);

impl Default for SidecarHandle {
    fn default() -> Self {
        Self(AsyncMutex::new(None))
    }
}

fn open_log() -> std::io::Result<std::fs::File> {
    let dir = paths::logs_dir();
    std::fs::create_dir_all(&dir)?;
    std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("qua-app.log"))
}

fn log_line(msg: &str) {
    let ts = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S%.3f");
    let line = format!("[{ts}] [qua-app] {msg}\n");
    if let Ok(mut f) = open_log() {
        let _ = f.write_all(line.as_bytes());
    }
    tracing::info!("{msg}");
}

/// Corre el sidecar hasta que termina (por su cuenta o porque lo matamos) y vuelca su
/// stdout/stderr al log unificado. Devuelve cuánto duró vivo, para que el supervisor
/// decida el backoff del próximo intento.
async fn run_once(app: &AppHandle) -> anyhow::Result<Duration> {
    let shell = app.shell();
    let (mut rx, child) = shell.sidecar("quad")?.spawn()?;
    log_line("sidecar `quad` arrancado");

    {
        let handle = app.state::<SidecarHandle>();
        *handle.inner().0.lock().await = Some(child);
    }

    let started = Instant::now();
    let mut log = open_log().ok();

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(line) | CommandEvent::Stderr(line) => {
                let text = String::from_utf8_lossy(&line);
                if let Some(f) = log.as_mut() {
                    let _ = writeln!(f, "{}", text.trim_end());
                }
            }
            CommandEvent::Error(e) => {
                log_line(&format!("error del sidecar: {e}"));
            }
            CommandEvent::Terminated(payload) => {
                log_line(&format!(
                    "sidecar `quad` terminó (code={:?}, signal={:?})",
                    payload.code, payload.signal
                ));
                break;
            }
            _ => {}
        }
    }

    let handle = app.state::<SidecarHandle>();
    *handle.inner().0.lock().await = None;
    Ok(started.elapsed())
}

/// Loop de supervisión: relanza con backoff exponencial (250 ms → 8 s, igual que la
/// reconexión WS de §04) cada vez que el proceso muere — sea porque lo matamos
/// nosotros (mala salud sostenida) o porque lo mataron desde afuera (el criterio de
/// aceptación de C1: "el sidecar se reinicia solo si lo matás").
pub async fn supervise(app: AppHandle, state: Arc<AppState>) {
    let mut backoff = BACKOFF_INITIAL;
    loop {
        match run_once(&app).await {
            Ok(uptime) => {
                state.sidecar_restarts.fetch_add(1, Ordering::Relaxed);
                let _ = app.emit("sidecar-restarted", ());
                backoff = if uptime >= HEALTHY_UPTIME_RESET {
                    BACKOFF_INITIAL
                } else {
                    std::cmp::min(backoff * 2, BACKOFF_MAX)
                };
            }
            Err(e) => {
                log_line(&format!("no se pudo lanzar el sidecar: {e}"));
                backoff = std::cmp::min(backoff * 2, BACKOFF_MAX);
            }
        }
        tokio::time::sleep(backoff).await;
    }
}

/// Chequeo de salud cada 5 s (§09). Actualiza `state.last_health_ok` (lo lee el tray)
/// y, si el daemon deja de responder de forma sostenida, mata el proceso para que
/// `supervise` lo relance — un proceso colgado pero vivo es indistinguible de uno
/// muerto para el usuario.
pub async fn health_loop(app: AppHandle, state: Arc<AppState>) {
    let url = format!("{}/health", paths::daemon_base_url());
    let mut consecutive_fails = 0u32;
    loop {
        tokio::time::sleep(HEALTH_INTERVAL).await;
        let ok = match state.http.get(&url).send().await {
            Ok(resp) if resp.status().is_success() => {
                if let Ok(health) = resp.json::<qua_protocol::HealthResponse>().await {
                    let is_recording = health.session.is_some();
                    if is_recording && state.rec_state() == crate::state::RecState::Idle {
                        state.set_rec_state(crate::state::RecState::Recording);
                    } else if !is_recording && state.rec_state() == crate::state::RecState::Recording
                    {
                        state.set_rec_state(crate::state::RecState::Idle);
                    }
                }
                true
            }
            _ => false,
        };
        *state.last_health_ok.lock().unwrap() = ok;
        let _ = app.emit("daemon-health", ok);

        if ok {
            consecutive_fails = 0;
            continue;
        }
        consecutive_fails += 1;
        if consecutive_fails >= HEALTH_FAILS_BEFORE_KILL {
            log_line(&format!(
                "{HEALTH_FAILS_BEFORE_KILL} health-checks fallidos seguidos, matando el sidecar para forzar reinicio"
            ));
            let handle = app.state::<SidecarHandle>();
            if let Some(child) = handle.inner().0.lock().await.take() {
                let _ = child.kill();
            }
            consecutive_fails = 0;
        }
    }
}
