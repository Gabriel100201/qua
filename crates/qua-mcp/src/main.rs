//! `qua-mcp` — servidor MCP sobre stdio, solo lectura (§10).
//!
//! STUB de F0. Las 5 herramientas las implementa la tarea D1.

fn main() {
    println!(
        "qua-mcp {} — stub de F0. Las herramientas las implementa D1.",
        env!("CARGO_PKG_VERSION")
    );
    println!("  protocolo v{}", qua_protocol::PROTOCOL_VERSION);
}
