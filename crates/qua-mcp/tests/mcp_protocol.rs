//! Test de aceptación de D1: levanta el binario `qua-mcp` como subproceso, le habla el
//! protocolo MCP real por stdio (JSON-RPC 2.0 línea por línea) contra una DB sembrada
//! desde `tests/fixtures/`, y ejerce las 5 herramientas de §10.
//!
//! El criterio explícito de la tarea: después de `qua_issue_mark_exported`,
//! `qua_issues_pending` deja de devolver ese issue.

use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};

use rusqlite::{params, Connection};
use serde_json::{json, Value};

const FIXTURES: &str = env!("CARGO_MANIFEST_DIR");

fn fixtures_dir() -> std::path::PathBuf {
    Path::new(FIXTURES).join("tests/fixtures")
}

/// Arma la DB en `db_path` aplicando el esquema real de `qua-core` (§03) e insertando
/// las filas de `tests/fixtures/seed.json`, con `dir` apuntando al directorio de sesión
/// sembrado (`tests/fixtures/session/`, que ya tiene `report.md` + `issues.json` +
/// `session.json`).
fn seed_db(db_path: &Path) {
    let seed_raw =
        std::fs::read_to_string(fixtures_dir().join("seed.json")).expect("leer seed.json");
    let seed: Value = serde_json::from_str(&seed_raw).expect("parsear seed.json");
    let session_dir = fixtures_dir().join("session");
    let session_dir = session_dir.to_str().expect("path utf8");

    let conn = Connection::open(db_path).expect("abrir db para sembrar");
    qua_core::store::apply_schema(&conn).expect("aplicar esquema");

    let s = &seed["session"];
    conn.execute(
        "INSERT INTO sessions (id, status, project, started_at, duration_ms, issue_count, dir, git_sha)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            s["id"].as_str().unwrap(),
            s["status"].as_str().unwrap(),
            s["project"].as_str().unwrap(),
            s["started_at"].as_str().unwrap(),
            s["duration_ms"].as_i64().unwrap(),
            s["issue_count"].as_i64().unwrap(),
            session_dir,
            s["git_sha"].as_str().unwrap(),
        ],
    )
    .expect("insertar sesión sembrada");

    for issue in seed["issues"].as_array().unwrap() {
        conn.execute(
            "INSERT INTO issues (id, session_id, t, text, category, severity, confidence, anchor_kind, sel, url, src_file, src_line, exported_to, json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            params![
                issue["id"].as_str().unwrap(),
                s["id"].as_str().unwrap(),
                issue["t"].as_i64().unwrap(),
                issue["text"].as_str().unwrap(),
                issue["category"].as_str().unwrap(),
                issue["severity"].as_str().unwrap(),
                issue["confidence"].as_f64().unwrap(),
                issue["anchor_kind"].as_str().unwrap(),
                issue["sel"].as_str(),
                issue["url"].as_str(),
                issue["src_file"].as_str(),
                issue["src_line"].as_i64(),
                issue["exported_to"].as_str(),
                serde_json::to_string(&issue["json"]).unwrap(),
            ],
        )
        .expect("insertar issue sembrado");
    }
}

struct McpClient {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<std::process::ChildStdout>,
    next_id: i64,
}

impl McpClient {
    fn spawn(db_path: &Path) -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_qua-mcp"))
            .arg("--db")
            .arg(db_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .expect("lanzar qua-mcp");
        let stdin = child.stdin.take().expect("stdin");
        let stdout = BufReader::new(child.stdout.take().expect("stdout"));
        McpClient {
            child,
            stdin,
            stdout,
            next_id: 1,
        }
    }

    fn send(&mut self, value: &Value) {
        let mut line = value.to_string();
        line.push('\n');
        self.stdin
            .write_all(line.as_bytes())
            .expect("escribir a stdin");
        self.stdin.flush().expect("flush stdin");
    }

    fn recv(&mut self) -> Value {
        let mut line = String::new();
        self.stdout.read_line(&mut line).expect("leer stdout");
        assert!(!line.is_empty(), "qua-mcp cerró stdout sin responder");
        serde_json::from_str(line.trim()).expect("respuesta no es JSON válido")
    }

    fn request(&mut self, method: &str, params: Value) -> Value {
        let id = self.next_id;
        self.next_id += 1;
        self.send(&json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }));
        let response = self.recv();
        assert_eq!(
            response["id"],
            json!(id),
            "respuesta con id distinto: {response}"
        );
        response
    }

    fn notify(&mut self, method: &str, params: Value) {
        self.send(&json!({ "jsonrpc": "2.0", "method": method, "params": params }));
    }

    fn call_tool(&mut self, name: &str, arguments: Value) -> Value {
        let response = self.request(
            "tools/call",
            json!({ "name": name, "arguments": arguments }),
        );
        let result = response
            .get("result")
            .unwrap_or_else(|| panic!("sin result: {response}"));
        assert_eq!(
            result.get("isError").and_then(Value::as_bool),
            Some(false),
            "la herramienta {name} devolvió isError=true: {result}"
        );
        let text = result["content"][0]["text"]
            .as_str()
            .expect("content[0].text");
        serde_json::from_str(text).expect("payload de la herramienta no es JSON")
    }

    fn shutdown(mut self) {
        drop(self.stdin);
        let _ = self.child.wait();
    }
}

