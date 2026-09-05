//! `POST /pair/auto` (D-U1-01): trust-on-first-use para saltar el código de 6
//! dígitos cuando nadie emparejó nunca con este daemon. Criterio de aceptación:
//! acepta con `paired_extensions` vacío, 409 si ya hay una extensión emparejada,
//! 401 con `Origin` inválido o ausente.

use quad::config::Config;

const ORIGIN: &str = "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

async fn start_daemon() -> (u16, tempfile::TempDir) {
    let dir = tempfile::tempdir().expect("tmpdir");
    let data_dir = dir.path().to_path_buf();

    let (listener, state) = quad::server::prepare(Some(0), data_dir)
        .await
        .expect("prepare");
    let port = listener.local_addr().expect("local_addr").port();
    tokio::spawn(quad::server::serve(listener, state));
    (port, dir)
}

async fn start_daemon_with_config(cfg: Config) -> (u16, tempfile::TempDir) {
    let dir = tempfile::tempdir().expect("tmpdir");
    let data_dir = dir.path().to_path_buf();
    cfg.save(&data_dir.join("config.toml")).expect("save config");

    let (listener, state) = quad::server::prepare(Some(0), data_dir)
        .await
        .expect("prepare");
    let port = listener.local_addr().expect("local_addr").port();
    tokio::spawn(quad::server::serve(listener, state));
    (port, dir)
}

#[tokio::test(flavor = "multi_thread")]
async fn con_lista_vacia_empareja_y_devuelve_token() {
    let (port, _dir) = start_daemon().await;
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("http://127.0.0.1:{port}/pair/auto"))
        .header("Origin", ORIGIN)
        .send()
        .await
        .expect("request");

    assert_eq!(resp.status(), reqwest::StatusCode::OK);
    let body: serde_json::Value = resp.json().await.expect("json");
    let token = body["token"].as_str().expect("token");
    assert_eq!(token.len(), 64);
    assert!(token.chars().all(|c| c.is_ascii_hexdigit()));
}

#[tokio::test(flavor = "multi_thread")]
async fn con_lista_no_vacia_devuelve_409() {
    let mut cfg = Config::default();
    cfg.add_paired_extension(
        "chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".to_string(),
        "ya-emparejado".to_string(),
    );
    let (port, _dir) = start_daemon_with_config(cfg).await;

    let client = reqwest::Client::new();
    let resp = client
        .post(format!("http://127.0.0.1:{port}/pair/auto"))
        .header("Origin", ORIGIN)
        .send()
        .await
        .expect("request");

    assert_eq!(resp.status(), reqwest::StatusCode::CONFLICT);
}

#[tokio::test(flavor = "multi_thread")]
async fn con_origin_invalido_devuelve_401() {
    let (port, _dir) = start_daemon().await;
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("http://127.0.0.1:{port}/pair/auto"))
        .header("Origin", "https://evil.example")
        .send()
        .await
        .expect("request");

    assert_eq!(resp.status(), reqwest::StatusCode::UNAUTHORIZED);
}

#[tokio::test(flavor = "multi_thread")]
async fn sin_origin_devuelve_401() {
    let (port, _dir) = start_daemon().await;
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("http://127.0.0.1:{port}/pair/auto"))
        .send()
        .await
        .expect("request");

    assert_eq!(resp.status(), reqwest::StatusCode::UNAUTHORIZED);
}

#[tokio::test(flavor = "multi_thread")]
async fn el_token_emitido_queda_en_la_allowlist() {
    let (port, dir) = start_daemon().await;
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("http://127.0.0.1:{port}/pair/auto"))
        .header("Origin", ORIGIN)
        .send()
        .await
        .expect("request");
    let body: serde_json::Value = resp.json().await.expect("json");
    let token = body["token"].as_str().expect("token").to_string();

    let cfg = Config::load(&dir.path().join("config.toml")).expect("load");
    assert!(cfg.is_allowed(ORIGIN, &token));
}
