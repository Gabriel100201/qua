//! Criterio de aceptación de B1: "ingesta de 100k eventos sin pérdida".
//!
//! Corre el servidor real (axum + WS + store) en proceso, sobre un puerto efímero y
//! un `data_dir` temporal, y actúa como si fuera la extensión: hello → session.start →
//! 100.000 eventos en lotes de 200 → session.stop. Verifica que cada lote se ackea y
//! que el `session.json` final tiene los 100.000 eventos, sin duplicados ni huecos.

use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use qua_protocol::{
    ClientMessage, Event, MarkSource, ProtocolVersionTag, ServerMessage, SessionStartPayload,
    SessionStatus, ViewportInfo,
};
use quad::config::Config;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message as WsMessage;

const T0_WALL: i64 = 1_800_000_000_000;
const ORIGIN: &str = "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TOKEN: &str = "test-token-100k";

fn env_info() -> qua_protocol::EnvInfo {
    qua_protocol::EnvInfo {
        ua: "test-agent".into(),
        chrome: "142.0".into(),
        platform: "macOS 15.1".into(),
        viewport: ViewportInfo {
            w: 1512,
            h: 857,
            dpr: 2.0,
        },
        ext: "1.0.0".into(),
    }
}

fn mark_event(t: i64) -> Event {
    Event::Mark {
        t,
        tab: None,
        source: MarkSource::Hotkey,
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn ingesta_100k_eventos_sin_perdida() {
    let dir = tempfile::tempdir().expect("tmpdir");
    let data_dir = dir.path().to_path_buf();

    let mut cfg = Config::default();
    // El fsync real es cada 2s (§04); acá lo aceleramos para que el test no tarde
    // minutos — el umbral sigue viviendo en config, nunca hardcodeado en el servidor.
    cfg.daemon.fsync_interval_ms = 40;
    cfg.add_paired_extension(ORIGIN.to_string(), TOKEN.to_string());
    cfg.save(&data_dir.join("config.toml"))
        .expect("save config");

    let (listener, state) = quad::server::prepare(Some(0), data_dir.clone())
        .await
        .expect("prepare");
    let port = listener.local_addr().expect("local_addr").port();
    tokio::spawn(quad::server::serve(listener, state));

    let url = format!("ws://127.0.0.1:{port}/ws?token={TOKEN}");
    let mut request = url.into_client_request().expect("request");
    request
        .headers_mut()
        .insert("Origin", HeaderValue::from_str(ORIGIN).unwrap());
    let (ws_stream, _) = tokio_tungstenite::connect_async(request)
        .await
        .expect("connect");
    let (mut write, mut read) = ws_stream.split();

    // Un lector de fondo drena Acks concurrentemente con el envío — si esperáramos a
    // leer entre lote y lote, el buffer TCP se podría llenar y todo se trabaría.
    let last_acked = Arc::new(AtomicI64::new(0));
    let last_acked_reader = last_acked.clone();
    let (done_tx, done_rx) = tokio::sync::oneshot::channel::<ServerMessage>();
    let reader = tokio::spawn(async move {
        let mut done_tx = Some(done_tx);
        while let Some(Ok(msg)) = read.next().await {
            if let WsMessage::Text(text) = msg {
                if let Ok(server_msg) = serde_json::from_str::<ServerMessage>(&text) {
                    match &server_msg {
                        ServerMessage::Ack { seq, .. } => {
                            last_acked_reader.store(*seq, Ordering::SeqCst);
                        }
                        ServerMessage::SessionDone { .. } => {
                            if let Some(tx) = done_tx.take() {
                                let _ = tx.send(server_msg);
                            }
                        }
                        ServerMessage::Error { code, message, .. } => {
                            panic!("el servidor mandó un error: {code}: {message}");
                        }
                        _ => {}
                    }
                }
            }
        }
    });

    send(
        &mut write,
        &ClientMessage::Hello {
            v: ProtocolVersionTag,
            ext_version: "1.0.0".into(),
            chrome: "142.0".into(),
            platform: "macOS 15.1".into(),
        },
    )
    .await;

    send(
        &mut write,
        &ClientMessage::SessionStart {
            v: ProtocolVersionTag,
            session: SessionStartPayload {
                t0_wall: T0_WALL,
                base_url: "http://localhost:3000/agenda".into(),
                env: env_info(),
            },
        },
    )
    .await;

    const TOTAL: i64 = 100_000;
    const BATCH: i64 = 200;
    let mut seq = 0i64;
    let mut sent = 0i64;
    while sent < TOTAL {
        seq += 1;
        let n = BATCH.min(TOTAL - sent);
        let items: Vec<Event> = (0..n).map(|i| mark_event(T0_WALL + sent + i)).collect();
        send(
            &mut write,
            &ClientMessage::Events {
                v: ProtocolVersionTag,
                seq,
                items,
            },
        )
        .await;
        sent += n;
    }
    assert_eq!(sent, TOTAL);
    let last_seq = seq;

    // Esperar a que el fsync periódico ackee todo lo mandado.
    let deadline = tokio::time::Instant::now() + Duration::from_secs(30);
    while last_acked.load(Ordering::SeqCst) < last_seq {
        if tokio::time::Instant::now() > deadline {
            panic!(
                "timeout esperando ack de seq {last_seq}; último ack visto: {}",
                last_acked.load(Ordering::SeqCst)
            );
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }

    send(
        &mut write,
        &ClientMessage::SessionStop {
            v: ProtocolVersionTag,
            t: T0_WALL + TOTAL,
        },
    )
    .await;

    let done = tokio::time::timeout(Duration::from_secs(10), done_rx)
        .await
        .expect("timeout esperando session.done")
        .expect("el canal de session.done no se cerró solo");
    let ServerMessage::SessionDone {
        report_path,
        issues,
        ..
    } = done
    else {
        panic!("se esperaba session.done");
    };
    assert_eq!(
        issues, 0,
        "sin audio no hay utterances, así que el correlador (G1) no arma ningún grupo"
    );
    assert!(report_path.ends_with("report.md"));

    reader.await.expect("reader task");

    // Verificación final contra lo que quedó en disco: nada de esto pasa por el WS,
    // así que confirma que el ack no mentía.
    let sessions_dir = data_dir.join("sessions");
    let mut entries: Vec<_> = std::fs::read_dir(&sessions_dir)
        .expect("sessions dir")
        .map(|e| e.unwrap().path())
        .collect();
    assert_eq!(entries.len(), 1, "tiene que haber exactamente una sesión");
    let session_dir = entries.remove(0);

    let session_json =
        std::fs::read_to_string(session_dir.join("session.json")).expect("session.json");
    let session: qua_protocol::Session =
        serde_json::from_str(&session_json).expect("parse session.json");
    assert_eq!(
        session.events.len(),
        TOTAL as usize,
        "no puede faltar ni sobrar ni un evento"
    );
    assert_eq!(session.stats.events_raw, TOTAL);
    assert_eq!(
        session.status,
        SessionStatus::Ready,
        "G1 cablea ASR+correlate+render en finalize (D-B1-04, resuelta): sin errores, la \
         sesión sale de session.stop ya en ready"
    );
    assert!(session.ended_at.is_some());

    // Sin huecos ni duplicados en la secuencia lógica de los `t` de los eventos.
    let mut ts: Vec<i64> = session.events.iter().map(|e| e.t()).collect();
    ts.sort_unstable();
    ts.dedup();
    assert_eq!(ts.len(), TOTAL as usize, "no hay duplicados");
    assert_eq!(ts.first().copied(), Some(0));
    assert_eq!(ts.last().copied(), Some(TOTAL - 1));

    // Y el store SQLite tiene la fila.
    let conn = qua_core::store::open(&data_dir).expect("open store");
    let count: i64 = conn
        .query_row(
            "SELECT count(*) FROM sessions WHERE id = ?1",
            [&session.id],
            |r| r.get(0),
        )
        .expect("query sessions");
    assert_eq!(count, 1);
}

async fn send(
    write: &mut (impl SinkExt<WsMessage, Error = tokio_tungstenite::tungstenite::Error> + Unpin),
    msg: &ClientMessage,
) {
    let text = serde_json::to_string(msg).expect("serialize");
    write.send(WsMessage::Text(text)).await.expect("send");
}
