//! Criterio de aceptación de B1: "kill -9 a mitad de sesión y `qua recover` reconstruye".
//!
//! A diferencia de `ingest_100k.rs` (servidor en proceso), acá `quad` corre como
//! proceso real, se le manda tráfico por WS de verdad, y se lo mata con
//! `Child::kill()` — que en Unix es exactamente `SIGKILL` (§04 Resiliencia:
//! "Crash del daemon"). Después se invoca el binario `qua recover <id>` como otro
//! proceso, apuntando al mismo `QUA_HOME`, y se verifica que reconstruye la sesión
//! desde `raw/` sin haber tenido el proceso original vivo para nada.

use std::io::Read;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use qua_protocol::{
    ClientMessage, Event, MarkSource, ProtocolVersionTag, ServerMessage, SessionStartPayload,
    ViewportInfo,
};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message as WsMessage;

const ORIGIN: &str = "chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const TOKEN: &str = "test-token-kill9";

fn quad_bin() -> PathBuf {
    PathBuf::from(env!("CARGO_BIN_EXE_quad"))
}

fn qua_bin() -> PathBuf {
    PathBuf::from(env!("CARGO_BIN_EXE_qua"))
}

#[tokio::test(flavor = "multi_thread")]
async fn kill_9_a_mitad_de_sesion_y_recover_reconstruye() {
    let dir = tempfile::tempdir().expect("tmpdir");
    let data_dir = dir.path().to_path_buf();

    // Config con la extensión ya pareada, para no tener que implementar el flujo de
    // `/pair` completo en este test (eso ya lo cubre `server.rs`/`pairing.rs`).
    let mut cfg = quad::config::Config::default();
    cfg.daemon.fsync_interval_ms = 50;
    cfg.add_paired_extension(ORIGIN.to_string(), TOKEN.to_string());
    cfg.save(&data_dir.join("config.toml"))
        .expect("save config");

    // Puerto fijo en vez de pedir `0` y parsear el log: este test es el único que
    // levanta un `quad` real contra este puerto, y evita depender del formato exacto
    // de las líneas de `tracing`.
    let port: u16 = 41_331;

    let mut child = Command::new(quad_bin())
        .arg("--port")
        .arg(port.to_string())
        .env("QUA_HOME", &data_dir)
        .env("RUST_LOG", "quad=info")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn quad");

    // Drenar stdout/stderr en el fondo para que el proceso hijo no se bloquee si el
    // pipe se llena (no nos interesa el contenido).
    drain_in_background(child.stdout.take().expect("stdout"));
    drain_in_background(child.stderr.take().expect("stderr"));

    wait_for_port(port).await;

    let url = format!("ws://127.0.0.1:{port}/ws?token={TOKEN}");
    let mut request = url.into_client_request().expect("request");
    request
        .headers_mut()
        .insert("Origin", HeaderValue::from_str(ORIGIN).unwrap());
    let (ws_stream, _) = tokio_tungstenite::connect_async(request)
        .await
        .expect("connect");
    let (mut write, mut read) = ws_stream.split();

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
    let hello_ok = recv(&mut read).await;
    let ServerMessage::HelloOk { session_dir, .. } = hello_ok else {
        panic!("se esperaba hello.ok, llegó {hello_ok:?}");
    };
    let session_id = PathBuf::from(&session_dir)
        .file_name()
        .expect("session_dir tiene nombre")
        .to_string_lossy()
        .to_string();

    send(
        &mut write,
        &ClientMessage::SessionStart {
            v: ProtocolVersionTag,
            session: SessionStartPayload {
                t0_wall: 1_800_000_000_000,
                base_url: "http://localhost:3000/agenda".into(),
                env: qua_protocol::EnvInfo {
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
        },
    )
    .await;

    const N: i64 = 5_000;
    let items: Vec<Event> = (0..N)
        .map(|t| Event::Mark {
            t,
            tab: None,
            source: MarkSource::Hotkey,
        })
        .collect();
    send(
        &mut write,
        &ClientMessage::Events {
            v: ProtocolVersionTag,
            seq: 1,
            items,
        },
    )
    .await;

    // Esperar el ack: solo sale después del fsync, así que confirma que quedó durable
    // antes de que matemos el proceso (§04: el ack es la garantía de durabilidad).
    let ack = tokio::time::timeout(Duration::from_secs(10), recv(&mut read))
        .await
        .expect("timeout esperando ack");
    assert!(
        matches!(ack, ServerMessage::Ack { seq: 1, .. }),
        "se esperaba Ack{{seq:1}}, llegó {ack:?}"
    );

    // Nunca se manda `session.stop`: simula que el proceso se cae a mitad de sesión.
    // `Child::kill()` en Unix manda SIGKILL — literalmente `kill -9`.
    child.kill().expect("kill -9");
    child.wait().expect("wait tras kill");

    // Con el proceso muerto, `qua recover <id>` reconstruye desde `raw/`.
    let output = Command::new(qua_bin())
        .arg("recover")
        .arg(&session_id)
        .env("QUA_HOME", &data_dir)
        .output()
        .expect("run qua recover");
    assert!(
        output.status.success(),
        "qua recover falló: stdout={} stderr={}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );

    let session_json_path = data_dir
        .join("sessions")
        .join(&session_id)
        .join("session.json");
    let session_json =
        std::fs::read_to_string(&session_json_path).expect("session.json reconstruido");
    let session: qua_protocol::Session = serde_json::from_str(&session_json).expect("parse");

    assert_eq!(
        session.events.len(),
        N as usize,
        "recover tiene que traer los 5000 eventos ackeados"
    );
    assert_eq!(
        session.status,
        qua_protocol::SessionStatus::Recording,
        "nunca llegó session.stop: sigue 'recording' (D-02)"
    );
    assert!(session.ended_at.is_none());
    assert_eq!(session.id, session_id);

    let conn = qua_core::store::open(&data_dir).expect("open store");
    let count: i64 = conn
        .query_row(
            "SELECT count(*) FROM sessions WHERE id = ?1",
            [&session_id],
            |r| r.get(0),
        )
        .expect("query sessions");
    assert_eq!(count, 1, "recover también deja la fila en SQLite");
}

fn drain_in_background(mut pipe: impl Read + Send + 'static) {
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match pipe.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(_) => {}
            }
        }
    });
}

async fn wait_for_port(port: u16) {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    loop {
        if tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .is_ok()
        {
            return;
        }
        if tokio::time::Instant::now() > deadline {
            panic!("quad nunca abrió el puerto {port}");
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

async fn send(
    write: &mut (impl SinkExt<WsMessage, Error = tokio_tungstenite::tungstenite::Error> + Unpin),
    msg: &ClientMessage,
) {
    let text = serde_json::to_string(msg).expect("serialize");
    write.send(WsMessage::Text(text)).await.expect("send");
}

async fn recv(
    read: &mut (impl StreamExt<Item = Result<WsMessage, tokio_tungstenite::tungstenite::Error>> + Unpin),
) -> ServerMessage {
    loop {
        let msg = read
            .next()
            .await
            .expect("stream terminó")
            .expect("ws error");
        if let WsMessage::Text(text) = msg {
            if let Ok(parsed) = serde_json::from_str::<ServerMessage>(&text) {
                return parsed;
            }
        }
    }
}
