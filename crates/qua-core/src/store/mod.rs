//! Persistencia: SQLite (WAL) para el índice, archivos para el contenido (§01).
//!
//! **F0 solo entrega el esquema y la función que lo aplica.** El store completo
//! (ingesta, append de ndjson, recover) lo implementa la tarea B1.

use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension};

use qua_protocol::{AnchorKind, Issue, Session, SessionStatus};

/// El esquema de §03, embebido en el binario para que no dependa del cwd.
pub const SCHEMA_SQL: &str = include_str!("schema.sql");

/// Nombre del archivo SQLite dentro del directorio de datos (`~/.qua/qua.db`).
pub const DB_FILE_NAME: &str = "qua.db";

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("SQLite: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("IO: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON: {0}")]
    Json(#[from] serde_json::Error),
}

/// Aplica el esquema de §03 sobre una conexión abierta.
///
/// Es idempotente (`IF NOT EXISTS` en todo), así que se puede llamar en cada arranque
/// del daemon sin chequear nada antes.
pub fn apply_schema(conn: &Connection) -> Result<(), StoreError> {
    conn.execute_batch(SCHEMA_SQL)?;
    Ok(())
}

/// Abre (creando el directorio y el archivo si hace falta) el SQLite de `data_dir` con
/// el esquema de §03 ya aplicado. Cada llamador abre su propia conexión — WAL permite
/// que el daemon escriba mientras `qua-mcp` lee (§01).
pub fn open(data_dir: &Path) -> Result<Connection, StoreError> {
    std::fs::create_dir_all(data_dir)?;
    let conn = Connection::open(data_dir.join(DB_FILE_NAME))?;
    apply_schema(&conn)?;
    Ok(conn)
}

fn status_str(status: SessionStatus) -> &'static str {
    match status {
        SessionStatus::Recording => "recording",
        SessionStatus::Processing => "processing",
        SessionStatus::Ready => "ready",
        SessionStatus::Failed => "failed",
    }
}

/// Inserta o actualiza la fila de `sessions` (§03) para una `Session`. `dir` es la
/// ruta absoluta de `~/.qua/sessions/<id>/`, que el esquema guarda para que `qua-mcp`
/// no tenga que reconstruirla.
///
/// No toca `issues`: poblar esa tabla es de B3/B4, cuando el correlador produce algo
/// que insertar. B1 solo deja la fila de la sesión en pie desde que arranca.
pub fn upsert_session(conn: &Connection, session: &Session, dir: &str) -> Result<(), StoreError> {
    conn.execute(
        "INSERT INTO sessions (id, status, project, started_at, duration_ms, issue_count, dir, git_sha)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           project = excluded.project,
           started_at = excluded.started_at,
           duration_ms = excluded.duration_ms,
           issue_count = excluded.issue_count,
           dir = excluded.dir,
           git_sha = excluded.git_sha",
        params![
            session.id,
            status_str(session.status),
            session.project.label,
            session.started_at,
            session.duration_ms,
            session.stats.issues,
            dir,
            session.git.as_ref().map(|g| g.sha.clone()),
        ],
    )?;
    Ok(())
}

fn anchor_kind_str(kind: AnchorKind) -> &'static str {
    match kind {
        AnchorKind::Element => "element",
        AnchorKind::Route => "route",
        AnchorKind::Session => "session",
    }
}

/// Puebla `issues` (§03) a partir de los issues de una `Session` ya corrida por el
/// correlador. Es de B4/B3 — B1 solo deja la fila de `sessions` en pie (ver el
/// comentario de [`upsert_session`]).
///
/// `INSERT OR REPLACE` por `id`: nota la limitación real de este esquema en
/// `docs/DECISIONS.md` (D-B4-07) — `issues.id` es la clave primaria global, no
/// compuesta con `session_id`, así que dos sesiones distintas con un `i01` chocan. No
/// es un problema que B4 pueda resolver sin tocar el esquema de F0.
pub fn upsert_issues(
    conn: &Connection,
    session_id: &str,
    issues: &[Issue],
) -> Result<(), StoreError> {
    for issue in issues {
        let json = serde_json::to_string(issue)?;
        conn.execute(
            "INSERT INTO issues (id, session_id, t, text, category, severity, confidence, anchor_kind, sel, url, src_file, src_line, exported_to, json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
             ON CONFLICT(id) DO UPDATE SET
               session_id = excluded.session_id,
               t = excluded.t,
               text = excluded.text,
               category = excluded.category,
               severity = excluded.severity,
               confidence = excluded.confidence,
               anchor_kind = excluded.anchor_kind,
               sel = excluded.sel,
               url = excluded.url,
               src_file = excluded.src_file,
               src_line = excluded.src_line,
               exported_to = excluded.exported_to,
               json = excluded.json",
            params![
                issue.id,
                session_id,
                issue.t,
                issue.text,
                category_str(issue.category),
                severity_str(issue.severity),
                issue.anchor.confidence,
                anchor_kind_str(issue.anchor.kind),
                issue.anchor.target.as_ref().map(|t| t.sel.clone()),
                issue.anchor.url,
                issue
                    .anchor
                    .target
                    .as_ref()
                    .and_then(|t| t.src.as_ref())
                    .map(|s| s.file.clone()),
                issue
                    .anchor
                    .target
                    .as_ref()
                    .and_then(|t| t.src.as_ref())
                    .map(|s| s.line),
                issue.exported_to,
                json,
            ],
        )?;
    }
    Ok(())
}

