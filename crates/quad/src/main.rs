//! `quad` — el daemon (§06).
//!
//! STUB de F0: solo prueba que el workspace linkea contra `qua-protocol` y `qua-core`.
//! El servidor axum, el pairing y la ingesta los implementa la tarea B1.

fn main() {
    println!(
        "quad {} — stub de F0. El servidor lo implementa B1.",
        env!("CARGO_PKG_VERSION")
    );
    println!(
        "  protocolo v{} · puerto {} · esquema {}",
        qua_protocol::PROTOCOL_VERSION,
        qua_protocol::DEFAULT_DAEMON_PORT,
        qua_protocol::SCHEMA_SESSION
    );
    println!("  esquema SQLite: {} bytes", qua_core::SCHEMA_SQL.len());
}
