//! Las 5 herramientas de §10, sus parámetros exactos y sus JSON Schema para `tools/list`.

use std::path::Path;

use rusqlite::Connection;
use serde_json::{json, Value};

use crate::db::{self, open_read_only, open_read_write};

#[derive(Debug, thiserror::Error)]
pub enum ToolError {
    #[error("parámetro inválido: {0}")]
    BadParams(String),
    #[error("SQLite: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("IO: {0}")]
    Io(#[from] std::io::Error),
    #[error("no encontrado: {0}")]
    NotFound(String),
}

pub type ToolResult = Result<Value, ToolError>;

/// Metadata de una herramienta para `tools/list`: nombre, descripción y JSON Schema de
/// sus parámetros, tal como los pide §10.
pub struct ToolSpec {
    pub name: &'static str,
    pub description: &'static str,
    pub input_schema: Value,
}

pub fn specs() -> Vec<ToolSpec> {
    vec![
        ToolSpec {
            name: "qua_sessions_list",
            description: "Lista sesiones grabadas: id, fecha, proyecto, duración, cantidad de issues y estado.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "limit": {"type": "integer", "minimum": 1, "description": "Máximo de sesiones a devolver (default 20)."},
                    "since": {"type": "string", "description": "ISO 8601. Solo sesiones con started_at >= since."},
                    "project": {"type": "string", "description": "Filtra por el label de proyecto exacto (§13)."}
                },
                "additionalProperties": false
            }),
        },
        ToolSpec {
            name: "qua_session_get",
            description: "Devuelve report.md + issues.json de una sesión (y opcionalmente session.json completo).",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Id de la sesión, ej. 2026-09-04T14-32-11Z-a3f9."},
                    "include_events": {"type": "boolean", "default": false, "description": "Si es true, agrega session.json completo (con los eventos crudos)."}
                },
                "required": ["id"],
                "additionalProperties": false
            }),
        },
        ToolSpec {
            name: "qua_issues_pending",
            description: "Issues con exported_to IS NULL, ordenados por severidad (y luego confianza).",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "project": {"type": "string", "description": "Filtra por el label de proyecto exacto de la sesión dueña."},
                    "min_confidence": {"type": "number", "minimum": 0, "maximum": 1, "description": "Confianza mínima del anclaje (default 0)."},
                    "category": {"type": "string", "enum": ["ui", "bug", "perf", "copy", "idea"]}
                },
                "additionalProperties": false
            }),
        },
        ToolSpec {
            name: "qua_issues_search",
            description: "Búsqueda FTS5 sobre el texto de todos los issues.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Consulta FTS5 (sintaxis de SQLite: términos, prefix*, \"frase\")."},
                    "project": {"type": "string", "description": "Filtra por el label de proyecto exacto de la sesión dueña."}
                },
                "required": ["query"],
                "additionalProperties": false
            }),
        },
        ToolSpec {
            name: "qua_issue_mark_exported",
            description: "Única escritura permitida: marca un issue como exportado a un ticket. Idempotente.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "session_id": {"type": "string", "description": "Id de la sesión dueña del issue (campo `session_id` que trae cada issue de qua_issues_pending/qua_issues_search). El id de issue es correlativo por sesión, así que hace falta el par para identificarlo sin ambigüedad (docs/DECISIONS.md, D-B4-07)."},
                    "issue_id": {"type": "string", "description": "Id del issue *dentro de esa sesión*, ej. i03."},
                    "ticket_url": {"type": "string", "description": "URL del ticket creado, ej. https://linear.app/..."}
                },
                "required": ["session_id", "issue_id", "ticket_url"],
                "additionalProperties": false
            }),
        },
    ]
}

fn get_str<'a>(args: &'a Value, key: &str) -> Option<&'a str> {
    args.get(key).and_then(Value::as_str)
}

fn get_f64(args: &Value, key: &str) -> Option<f64> {
    args.get(key).and_then(Value::as_f64)
}

fn get_i64(args: &Value, key: &str) -> Option<i64> {
    args.get(key).and_then(Value::as_i64)
}

fn get_bool(args: &Value, key: &str) -> Option<bool> {
    args.get(key).and_then(Value::as_bool)
}

