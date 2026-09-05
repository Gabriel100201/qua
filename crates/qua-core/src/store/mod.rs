//! Persistencia: SQLite (WAL) para el índice, archivos para el contenido (§01).
//!
//! **F0 solo entrega el esquema y la función que lo aplica.** El store completo
//! (ingesta, append de ndjson, recover) lo implementa la tarea B1.

use rusqlite::Connection;

/// El esquema de §03, embebido en el binario para que no dependa del cwd.
pub const SCHEMA_SQL: &str = include_str!("schema.sql");

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("SQLite: {0}")]
    Sqlite(#[from] rusqlite::Error),
}

/// Aplica el esquema de §03 sobre una conexión abierta.
///
/// Es idempotente (`IF NOT EXISTS` en todo), así que se puede llamar en cada arranque
/// del daemon sin chequear nada antes.
pub fn apply_schema(conn: &Connection) -> Result<(), StoreError> {
    conn.execute_batch(SCHEMA_SQL)?;
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
