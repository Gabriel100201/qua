//! El servidor axum: `/health`, `/pair/start`, `/pair`, `/ws` (§04, §06).
//!
//! Bind exclusivo a 127.0.0.1 (§12: cero egreso de red) — nunca se arma el `SocketAddr`
//! con otra cosa, ni siquiera configurable, porque no hay ningún caso de uso legítimo
//! para escuchar en otra interfaz.

use std::net::{Ipv4Addr, SocketAddr};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use axum::extract::ws::WebSocketUpgrade;
use axum::extract::{Query, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use qua_protocol::messages::error_codes;
use qua_protocol::{ControlAction, HealthResponse, PairRequest, PairResponse, ServerMessage};
use serde::{Deserialize, Serialize};
use tokio::net::TcpListener;
use tokio::sync::mpsc::UnboundedSender;

use crate::config::Config;
use crate::pairing::{self, PairingWindow};

#[derive(Clone)]
pub struct AppState {
    pub data_dir: Arc<PathBuf>,
    pub config_path: Arc<PathBuf>,
    pub config: Arc<Mutex<Config>>,
    pub pairing: Arc<Mutex<Option<PairingWindow>>>,
    pub active_session_id: Arc<Mutex<Option<String>>>,
    /// El WS actualmente conectado, si hay uno — lo que `POST /control` usa para
    /// reenviar `session.control` (§09, D-P1-01). No implica sesión arrancada: se
    /// registra apenas el socket autentica, antes de cualquier `hello`, para que el
    /// hotkey pueda alcanzar a la extensión incluso en su canal de control ocioso.
    pub client_tx: Arc<Mutex<Option<UnboundedSender<ServerMessage>>>>,
    pub start_time: Instant,
    pub daemon_version: &'static str,
}

/// Arma el estado y bindea el socket, pero no sirve todavía — separado de [`serve`]
/// para que los tests puedan pedir puerto `0` y enterarse de cuál les tocó antes de
/// arrancar a aceptar conexiones.
pub async fn prepare(
    port: Option<u16>,
    data_dir: PathBuf,
) -> anyhow::Result<(TcpListener, AppState)> {
    std::fs::create_dir_all(&data_dir)?;
    let config_path = data_dir.join("config.toml");
    let mut config = Config::load(&config_path)?;
    if let Some(p) = port {
        config.daemon.port = p;
    }
    // D-P1-01: el token de `/control` es secreto local (nunca sale por Origin/pairing
    // como el de la extensión) — se genera una sola vez y se persiste como cualquier
    // otro dato de `config.toml`.
    if config.daemon.control_token.is_empty() {
        config.daemon.control_token = pairing::generate_token();
    }
    config.save(&config_path)?;

    // Abre (y crea) el SQLite ya, para fallar rápido si el directorio de datos no sirve
    // en vez de descubrirlo recién al terminar la primera sesión.
    qua_core::store::open(&data_dir)?;

    let bind_port = config.daemon.port;
    let state = AppState {
        data_dir: Arc::new(data_dir),
        config_path: Arc::new(config_path),
        config: Arc::new(Mutex::new(config)),
        pairing: Arc::new(Mutex::new(None)),
        active_session_id: Arc::new(Mutex::new(None)),
        client_tx: Arc::new(Mutex::new(None)),
        start_time: Instant::now(),
        daemon_version: env!("CARGO_PKG_VERSION"),
    };

    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, bind_port));
    let listener = TcpListener::bind(addr).await?;
    Ok((listener, state))
}

pub async fn serve(listener: TcpListener, state: AppState) -> anyhow::Result<()> {
    let app = build_router(state);
    axum::serve(listener, app).await?;
    Ok(())
}

pub async fn run(port: Option<u16>, data_dir: PathBuf) -> anyhow::Result<()> {
    let (listener, state) = prepare(port, data_dir).await?;
    tracing::info!(addr = %listener.local_addr()?, "quad escuchando");
    serve(listener, state).await
}

pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health_handler))
        .route("/pair/start", post(pair_start_handler))
        .route("/pair", post(pair_handler))
        .route("/pair/auto", post(pair_auto_handler))
        .route("/ws", get(ws_upgrade_handler))
        .route("/control", post(control_handler))
        .with_state(state)
}

