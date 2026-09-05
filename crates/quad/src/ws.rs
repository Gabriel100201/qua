//! El loop de mensajes de una conexión WS ya autenticada (§04).
//!
//! Invariante central: un `ack` solo sale después de que `RawEventLog::sync` confirma
//! el fsync — así el outbox de la extensión puede borrar con seguridad todo lo que
//! esté en `seq ≤ ack` (§04 Resiliencia). El timer de fsync es lo único que dispara
//! acks; `events` nunca ackea inline.

use std::path::Path;
use std::time::Duration;

use axum::extract::ws::{Message, WebSocket};
use futures_util::stream::SplitSink;
use futures_util::{SinkExt, StreamExt};
use qua_protocol::messages::error_codes;
use qua_protocol::{AudioFrame, ClientMessage, Event, MarkSource, ServerMessage, SessionStatus};

use crate::server::AppState;
use crate::session::{now_iso, ActiveSession};

pub async fn handle_socket(socket: WebSocket, state: AppState) {
    let (mut sender, mut receiver) = socket.split();
    let fsync_interval_ms = state.config.lock().unwrap().daemon.fsync_interval_ms.max(1);
    let mut ticker = tokio::time::interval(Duration::from_millis(fsync_interval_ms));
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    // El primer tick es inmediato; no queremos sincronizar antes de que haya nada.
    ticker.tick().await;

    // Registrado apenas el socket autentica, antes de cualquier `hello` — es lo que
    // `POST /control` usa para alcanzar al cliente (§09, D-P1-01). Un solo cliente a
    // la vez: si hay dos conexiones simultáneas, la última en conectar gana el slot
    // (mismo criterio de simplicidad que `active_session_id`).
    let (control_tx, mut control_rx) = tokio::sync::mpsc::unbounded_channel::<ServerMessage>();
    *state.client_tx.lock().unwrap() = Some(control_tx.clone());

    let mut session: Option<ActiveSession> = None;

    loop {
        tokio::select! {
            incoming = receiver.next() => {
                let Some(Ok(msg)) = incoming else { break };
                match msg {
                    Message::Text(text) => {
                        if !handle_text(&text, &state, &mut session, &mut sender).await {
                            break;
                        }
                    }
                    Message::Binary(bytes) => handle_binary(&bytes, &mut session),
                    Message::Close(_) => break,
                    _ => {}
                }
            }
            _ = ticker.tick() => {
                if let Some(s) = session.as_mut() {
                    if let Ok(Some(seq)) = s.sync() {
                        send_message(&mut sender, &ack(seq)).await;
                    }
                }
            }
            Some(control_msg) = control_rx.recv() => {
                send_message(&mut sender, &control_msg).await;
            }
        }
    }

    // Se cae la conexión sin `session.stop` (crash del lado del cliente, o el que se
    // cayó fue el WS). Nada que finalizar: lo escrito ya está fsync-eado hasta el
    // último ack, y `qua recover` es exactamente para completar el resto desde acá.
    *state.active_session_id.lock().unwrap() = None;
    // Solo limpia el slot si todavía es este socket el registrado — si otra conexión
    // ya lo reemplazó (dos sockets solapados), no hay que pisarle el registro.
    let mut guard = state.client_tx.lock().unwrap();
    if guard.as_ref().is_some_and(|tx| tx.same_channel(&control_tx)) {
        *guard = None;
    }
}

fn ack(seq: i64) -> ServerMessage {
    ServerMessage::Ack {
        v: Default::default(),
        seq,
    }
}

async fn send_message(sender: &mut SplitSink<WebSocket, Message>, msg: &ServerMessage) {
    if let Ok(text) = serde_json::to_string(msg) {
        let _ = sender.send(Message::Text(text)).await;
    }
}

async fn send_error(
    sender: &mut SplitSink<WebSocket, Message>,
    code: &str,
    message: impl Into<String>,
) {
    send_message(
        sender,
        &ServerMessage::Error {
            v: Default::default(),
            code: code.to_string(),
            message: message.into(),
        },
    )
    .await;
}