fn handshake(client: &mut McpClient) {
    let init = client.request(
        "initialize",
        json!({ "protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": { "name": "test", "version": "0" } }),
    );
    assert_eq!(init["result"]["serverInfo"]["name"], json!("qua-mcp"));
    client.notify("notifications/initialized", json!({}));
}

#[test]
fn ejerce_las_5_herramientas_por_el_protocolo_mcp() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let db_path = tmp.path().join("qua.db");
    seed_db(&db_path);

    let mut client = McpClient::spawn(&db_path);
    handshake(&mut client);

    // tools/list expone exactamente las 5 de §10.
    let list = client.request("tools/list", json!({}));
    let names: Vec<&str> = list["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["name"].as_str().unwrap())
        .collect();
    for expected in [
        "qua_sessions_list",
        "qua_session_get",
        "qua_issues_pending",
        "qua_issues_search",
        "qua_issue_mark_exported",
    ] {
        assert!(
            names.contains(&expected),
            "falta la herramienta {expected} en tools/list: {names:?}"
        );
    }

    // qua_sessions_list
    let sessions = client.call_tool("qua_sessions_list", json!({}));
    let sessions_arr = sessions["sessions"].as_array().unwrap();
    assert_eq!(sessions_arr.len(), 1);
    assert_eq!(sessions_arr[0]["id"], json!("2026-09-04T14-32-11Z-a3f9"));
    assert_eq!(sessions_arr[0]["project"], json!("Agendi"));
    assert_eq!(sessions_arr[0]["issue_count"], json!(3));

    let filtered = client.call_tool("qua_sessions_list", json!({ "project": "OtroProyecto" }));
    assert_eq!(
        filtered["sessions"].as_array().unwrap().len(),
        0,
        "el filtro por proyecto no filtró"
    );

    // qua_session_get: report.md + issues.json del directorio de la sesión.
    let got = client.call_tool(
        "qua_session_get",
        json!({ "id": "2026-09-04T14-32-11Z-a3f9" }),
    );
    assert!(got["report_md"]
        .as_str()
        .unwrap()
        .contains("# QUA — Agendi"));
    assert_eq!(got["issues"].as_array().unwrap().len(), 3);
    assert!(
        got.get("session").is_none(),
        "sin include_events no debería traer session.json"
    );

    let got_full = client.call_tool(
        "qua_session_get",
        json!({ "id": "2026-09-04T14-32-11Z-a3f9", "include_events": true }),
    );
    assert!(!got_full["session"]["events"].as_array().unwrap().is_empty());

    // qua_issues_pending: exported_to IS NULL, ordenado por severidad (high antes que low).
    let pending = client.call_tool("qua_issues_pending", json!({}));
    let pending_ids: Vec<&str> = pending["issues"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["id"].as_str().unwrap())
        .collect();
    assert_eq!(
        pending_ids,
        vec!["i02", "i01"],
        "i03 ya está exportado y no debería aparecer, y el orden debe ser por severidad"
    );

    let pending_min_conf = client.call_tool("qua_issues_pending", json!({ "min_confidence": 0.8 }));
    assert_eq!(pending_min_conf["issues"].as_array().unwrap().len(), 1);

    // qua_issues_search: FTS5 sobre el texto. "turno*" (prefix) matchea tanto "turno"
    // (i01) como "turnos" (i03, ya exportado — la búsqueda no filtra por exported_to).
    let found = client.call_tool("qua_issues_search", json!({ "query": "turno*" }));
    let found_ids: Vec<&str> = found["issues"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["id"].as_str().unwrap())
        .collect();
    assert!(
        found_ids.contains(&"i01"),
        "la búsqueda FTS no encontró i01: {found_ids:?}"
    );
    assert!(
        found_ids.contains(&"i03"),
        "la búsqueda FTS también tiene que encontrar issues ya exportados: {found_ids:?}"
    );

    // qua_issue_mark_exported: la única escritura.
    let marked = client.call_tool(
        "qua_issue_mark_exported",
        json!({ "session_id": "2026-09-04T14-32-11Z-a3f9", "issue_id": "i01", "ticket_url": "https://linear.app/agendi/issue/AG-99" }),
    );
    assert_eq!(marked["ok"], json!(true));

    // Criterio de la tarea: mark_exported saca a i01 de qua_issues_pending.
    let pending_after = client.call_tool("qua_issues_pending", json!({}));
    let pending_after_ids: Vec<&str> = pending_after["issues"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["id"].as_str().unwrap())
        .collect();
    assert_eq!(
        pending_after_ids,
        vec!["i02"],
        "i01 debería haber desaparecido de pending tras mark_exported"
    );

    // Y sigue siendo buscable, ahora con su exported_to seteado.
    let still_found = client.call_tool("qua_issues_search", json!({ "query": "turno*" }));
    let still_found_arr = still_found["issues"].as_array().unwrap();
    let i01 = still_found_arr
        .iter()
        .find(|i| i["id"] == json!("i01"))
        .expect("i01 sigue siendo buscable");
    assert_eq!(
        i01["exported_to"],
        json!("https://linear.app/agendi/issue/AG-99")
    );

    client.shutdown();
}