async fn health_handler(State(state): State<AppState>) -> Json<HealthResponse> {
    let uptime_ms = state.start_time.elapsed().as_millis() as i64;
    let session = state.active_session_id.lock().unwrap().clone();
    Json(HealthResponse {
        ok: true,
        daemon_version: state.daemon_version.to_string(),
        uptime_ms,
        session,
        // El pool de whisper (B2) todavía no existe — siempre `false` hasta que B2
        // cargue el modelo y tenga cómo reportar su propio estado acá.
        model_ready: false,
    })
}

#[derive(Debug, Serialize)]
struct PairStartResponse {
    code: String,
    expires_in_ms: u64,
}

/// No está en la lista de mensajes de §04 — la spec da por sentado que "la app Tauri
/// abre una ventana de pairing" sin decir cómo arranca del lado del daemon. B1 expone
/// este endpoint para eso; ver D-B1-01 en `docs/DECISIONS.md`.
async fn pair_start_handler(State(state): State<AppState>) -> Json<PairStartResponse> {
    let code = pairing::generate_code();
    *state.pairing.lock().unwrap() = Some(PairingWindow::new(code.clone()));
    Json(PairStartResponse {
        code,
        expires_in_ms: pairing::PAIRING_WINDOW.as_millis() as u64,
    })
}

#[derive(Debug, Serialize)]
struct HttpError {
    code: String,
    message: String,
}

fn err(status: StatusCode, code: &str, message: impl Into<String>) -> Response {
    (
        status,
        Json(HttpError {
            code: code.to_string(),
            message: message.into(),
        }),
    )
        .into_response()
}

async fn pair_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<PairRequest>,
) -> Response {
    let origin = headers
        .get(header::ORIGIN)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);

    let Some(origin) = origin else {
        return err(
            StatusCode::FORBIDDEN,
            error_codes::ORIGIN_REJECTED,
            "Falta el header Origin",
        );
    };
    if !pairing::is_valid_extension_origin(&origin) {
        return err(
            StatusCode::FORBIDDEN,
            error_codes::ORIGIN_REJECTED,
            format!("Origin inválido para pairing: {origin}"),
        );
    }

    // La ventana es de un solo uso: cualquier intento (correcto o no) la consume, para
    // que un atacante no pueda seguir probando códigos contra la misma ventana de 60s.
    let outcome = {
        let mut guard = state.pairing.lock().unwrap();
        match guard.take() {
            None => Err(err(
                StatusCode::BAD_REQUEST,
                error_codes::BAD_MESSAGE,
                "No hay ventana de pairing abierta (POST /pair/start primero, vence a los 60s)",
            )),
            Some(window) if window.is_expired() => Err(err(
                StatusCode::BAD_REQUEST,
                error_codes::BAD_MESSAGE,
                "La ventana de pairing venció (60s). Reintentá con POST /pair/start.",
            )),
            Some(window) if window.code == req.code => Ok(()),
            Some(_) => Err(err(
                StatusCode::UNAUTHORIZED,
                error_codes::UNAUTHORIZED,
                "Código incorrecto",
            )),
        }
    };
    if let Err(response) = outcome {
        return response;
    }

    let token = pairing::generate_token();
    {
        let mut cfg = state.config.lock().unwrap();
        cfg.add_paired_extension(origin, token.clone());
        if let Err(e) = cfg.save(&state.config_path) {
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                error_codes::STORAGE,
                format!("no se pudo persistir config.toml: {e}"),
            );
        }
    }

    Json(PairResponse {
        token,
        daemon_version: state.daemon_version.to_string(),
    })
    .into_response()
}