fn severity_rank_case() -> &'static str {
    "CASE severity WHEN 'high' THEN 3 WHEN 'med' THEN 2 WHEN 'low' THEN 1 ELSE 0 END"
}

/// Despacha `tools/call` al nombre pedido. `db_path` es la única fuente de conexión:
/// cada llamado abre la suya (más lectura-escritura solo si hace falta) y la cierra al
/// terminar, así ninguna herramienta retiene un lock más de lo que dura su consulta.
pub fn call(name: &str, args: &Value, db_path: &Path) -> ToolResult {
    match name {
        "qua_sessions_list" => sessions_list(&open_read_only(db_path)?, args),
        "qua_session_get" => session_get(&open_read_only(db_path)?, args),
        "qua_issues_pending" => issues_pending(&open_read_only(db_path)?, args),
        "qua_issues_search" => issues_search(&open_read_only(db_path)?, args),
        "qua_issue_mark_exported" => issue_mark_exported(&open_read_write(db_path)?, args),
        other => Err(ToolError::BadParams(format!(
            "herramienta desconocida: {other}"
        ))),
    }
}

fn sessions_list(conn: &Connection, args: &Value) -> ToolResult {
    let limit = get_i64(args, "limit").unwrap_or(20);
    let since = get_str(args, "since");
    let project = get_str(args, "project");

    let mut stmt = conn.prepare(
        "SELECT id, status, project, started_at, duration_ms, issue_count
         FROM sessions
         WHERE (?1 IS NULL OR started_at >= ?1)
           AND (?2 IS NULL OR project = ?2)
         ORDER BY started_at DESC
         LIMIT ?3",
    )?;
    let rows = stmt.query_map(rusqlite::params![since, project, limit], |r| {
        Ok(json!({
            "id": r.get::<_, String>(0)?,
            "status": r.get::<_, Option<String>>(1)?,
            "project": r.get::<_, Option<String>>(2)?,
            "started_at": r.get::<_, Option<String>>(3)?,
            "duration_ms": r.get::<_, Option<i64>>(4)?,
            "issue_count": r.get::<_, Option<i64>>(5)?,
        }))
    })?;
    let sessions: Result<Vec<Value>, rusqlite::Error> = rows.collect();
    Ok(json!({ "sessions": sessions? }))
}

fn session_get(conn: &Connection, args: &Value) -> ToolResult {
    let id = get_str(args, "id").ok_or_else(|| ToolError::BadParams("falta id".into()))?;
    let include_events = get_bool(args, "include_events").unwrap_or(false);

    let dir: String = conn
        .query_row("SELECT dir FROM sessions WHERE id = ?1", [id], |r| r.get(0))
        .map_err(|_| ToolError::NotFound(format!("sesión {id}")))?;
    let dir = Path::new(&dir);

    let report_md = std::fs::read_to_string(dir.join("report.md"))?;
    let issues_raw = std::fs::read_to_string(dir.join("issues.json"))?;
    let issues: Value = serde_json::from_str(&issues_raw)
        .map_err(|e| ToolError::BadParams(format!("issues.json inválido: {e}")))?;

    let mut out = json!({
        "id": id,
        "report_md": report_md,
        "issues": issues,
    });
    if include_events {
        let session_raw = std::fs::read_to_string(dir.join("session.json"))?;
        let session: Value = serde_json::from_str(&session_raw)
            .map_err(|e| ToolError::BadParams(format!("session.json inválido: {e}")))?;
        out["session"] = session;
    }
    Ok(out)
}

fn issues_pending(conn: &Connection, args: &Value) -> ToolResult {
    let project = get_str(args, "project");
    let min_confidence = get_f64(args, "min_confidence").unwrap_or(0.0);
    let category = get_str(args, "category");

    let sql = format!(
        "SELECT i.json, i.session_id
         FROM issues i JOIN sessions s ON s.id = i.session_id
         WHERE i.exported_to IS NULL
           AND (?1 IS NULL OR s.project = ?1)
           AND i.confidence >= ?2
           AND (?3 IS NULL OR i.category = ?3)
         ORDER BY {rank} DESC, i.confidence DESC",
        rank = severity_rank_case()
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params![project, min_confidence, category], |r| {
        let raw: String = r.get(0)?;
        let session_id: String = r.get(1)?;
        Ok((raw, session_id))
    })?;
    let issues = parse_issue_rows(rows)?;
    Ok(json!({ "issues": issues }))
}