fn category_str(c: qua_protocol::IssueCategory) -> &'static str {
    use qua_protocol::IssueCategory::*;
    match c {
        Ui => "ui",
        Bug => "bug",
        Perf => "perf",
        Copy => "copy",
        Idea => "idea",
    }
}

fn severity_str(s: qua_protocol::Severity) -> &'static str {
    use qua_protocol::Severity::*;
    match s {
        Low => "low",
        Med => "med",
        High => "high",
    }
}

/// Una fila de `sessions` (§03), tal como la leen `qua sessions`/`qua show` sin tener
/// que releer `session.json` solo para listar.
#[derive(Debug, Clone, PartialEq)]
pub struct SessionRow {
    pub id: String,
    pub status: String,
    pub project: String,
    pub started_at: String,
    pub duration_ms: Option<i64>,
    pub issue_count: i64,
    pub dir: String,
    pub git_sha: Option<String>,
}

fn row_to_session_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SessionRow> {
    Ok(SessionRow {
        id: row.get(0)?,
        status: row.get(1)?,
        project: row.get(2)?,
        started_at: row.get(3)?,
        duration_ms: row.get(4)?,
        issue_count: row.get(5)?,
        dir: row.get(6)?,
        git_sha: row.get(7)?,
    })
}

const SESSION_COLUMNS: &str =
    "id, status, project, started_at, duration_ms, issue_count, dir, git_sha";