/// Procesa un frame de texto. Devuelve `false` si la conexión tiene que cerrarse (fin
/// de sesión normal por `session.stop`).
async fn handle_text(
    text: &str,
    state: &AppState,
    session: &mut Option<ActiveSession>,
    sender: &mut SplitSink<WebSocket, Message>,
) -> bool {
    let msg: ClientMessage = match serde_json::from_str(text) {
        Ok(m) => m,
        Err(e) => {
            send_error(
                sender,
                error_codes::BAD_MESSAGE,
                format!("mensaje inválido: {e}"),
            )
            .await;
            return true;
        }
    };

    match msg {
        ClientMessage::Hello { .. } => {
            if session.is_some() {
                send_error(
                    sender,
                    error_codes::BAD_MESSAGE,
                    "ya hubo un hello en esta conexión",
                )
                .await;
                return true;
            }
            match ActiveSession::create(&state.data_dir) {
                Ok(new_session) => {
                    let session_dir = new_session.dir.to_string_lossy().to_string();
                    send_message(
                        sender,
                        &ServerMessage::HelloOk {
                            v: Default::default(),
                            daemon_version: state.daemon_version.to_string(),
                            session_dir,
                        },
                    )
                    .await;
                    *session = Some(new_session);
                }
                Err(e) => {
                    send_error(
                        sender,
                        error_codes::STORAGE,
                        format!("no se pudo crear el directorio de sesión: {e}"),
                    )
                    .await;
                }
            }
        }

        ClientMessage::SessionStart {
            session: payload, ..
        } => match session.as_mut() {
            Some(s) if !s.is_started() => {
                if let Err(e) = s.start(payload) {
                    send_error(
                        sender,
                        error_codes::STORAGE,
                        format!("no se pudo escribir meta.json: {e}"),
                    )
                    .await;
                } else {
                    *state.active_session_id.lock().unwrap() = Some(s.id.clone());
                }
            }
            Some(_) => {
                send_error(sender, error_codes::BAD_MESSAGE, "la sesión ya arrancó").await;
            }
            None => {
                send_error(
                    sender,
                    error_codes::NO_SESSION,
                    "mandá hello antes de session.start",
                )
                .await;
            }
        },

        ClientMessage::Events { seq, items, .. } => match session.as_mut() {
            Some(s) if s.is_started() => {
                // El ack sale del timer de fsync (§04), no de acá — ver módulo doc.
                if let Err(e) = s.ingest_events(seq, items) {
                    send_error(sender, error_codes::STORAGE, format!("{e}")).await;
                }
            }
            _ => {
                send_error(
                    sender,
                    error_codes::NO_SESSION,
                    "no hay session.start activo",
                )
                .await;
            }
        },

        ClientMessage::Mark { t, .. } => match session.as_mut() {
            Some(s) if s.is_started() => {
                // §04: "mark ... fuerza flush inmediato" — no esperamos al timer.
                let event = Event::Mark {
                    t,
                    tab: None,
                    source: MarkSource::Popup,
                };
                if let Err(e) = s.ingest_mark(event) {
                    send_error(sender, error_codes::STORAGE, format!("{e}")).await;
                } else if let Ok(Some(seq)) = s.sync() {
                    send_message(sender, &ack(seq)).await;
                }
            }
            _ => {
                send_error(
                    sender,
                    error_codes::NO_SESSION,
                    "no hay session.start activo",
                )
                .await;
            }
        },

        // Respuesta a `capture.request` (§07 paso 9). El correlador (B3) todavía no
        // pide screenshots — B1 la recibe y la descarta; interfaz para B3/B4.
        ClientMessage::Frame { .. } => {}

        ClientMessage::SessionStop { t, .. } => match session.take() {
            Some(mut s) if s.is_started() => {
                match finalize(state, &mut s, t).await {
                    Ok(done) => send_message(sender, &done).await,
                    Err(e) => send_error(sender, error_codes::STORAGE, format!("{e}")).await,
                }
                *state.active_session_id.lock().unwrap() = None;
                return false;
            }
            Some(s) => {
                send_error(
                    sender,
                    error_codes::NO_SESSION,
                    "no hay session.start activo",
                )
                .await;
                *session = Some(s);
            }
            None => {
                send_error(sender, error_codes::NO_SESSION, "no hay sesión abierta").await;
            }
        },

        // D-03: `ping` no tiene respuesta propia.
        ClientMessage::Ping { .. } => {}
    }

    true
}

fn handle_binary(bytes: &[u8], session: &mut Option<ActiveSession>) {
    if !qua_protocol::is_audio_frame(bytes) {
        return;
    }
    let Ok(frame) = AudioFrame::decode(bytes) else {
        return;
    };
    if let Some(s) = session.as_mut() {
        if s.is_started() {
            let _ = s.ingest_audio(&frame.samples);
        }
    }
}

