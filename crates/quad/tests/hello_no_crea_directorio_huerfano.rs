//! BUG 2 (v1, docs/DECISIONS.md D-Q1-01): el canal de control ocioso de D-P1-01
//! manda `hello` en cada reciclado del service worker sin arrancar sesión nunca —
//! antes eso creaba `~/.qua/sessions/<id>/raw/` con `audio.pcm`/`events.ndjson` de
//! cero bytes y sin `session.json`, huérfano para siempre. Criterio: `hello` solo no
//! debe dejar rastro en disco; `session.start` sigue creando el directorio de
//! siempre.

use futures_util::{SinkExt, StreamExt};
use qua_protocol::{
    ClientMessage, EnvInfo, ProtocolVersionTag, ServerMessage, SessionStartPayload, ViewportInfo,
};
use quad::config::Config;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message as WsMessage;

const ORIGIN: &str = "chrome-extension://dddddddddddddddddddddddddddddddd";
const TOKEN: &str = "test-token-hello-huerfano";

async fn start_daemon() -> (u16, tempfile::TempDir) {
    let dir = tempfile::tempdir().expect("tmpdir");
    let data_dir = dir.path().to_path_buf();

    let mut cfg = Config::default();
    cfg.add_paired_extension(ORIGIN.to_string(), TOKEN.to_string());
    cfg.save(&data_dir.join("config.toml"))
        .expect("save config");

    let (listener, state) = quad::server::prepare(Some(0), data_dir)
        .await
        .expect("prepare");
    let port = listener.local_addr().expect("local_addr").port();
    tokio::spawn(quad::server::serve(listener, state));
    (port, dir)
}

async fn connect(port: u16) -> tokio_tungstenite::WebSocketStream<
    tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
> {
    let url = format!("ws://127.0.0.1:{port}/ws?token={TOKEN}");
    let mut request = url.into_client_request().expect("request");
    request
        .headers_mut()
        .insert("Origin", HeaderValue::from_str(ORIGIN).unwrap());
    let (ws_stream, _) = tokio_tungstenite::connect_async(request)
        .await
        .expect("connect");
    ws_stream
}

fn sessions_dir_entries(data_dir: &std::path::Path) -> Vec<std::path::PathBuf> {
    let sessions = data_dir.join("sessions");
    match std::fs::read_dir(&sessions) {
        Ok(entries) => entries.filter_map(|e| e.ok()).map(|e| e.path()).collect(),
        Err(_) => vec![], // ni siquiera `sessions/` existe — perfecto.
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn hello_sin_session_start_no_crea_ningun_directorio() {
    let (port, dir) = start_daemon().await;
    let mut ws = connect(port).await;

    ws.send(WsMessage::Text(
        serde_json::to_string(&ClientMessage::Hello {
            v: ProtocolVersionTag,
            ext_version: "1.0.0".into(),
            chrome: "142.0".into(),
            platform: "macOS 15.1".into(),
        })
        .unwrap(),
    ))
    .await
    .expect("send hello");

    let msg = tokio::time::timeout(std::time::Duration::from_secs(2), ws.next())
        .await
        .expect("no llegó hello.ok")
        .expect("stream cerrado")
        .expect("frame inválido");
    let WsMessage::Text(text) = msg else {
        panic!("se esperaba texto, llegó {msg:?}");
    };
    let parsed: ServerMessage = serde_json::from_str(&text).expect("parsea");
    assert!(
        matches!(parsed, ServerMessage::HelloOk { .. }),
        "se esperaba hello.ok, llegó {parsed:?}"
    );

    // El `hello` de un canal de control ocioso (D-P1-01) que nunca manda
    // `session.start` — exactamente el caso de "cada reciclado del service worker".
    // Le damos un margen a cualquier escritura asincrónica que pudiera colarse antes
    // de afirmar que no hay nada.
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    assert!(
        sessions_dir_entries(dir.path()).is_empty(),
        "hello sin session.start no debería crear ningún directorio de sesión"
    );

    // Cerrar la conexión sin `session.stop` tampoco debe dejar nada atrás.
    drop(ws);
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    assert!(
        sessions_dir_entries(dir.path()).is_empty(),
        "desconectar sin session.start tampoco debería dejar un directorio huérfano"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn session_start_de_verdad_si_crea_el_directorio() {
    let (port, dir) = start_daemon().await;
    let mut ws = connect(port).await;

    ws.send(WsMessage::Text(
        serde_json::to_string(&ClientMessage::Hello {
            v: ProtocolVersionTag,
            ext_version: "1.0.0".into(),
            chrome: "142.0".into(),
            platform: "macOS 15.1".into(),
        })
        .unwrap(),
    ))
    .await
    .expect("send hello");
    let hello_ok = tokio::time::timeout(std::time::Duration::from_secs(2), ws.next())
        .await
        .expect("no llegó hello.ok")
        .expect("stream cerrado")
        .expect("frame inválido");
    let WsMessage::Text(text) = hello_ok else {
        panic!("se esperaba texto");
    };
    let ServerMessage::HelloOk { session_dir, .. } =
        serde_json::from_str(&text).expect("parsea hello.ok")
    else {
        panic!("se esperaba hello.ok");
    };

    // Antes de `session.start`, ni el directorio de ESTA sesión existe todavía.
    assert!(
        !std::path::Path::new(&session_dir).exists(),
        "el directorio no debería existir antes de session.start"
    );

    ws.send(WsMessage::Text(
        serde_json::to_string(&ClientMessage::SessionStart {
            v: ProtocolVersionTag,
            session: SessionStartPayload {
                t0_wall: 1_800_000_000_000,
                base_url: "http://localhost:3000/agenda".into(),
                env: EnvInfo {
                    ua: "test-agent".into(),
                    chrome: "142.0".into(),
                    platform: "macOS 15.1".into(),
                    viewport: ViewportInfo {
                        w: 1512,
                        h: 857,
                        dpr: 2.0,
                    },
                    ext: "1.0.0".into(),
                },
            },
        })
        .unwrap(),
    ))
    .await
    .expect("send session.start");

    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    let entries = sessions_dir_entries(dir.path());
    assert_eq!(
        entries.len(),
        1,
        "session.start sí tiene que crear el directorio de la sesión"
    );
    assert!(entries[0].join("raw").join("meta.json").exists());
}
