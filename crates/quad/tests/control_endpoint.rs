//! `POST /control` (§09, `docs/DECISIONS.md` D-P1-01): el hotkey global de la app
//! Tauri le ordena a la extensión arrancar/parar/marcar reenviando `session.control`
//! por el WS conectado. Criterio de aceptación de esta tarea: reenvía al cliente
//! conectado; sin token, 401.

use futures_util::StreamExt;
use qua_protocol::{ControlAction, ProtocolVersionTag, ServerMessage};
use quad::config::Config;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message as WsMessage;

const ORIGIN: &str = "chrome-extension://cccccccccccccccccccccccccccccccc";
const TOKEN: &str = "test-token-control";
const CONTROL_TOKEN: &str = "test-control-token";

async fn start_daemon() -> (u16, tempfile::TempDir) {
    let dir = tempfile::tempdir().expect("tmpdir");
    let data_dir = dir.path().to_path_buf();

    let mut cfg = Config::default();
    cfg.add_paired_extension(ORIGIN.to_string(), TOKEN.to_string());
    cfg.daemon.control_token = CONTROL_TOKEN.to_string();
    cfg.save(&data_dir.join("config.toml"))
        .expect("save config");

    let (listener, state) = quad::server::prepare(Some(0), data_dir)
        .await
        .expect("prepare");
    let port = listener.local_addr().expect("local_addr").port();
    tokio::spawn(quad::server::serve(listener, state));
    (port, dir)
}

#[tokio::test(flavor = "multi_thread")]
async fn sin_token_devuelve_401() {
    let (port, _dir) = start_daemon().await;
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("http://127.0.0.1:{port}/control"))
        .json(&serde_json::json!({ "action": "start" }))
        .send()
        .await
        .expect("request");
    assert_eq!(resp.status(), reqwest::StatusCode::UNAUTHORIZED);
}

#[tokio::test(flavor = "multi_thread")]
async fn token_incorrecto_devuelve_401() {
    let (port, _dir) = start_daemon().await;
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("http://127.0.0.1:{port}/control"))
        .bearer_auth("no-es-el-token")
        .json(&serde_json::json!({ "action": "mark" }))
        .send()
        .await
        .expect("request");
    assert_eq!(resp.status(), reqwest::StatusCode::UNAUTHORIZED);
}

#[tokio::test(flavor = "multi_thread")]
async fn sin_cliente_conectado_devuelve_503() {
    let (port, _dir) = start_daemon().await;
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("http://127.0.0.1:{port}/control"))
        .bearer_auth(CONTROL_TOKEN)
        .json(&serde_json::json!({ "action": "start" }))
        .send()
        .await
        .expect("request");
    assert_eq!(resp.status(), reqwest::StatusCode::SERVICE_UNAVAILABLE);
}

#[tokio::test(flavor = "multi_thread")]
async fn reenvia_session_control_al_cliente_ws_conectado() {
    let (port, _dir) = start_daemon().await;

    // El cliente WS conecta y se queda quieto, sin mandar `hello` — el registro de
    // `POST /control` no depende de la sesión (D-P1-01).
    let url = format!("ws://127.0.0.1:{port}/ws?token={TOKEN}");
    let mut request = url.into_client_request().expect("request");
    request
        .headers_mut()
        .insert("Origin", HeaderValue::from_str(ORIGIN).unwrap());
    let (ws_stream, _) = tokio_tungstenite::connect_async(request)
        .await
        .expect("connect");
    let (_write, mut read) = ws_stream.split();

    // El handshake del cliente vuelve apenas el upgrade HTTP responde; el registro en
    // `client_tx` lo hace la tarea `handle_socket` del lado del servidor, que arranca
    // asincrónicamente después — sin esto hay una carrera real contra el `POST` de abajo.
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    let http = reqwest::Client::new();
    let resp = http
        .post(format!("http://127.0.0.1:{port}/control"))
        .bearer_auth(CONTROL_TOKEN)
        .json(&serde_json::json!({ "action": "mark" }))
        .send()
        .await
        .expect("request");
    assert_eq!(resp.status(), reqwest::StatusCode::NO_CONTENT);

    let msg = tokio::time::timeout(std::time::Duration::from_secs(2), read.next())
        .await
        .expect("no llegó nada por el WS")
        .expect("stream cerrado")
        .expect("frame inválido");
    let WsMessage::Text(text) = msg else {
        panic!("se esperaba texto, llegó {msg:?}");
    };
    let parsed: ServerMessage = serde_json::from_str(&text).expect("parsea");
    match parsed {
        ServerMessage::SessionControl {
            v: ProtocolVersionTag,
            action,
            ..
        } => assert_eq!(action, ControlAction::Mark),
        other => panic!("se esperaba session.control, llegó {other:?}"),
    }
}