/// `session.stop`: cierre normal. Fsyncea todo lo pendiente, arma `session.json` y
/// deja la fila de `sessions` en SQLite.
///
/// **G1** corre acá mismo, en un `spawn_blocking` (whisper y el correlador son CPU-bound
/// y síncronos), el pipeline completo de `quad::pipeline::process` — ASR sobre
/// `raw/audio.pcm` + el correlador + el renderer de B4 — así que `session.done` ya
/// vuelve con `status: "ready"` y el conteo real de issues, sin depender de un
/// `qua reprocess` manual después (ver D-B1-04 en `docs/DECISIONS.md`, resuelta acá).
/// Si el pipeline falla (p. ej. sin conexión para bajar el modelo whisper la primera
/// vez), la sesión queda igual en `"processing"` con 0 issues — un reporte vacío es
/// preferible a perder la grabación.
async fn finalize(
    state: &AppState,
    s: &mut ActiveSession,
    t_stop: i64,
) -> anyhow::Result<ServerMessage> {
    s.sync()?;

    let ended_at = now_iso();
    std::fs::write(
        s.dir.join("raw/stop.json"),
        serde_json::to_vec(&serde_json::json!({ "t": t_stop, "ended_at": ended_at }))?,
    )?;

    let dir = s.dir.clone();
    let audio_path = tokio::task::spawn_blocking(move || transcode_to_opus(&dir))
        .await
        .unwrap_or(None)
        .unwrap_or_else(|| "raw/audio.pcm".to_string());

    let meta = s
        .meta
        .clone()
        .expect("finalize solo se llama con una sesión arrancada");
    let project = state.config.lock().unwrap().match_project(&meta.base_url);
    let events = s.events_snapshot();
    let mut session = qua_core::build_session(
        &meta,
        events,
        SessionStatus::Processing,
        Some(ended_at),
        Some(t_stop),
        project,
        audio_path,
    );

    let dir = s.dir.clone();
    let data_dir = state.data_dir.clone();
    let processing_snapshot = session.clone();
    let processed = tokio::task::spawn_blocking(move || {
        crate::pipeline::process(&mut session, &dir, &data_dir)
            .and_then(|_| {
                qua_core::render::render_session(&session, &dir).map_err(anyhow::Error::from)
            })
            .map(|_| session)
    })
    .await;

    let session = match processed {
        Ok(Ok(session)) => session,
        Ok(Err(e)) => {
            tracing::warn!(
                "pipeline ASR/correlate/render falló para {}: {e} — la sesión queda en processing",
                s.id
            );
            processing_snapshot
        }
        Err(e) => {
            tracing::warn!(
                "spawn_blocking del pipeline se cayó para {}: {e} — la sesión queda en processing",
                s.id
            );
            processing_snapshot
        }
    };

    std::fs::write(
        s.dir.join("session.json"),
        serde_json::to_vec_pretty(&session)?,
    )?;

    let conn = qua_core::store::open(&state.data_dir)?;
    qua_core::store::upsert_session(&conn, &session, &s.dir.to_string_lossy())?;
    qua_core::store::upsert_issues(&conn, &session.id, &session.issues)?;

    Ok(ServerMessage::SessionDone {
        v: Default::default(),
        report_path: s.dir.join("report.md").to_string_lossy().to_string(),
        issues: session.issues.len() as i64,
    })
}

/// Best-effort: `ffmpeg` está en el toolchain verificado (STATE.md), así que se usa
/// para dejar el artefacto final en `audio.opus` (§8.2) en vez del PCM crudo. Si no
/// está disponible o falla, `session.json` apunta a `raw/audio.pcm` y no se rompe nada
/// — es una mejora de compresión, no un requisito de durabilidad.
fn transcode_to_opus(dir: &Path) -> Option<String> {
    let pcm = dir.join("raw/audio.pcm");
    if !pcm.exists() || std::fs::metadata(&pcm).map(|m| m.len()).unwrap_or(0) == 0 {
        return None;
    }
    let out = dir.join("audio.opus");
    let status = std::process::Command::new("ffmpeg")
        .arg("-y")
        .args(["-f", "s16le", "-ar", "16000", "-ac", "1", "-i"])
        .arg(&pcm)
        .args(["-c:a", "libopus"])
        .arg(&out)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();
    match status {
        Ok(s) if s.success() => Some("audio.opus".to_string()),
        _ => None,
    }
}