/// Siembra una sesión mínima (sin directorio real: solo lo que necesitan
/// `qua_issues_pending`/`qua_issue_mark_exported`, que no tocan el filesystem) con un
/// único issue local `i01`.
fn seed_session_with_i01(conn: &Connection, session_id: &str, project: &str, text: &str) {
    conn.execute(
        "INSERT INTO sessions (id, status, project, started_at, duration_ms, issue_count, dir, git_sha)
         VALUES (?1, 'ready', ?2, '2026-09-04T14:32:11.204Z', 1000, 1, '/tmp/no-existe', NULL)",
        params![session_id, project],
    )
    .expect("insertar sesión");
    conn.execute(
        "INSERT INTO issues (id, session_id, t, text, category, severity, confidence, anchor_kind, sel, url, src_file, src_line, exported_to, json)
         VALUES ('i01', ?1, 100, ?2, 'ui', 'low', 0.9, 'element', NULL, NULL, NULL, NULL, NULL, ?3)",
        params![
            session_id,
            text,
            json!({
                "id": "i01",
                "utterance_ids": [],
                "t": 100,
                "text": text,
                "anchor": {
                    "kind": "session",
                    "target": null,
                    "tab": null,
                    "url": null,
                    "confidence": 0.9,
                    "reason": []
                },
                "evidence": {},
                "category": "ui",
                "severity": "low",
                "exported_to": null
            })
            .to_string(),
        ],
    )
    .expect("insertar issue i01");
}

/// D-B4-07: `issues.id` es correlativo *por sesión*, no global. Antes del fix, la
/// clave primaria era `id` sola, así que la segunda sesión pisaba el `i01` de la
/// primera en SQLite. Este test es la prueba de que el bug está muerto: dos sesiones
/// con su propio `i01` sobreviven las dos, y `qua_issues_pending` las devuelve juntas.
#[test]
fn dos_sesiones_con_el_mismo_id_local_i01_no_se_pisan() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let db_path = tmp.path().join("qua.db");
    {
        let conn = Connection::open(&db_path).expect("abrir db para sembrar");
        qua_core::store::apply_schema(&conn).expect("aplicar esquema");
        seed_session_with_i01(&conn, "sesion-a", "Agendi", "el botón de sesión A es re chico");
        seed_session_with_i01(&conn, "sesion-b", "Agendi", "el botón de sesión B tapa el header");
    }

    let mut client = McpClient::spawn(&db_path);
    handshake(&mut client);

    let pending = client.call_tool("qua_issues_pending", json!({}));
    let issues = pending["issues"].as_array().unwrap();
    assert_eq!(
        issues.len(),
        2,
        "las dos sesiones tienen que sobrevivir, no pisarse: {issues:?}"
    );

    let session_ids: std::collections::BTreeSet<&str> = issues
        .iter()
        .map(|i| i["session_id"].as_str().unwrap())
        .collect();
    assert_eq!(
        session_ids,
        std::collections::BTreeSet::from(["sesion-a", "sesion-b"]),
        "qua_issues_pending tiene que devolver el i01 de cada sesión"
    );
    for issue in issues {
        assert_eq!(issue["id"], json!("i01"));
    }

    // Y cada una se puede marcar exportada por separado sin afectar a la otra.
    let marked = client.call_tool(
        "qua_issue_mark_exported",
        json!({ "session_id": "sesion-a", "issue_id": "i01", "ticket_url": "https://x/1" }),
    );
    assert_eq!(marked["ok"], json!(true));

    let pending_after = client.call_tool("qua_issues_pending", json!({}));
    let after_ids: Vec<&str> = pending_after["issues"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["session_id"].as_str().unwrap())
        .collect();
    assert_eq!(
        after_ids,
        vec!["sesion-b"],
        "solo el i01 de sesion-a debería salir de pending, el de sesion-b sigue"
    );

    client.shutdown();
}

#[test]
fn mark_exported_sobre_issue_inexistente_devuelve_error_de_herramienta_no_de_protocolo() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let db_path = tmp.path().join("qua.db");
    seed_db(&db_path);

    let mut client = McpClient::spawn(&db_path);
    handshake(&mut client);

    let response = client.request(
        "tools/call",
        json!({ "name": "qua_issue_mark_exported", "arguments": { "session_id": "2026-09-04T14-32-11Z-a3f9", "issue_id": "no-existe", "ticket_url": "https://x" } }),
    );
    let result = &response["result"];
    assert_eq!(result["isError"], json!(true));

    client.shutdown();
}
