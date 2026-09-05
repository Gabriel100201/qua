//! Persistencia: SQLite (WAL) para el índice, archivos para el contenido (§01).
//!
//! **F0 solo entrega el esquema y la función que lo aplica.** El store completo
//! (ingesta, append de ndjson, recover) lo implementa la tarea B1.

use std::path::Path;

use rusqlite::{params, Connection};

use qua_protocol::{Session, SessionStatus};

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
}