/// `POST /pair/auto` (D-U1-01, trust-on-first-use): salta el código de 6 dígitos
/// para el primer emparejamiento de la vida del daemon. Sin esto, "grabar" exige
/// abrir una terminal (`POST /pair/start`), leer un código y tipearlo en options
/// antes de que venza a los 60 s — inaceptable para un click desde el popup.
///
/// Solo se acepta si las dos condiciones se cumplen a la vez:
/// - el `Origin` es `chrome-extension://<id>` bien formado (mismo chequeo que
///   `/pair`, así que un sitio web normal no puede llamarlo — los navegadores no
///   dejan que JS arbitrario mande ese Origin), y
/// - `paired_extensions` está vacío: nadie emparejó nunca con este daemon.
///
/// Con una extensión ya emparejada, devuelve 409 y el cliente cae al flujo de
/// `/pair/start` + `/pair` para re-emparejar. Ver D-U1-01 en `docs/DECISIONS.md`
/// para el modelo de confianza completo.
async fn pair_auto_handler(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let origin = headers
        .get(header::ORIGIN)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);

    let Some(origin) = origin else {
        return err(
            StatusCode::UNAUTHORIZED,
            error_codes::ORIGIN_REJECTED,
            "Falta el header Origin",
        );
    };
    if !pairing::is_valid_extension_origin(&origin) {
        return err(
            StatusCode::UNAUTHORIZED,
            error_codes::ORIGIN_REJECTED,
            format!("Origin inválido para pairing: {origin}"),
        );
    }

    let token = pairing::generate_token();
    let mut cfg = state.config.lock().unwrap();
    if !cfg.paired_extensions.is_empty() {
        return err(
            StatusCode::CONFLICT,
            error_codes::ALREADY_PAIRED,
            "Ya hay una extensión emparejada. Usá POST /pair/start + POST /pair (código de 6 dígitos) para re-emparejar.",
        );
    }
    cfg.add_paired_extension(origin, token.clone());
    if let Err(e) = cfg.save(&state.config_path) {
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            error_codes::STORAGE,
            format!("no se pudo persistir config.toml: {e}"),
        );
    }
    drop(cfg);

    Json(PairResponse {
        token,
        daemon_version: state.daemon_version.to_string(),
    })
    .into_response()
}

#[derive(Debug, Deserialize)]
struct WsQuery {
    token: String,
}

async fn ws_upgrade_handler(
    ws: WebSocketUpgrade,
    Query(query): Query<WsQuery>,
    headers: HeaderMap,
    State(state): State<AppState>,
) -> Response {
    let origin = headers
        .get(header::ORIGIN)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);

    let allowed = match &origin {
        Some(o) => state.config.lock().unwrap().is_allowed(o, &query.token),
        None => false,
    };
    if !allowed {
        return err(
            StatusCode::UNAUTHORIZED,
            error_codes::UNAUTHORIZED,
            "token/Origin no está en la allowlist",
        );
    }

    {
        let guard = state.active_session_id.lock().unwrap();
        if guard.is_some() {
            return err(
                StatusCode::CONFLICT,
                error_codes::INTERNAL,
                "ya hay una sesión grabando",
            );
        }
    }

    ws.on_upgrade(move |socket| crate::ws::handle_socket(socket, state))
}

#[derive(Debug, Deserialize)]
struct ControlRequest {
    action: ControlAction,
}

/// `POST /control` (§09, `docs/DECISIONS.md` D-P1-01): dispara el hotkey global de
/// la app Tauri. No está en §04 — es interno, como `/pair/start` (D-B1-01) — pero a
/// diferencia de `/pair`/`/ws`, no lo autentica el pairing de la extensión: lo llama
/// la app Tauri, un proceso local sin `Origin` de extensión, así que usa su propio
/// token (`control_token`) por header `Authorization: Bearer <token>`.
async fn control_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<ControlRequest>,
) -> Response {
    let expected = state.config.lock().unwrap().daemon.control_token.clone();
    let provided = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));
    if provided != Some(expected.as_str()) || expected.is_empty() {
        return err(
            StatusCode::UNAUTHORIZED,
            error_codes::UNAUTHORIZED,
            "token de control inválido",
        );
    }

    let msg = ServerMessage::SessionControl {
        v: Default::default(),
        action: req.action,
        t: chrono::Utc::now().timestamp_millis(),
    };

    let sent = state
        .client_tx
        .lock()
        .unwrap()
        .as_ref()
        .map(|tx| tx.send(msg).is_ok())
        .unwrap_or(false);

    if !sent {
        return err(
            StatusCode::SERVICE_UNAVAILABLE,
            error_codes::NO_CLIENT,
            "no hay ningún cliente WS conectado para reenviarle la orden",
        );
    }

    StatusCode::NO_CONTENT.into_response()
}