fn issues_search(conn: &Connection, args: &Value) -> ToolResult {
    let query = get_str(args, "query").ok_or_else(|| ToolError::BadParams("falta query".into()))?;
    let project = get_str(args, "project");

    let mut stmt = conn.prepare(
        "SELECT i.json, i.session_id
         FROM issues_fts f
         JOIN issues i ON i.rowid = f.rowid
         JOIN sessions s ON s.id = i.session_id
         WHERE issues_fts MATCH ?1
           AND (?2 IS NULL OR s.project = ?2)
         ORDER BY bm25(issues_fts)",
    )?;
    let rows = stmt.query_map(rusqlite::params![query, project], |r| {
        let raw: String = r.get(0)?;
        let session_id: String = r.get(1)?;
        Ok((raw, session_id))
    })?;
    let issues = parse_issue_rows(rows)?;
    Ok(json!({ "issues": issues }))
}

/// Cada fila de `issues.json` ya es un `Issue` serializado entero (§03): se parsea tal
/// cual y se le agrega `session_id`, que no vive en `Issue` pero hace falta para que el
/// agente sepa a qué sesión pertenece.
fn parse_issue_rows(
    rows: impl Iterator<Item = rusqlite::Result<(String, String)>>,
) -> Result<Vec<Value>, ToolError> {
    let mut out = Vec::new();
    for row in rows {
        let (raw, session_id) = row?;
        let mut issue: Value = serde_json::from_str(&raw)
            .map_err(|e| ToolError::BadParams(format!("issues.json de fila inválido: {e}")))?;
        if let Some(obj) = issue.as_object_mut() {
            obj.insert("session_id".to_string(), json!(session_id));
        }
        out.push(issue);
    }
    Ok(out)
}

fn issue_mark_exported(conn: &Connection, args: &Value) -> ToolResult {
    let session_id = get_str(args, "session_id")
        .ok_or_else(|| ToolError::BadParams("falta session_id".into()))?;
    let issue_id =
        get_str(args, "issue_id").ok_or_else(|| ToolError::BadParams("falta issue_id".into()))?;
    let ticket_url = get_str(args, "ticket_url")
        .ok_or_else(|| ToolError::BadParams("falta ticket_url".into()))?;

    // `json` también trae su propio `exported_to`: si no se actualiza ahí, un
    // `qua_session_get` posterior mostraría el issue como no exportado aunque
    // `qua_issues_pending` ya lo haya dejado de listar. Se hace en Rust (en vez de
    // `json_set` de SQLite) para no depender de que la build de SQLite tenga JSON1.
    //
    // `id` es correlativo por sesión (D-B4-07): hace falta el par (session_id, id) para
    // no pisar el issue equivocado si dos sesiones comparten el mismo id local.
    let raw: String = conn
        .query_row(
            "SELECT json FROM issues WHERE session_id = ?1 AND id = ?2",
            [session_id, issue_id],
            |r| r.get(0),
        )
        .map_err(|_| ToolError::NotFound(format!("issue {session_id}/{issue_id}")))?;
    let mut issue: Value = serde_json::from_str(&raw)
        .map_err(|e| ToolError::BadParams(format!("issues.json de fila inválido: {e}")))?;
    if let Some(obj) = issue.as_object_mut() {
        obj.insert("exported_to".to_string(), json!(ticket_url));
    }
    let updated_json = serde_json::to_string(&issue)
        .map_err(|e| ToolError::BadParams(format!("no se pudo serializar el issue: {e}")))?;

    conn.execute(
        "UPDATE issues SET exported_to = ?1, json = ?2 WHERE session_id = ?3 AND id = ?4",
        rusqlite::params![ticket_url, updated_json, session_id, issue_id],
    )?;
    Ok(json!({ "ok": true, "session_id": session_id, "issue_id": issue_id, "ticket_url": ticket_url }))
}

pub fn resolve_db_path(explicit: Option<&str>) -> std::path::PathBuf {
    explicit
        .map(std::path::PathBuf::from)
        .unwrap_or_else(db::default_db_path)
}
