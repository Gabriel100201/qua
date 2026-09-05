//! Apertura de la conexión SQLite (§01, §10).
//!
//! `qua-mcp` es solo lectura salvo una única escritura (`qua_issue_mark_exported`, §10):
//! en vez de confiar en que el código de cada herramienta "se porte bien", la exclusión
//! la impone SQLite mismo — las 4 herramientas de consulta abren la conexión con
//! `SQLITE_OPEN_READ_ONLY` y solo `mark_exported` pide una de lectura-escritura. El
//! archivo ya está en modo WAL (lo deja `quad` al arrancar, §03), así que un lector no
//! bloquea al daemon mientras sigue apendeando.

use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags};

/// Directorio de datos de QUA. Mismo contrato que usa `quad::config::qua_home` (B1):
/// `QUA_HOME` lo overridea (los tests lo usan para no tocar `~/.qua/` real); si no,
/// `$HOME/.qua`. Se duplica acá en vez de depender del crate `quad` para no acoplar el
/// build de esta tarea al de otra.
pub fn qua_home() -> PathBuf {
    if let Ok(dir) = std::env::var("QUA_HOME") {
        return PathBuf::from(dir);
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".qua")
}

/// `~/.qua/qua.db` (o `$QUA_HOME/qua.db`), el mismo nombre de archivo que usa el store
/// de `qua-core`.
pub fn default_db_path() -> PathBuf {
    qua_home().join(qua_core::store::DB_FILE_NAME)
}

/// Conexión de solo lectura. La usan `qua_sessions_list`, `qua_session_get`,
/// `qua_issues_pending` y `qua_issues_search`.
pub fn open_read_only(db_path: &Path) -> rusqlite::Result<Connection> {
    Connection::open_with_flags(
        db_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
}

/// Conexión de lectura-escritura. La usa exclusivamente `qua_issue_mark_exported`.
pub fn open_read_write(db_path: &Path) -> rusqlite::Result<Connection> {
    Connection::open_with_flags(
        db_path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
}