/// `qua sessions [--project X] [--limit N]` (§6.2): más recientes primero.
pub fn list_sessions(
    conn: &Connection,
    project: Option<&str>,
    limit: Option<i64>,
) -> Result<Vec<SessionRow>, StoreError> {
    let limit = limit.unwrap_or(i64::MAX);
    let mut stmt = conn.prepare(&format!(
        "SELECT {SESSION_COLUMNS} FROM sessions
         WHERE ?1 IS NULL OR project = ?1
         ORDER BY started_at DESC
         LIMIT ?2"
    ))?;
    let rows = stmt
        .query_map(params![project, limit], row_to_session_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// `qua show <id>` (§6.2).
pub fn get_session(conn: &Connection, id: &str) -> Result<Option<SessionRow>, StoreError> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {SESSION_COLUMNS} FROM sessions WHERE id = ?1"
    ))?;
    let row = stmt.query_row(params![id], row_to_session_row).optional()?;
    Ok(row)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tablas(conn: &Connection) -> Vec<String> {
        let mut stmt = conn
            .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','index','trigger') ORDER BY name")
            .expect("prepare");
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .expect("query")
            .map(|r| r.expect("row"))
            .collect();
        rows
    }

    #[test]
    fn aplica_el_esquema_y_es_idempotente() {
        let conn = Connection::open_in_memory().expect("memoria");
        apply_schema(&conn).expect("primera vez");
        apply_schema(&conn).expect("segunda vez: tiene que ser idempotente");

        let objetos = tablas(&conn);
        for esperado in ["sessions", "issues", "idx_pending", "issues_fts"] {
            assert!(
                objetos.iter().any(|o| o == esperado),
                "falta {esperado} en {objetos:?}"
            );
        }
    }

    #[test]
    fn fts5_indexa_lo_que_se_inserta_en_issues() {
        let conn = Connection::open_in_memory().expect("memoria");
        apply_schema(&conn).expect("esquema");

        conn.execute(
            "INSERT INTO sessions (id, status, project, started_at, duration_ms, issue_count, dir, git_sha)
             VALUES ('2026-09-04T14-32-11Z-a3f9', 'ready', 'Agendi', '2026-09-04T14:32:11.204Z', 412308, 1, '/tmp/s', '9f21ac3')",
            [],
        )
        .expect("insert session");
        conn.execute(
            "INSERT INTO issues (id, session_id, t, text, category, severity, confidence, anchor_kind, sel, url, src_file, src_line, exported_to, json)
             VALUES ('i01', '2026-09-04T14-32-11Z-a3f9', 5100,
                     'este botón de nuevo turno es re chico', 'ui', 'low', 0.91, 'element',
                     'button[data-testid=\"nuevo-turno\"]', 'http://localhost:3000/agenda/semana',
                     'src/components/AgendaHeader.tsx', 42, NULL, '{}')",
            [],
        )
        .expect("insert issue");

        let hits: i64 = conn
            .query_row(
                "SELECT count(*) FROM issues_fts WHERE issues_fts MATCH 'turno'",
                [],
                |r| r.get(0),
            )
            .expect("match fts");
        assert_eq!(hits, 1, "el trigger de FTS5 no pobló el índice");

        // `qua_issues_pending` filtra por `exported_to IS NULL`.
        let pendientes: i64 = conn
            .query_row(
                "SELECT count(*) FROM issues WHERE exported_to IS NULL",
                [],
                |r| r.get(0),
            )
            .expect("pendientes");
        assert_eq!(pendientes, 1);
    }

    fn sample_session(id: &str, project: &str, issues: Vec<qua_protocol::Issue>) -> Session {
        use qua_protocol::*;
        Session {
            schema: SessionSchemaTag,
            id: id.to_string(),
            status: SessionStatus::Ready,
            t0_wall: 0,
            started_at: "2026-09-04T14:32:11.204Z".into(),
            ended_at: Some("2026-09-04T14:39:03.512Z".into()),
            duration_ms: Some(1000),
            project: ProjectRef {
                label: project.to_string(),
                repo: None,
            },
            git: None,
            env: EnvInfo {
                ua: "ua".into(),
                chrome: "142.0".into(),
                platform: "macOS 15.1".into(),
                viewport: ViewportInfo {
                    w: 1512,
                    h: 857,
                    dpr: 2.0,
                },
                ext: "1.0.0".into(),
            },
            audio: AudioInfo {
                path: "audio.opus".into(),
                sample_rate: 16000,
                gaps_ms: 0,
            },
            stats: SessionStats {
                events_raw: 0,
                events_kept: 0,
                utterances: 0,
                issues: issues.len() as i64,
            },
            tabs: vec![],
            events: vec![],
            utterances: vec![],
            issues,
        }
    }

    fn sample_issue(id: &str) -> qua_protocol::Issue {
        use qua_protocol::*;
        Issue {
            id: id.to_string(),
            utterance_ids: vec![],
            t: 100,
            text: "un texto de prueba".into(),
            anchor: Anchor {
                kind: AnchorKind::Element,
                target: Some(TargetRef {
                    sel: "button#x".into(),
                    strategy: SelectorStrategy::Id,
                    tag: "button".into(),
                    text: None,
                    role: None,
                    name: None,
                    rect: None,
                    visible: None,
                    classes: None,
                    computed: None,
                    component: None,
                    src: Some(SourceRef {
                        file: "src/x.tsx".into(),
                        line: 1,
                        col: None,
                        tier: 2,
                    }),
                }),
                tab: Some(1),
                url: Some("http://localhost/x".into()),
                confidence: 0.9,
                reason: vec![],
            },
            evidence: Evidence::default(),
            category: IssueCategory::Ui,
            severity: Severity::Low,
            exported_to: None,
        }
    }

    #[test]
    fn upsert_issues_es_idempotente_y_puebla_fts() {
        let conn = Connection::open_in_memory().expect("memoria");
        apply_schema(&conn).expect("esquema");
        let session = sample_session("s1", "Agendi", vec![sample_issue("i01")]);
        upsert_session(&conn, &session, "/tmp/s1").expect("session");

        upsert_issues(&conn, &session.id, &session.issues).expect("primera vez");
        upsert_issues(&conn, &session.id, &session.issues).expect("segunda vez: idempotente");

        let count: i64 = conn
            .query_row("SELECT count(*) FROM issues", [], |r| r.get(0))
            .expect("count");
        assert_eq!(count, 1, "un upsert repetido no puede duplicar filas");

        let hits: i64 = conn
            .query_row(
                "SELECT count(*) FROM issues_fts WHERE issues_fts MATCH 'prueba'",
                [],
                |r| r.get(0),
            )
            .expect("fts");
        assert_eq!(hits, 1);
    }

    #[test]
    fn list_sessions_filtra_por_proyecto_y_respeta_limit() {
        let conn = Connection::open_in_memory().expect("memoria");
        apply_schema(&conn).expect("esquema");

        let mut a = sample_session("s-a", "Agendi", vec![]);
        a.started_at = "2026-09-01T00:00:00.000Z".into();
        let mut b = sample_session("s-b", "Agendi", vec![]);
        b.started_at = "2026-09-02T00:00:00.000Z".into();
        let c = sample_session("s-c", "Otro", vec![]);
        upsert_session(&conn, &a, "/tmp/a").unwrap();
        upsert_session(&conn, &b, "/tmp/b").unwrap();
        upsert_session(&conn, &c, "/tmp/c").unwrap();

        let agendi = list_sessions(&conn, Some("Agendi"), None).expect("list");
        assert_eq!(agendi.len(), 2);
        assert_eq!(agendi[0].id, "s-b", "más reciente primero");

        let all = list_sessions(&conn, None, None).expect("list sin filtro");
        assert_eq!(all.len(), 3);

        let limited = list_sessions(&conn, None, Some(1)).expect("list con limit");
        assert_eq!(limited.len(), 1);
    }

    #[test]
    fn get_session_devuelve_none_si_no_existe() {
        let conn = Connection::open_in_memory().expect("memoria");
        apply_schema(&conn).expect("esquema");
        assert!(get_session(&conn, "no-existe").expect("query").is_none());
    }
}
