//! `qua-mcp` — servidor MCP sobre stdio, solo lectura (§10).
//!
//! Transporte: JSON-RPC 2.0, un mensaje por línea de stdin/stdout (la variante "stdio"
//! del protocolo MCP). Implementa el handshake mínimo (`initialize` +
//! `notifications/initialized`) y las dos operaciones que necesita cualquier cliente
//! MCP para usar las 5 herramientas de §10: `tools/list` y `tools/call`.

mod db;
mod tools;

use std::io::{self, BufRead, Write};

use clap::Parser;
use serde_json::{json, Value};

use tools::ToolError;

const PROTOCOL_VERSION: &str = "2024-11-05";
const SERVER_NAME: &str = "qua-mcp";

#[derive(Parser, Debug)]
#[command(
    name = "qua-mcp",
    about = "Servidor MCP stdio, solo lectura sobre el SQLite de QUA (§10)"
)]
struct Args {
    /// Ruta al `qua.db`. Default: `$QUA_HOME/qua.db` o `~/.qua/qua.db`.
    #[arg(long)]
    db: Option<String>,
}

fn main() {
    let args = Args::parse();
    let db_path = tools::resolve_db_path(args.db.as_deref());

    let stdin = io::stdin();
    let mut stdout = io::stdout();

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let request: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(e) => {
                write_message(
                    &mut stdout,
                    &error_response(Value::Null, -32700, &format!("parse error: {e}")),
                );
                continue;
            }
        };

        if let Some(response) = handle_request(&request, &db_path) {
            write_message(&mut stdout, &response);
        }
    }
}

/// Devuelve `None` para notificaciones (sin `id`): el protocolo no espera respuesta.
fn handle_request(request: &Value, db_path: &std::path::Path) -> Option<Value> {
    let method = request.get("method").and_then(Value::as_str).unwrap_or("");
    let id = request.get("id").cloned();
    let params = request.get("params").cloned().unwrap_or(json!({}));

    match method {
        "initialize" => Some(ok_response(
            id?,
            json!({
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": { "tools": {} },
                "serverInfo": { "name": SERVER_NAME, "version": env!("CARGO_PKG_VERSION") },
            }),
        )),
        "notifications/initialized" => None,
        "ping" => Some(ok_response(id?, json!({}))),
        "tools/list" => {
            let tools: Vec<Value> = tools::specs()
                .into_iter()
                .map(|t| {
                    json!({
                        "name": t.name,
                        "description": t.description,
                        "inputSchema": t.input_schema,
                    })
                })
                .collect();
            Some(ok_response(id?, json!({ "tools": tools })))
        }
        "tools/call" => {
            let id = id?;
            let name = match params.get("name").and_then(Value::as_str) {
                Some(n) => n,
                None => return Some(error_response(id, -32602, "falta params.name")),
            };
            let arguments = params.get("arguments").cloned().unwrap_or(json!({}));
            Some(ok_response(
                id,
                call_tool_response(name, &arguments, db_path),
            ))
        }
        "" => id.map(|id| error_response(id, -32600, "falta method")),
        other => id.map(|id| error_response(id, -32601, &format!("método desconocido: {other}"))),
    }
}

/// Los errores de una herramienta (SQL, archivo faltante, parámetro inválido) son
/// resultado normal de MCP con `isError: true` — no un error de protocolo JSON-RPC, que
/// se reserva para pedidos rotos (método inexistente, JSON inválido).
fn call_tool_response(name: &str, arguments: &Value, db_path: &std::path::Path) -> Value {
    match tools::call(name, arguments, db_path) {
        Ok(value) => json!({
            "content": [{ "type": "text", "text": value.to_string() }],
            "isError": false,
        }),
        Err(err) => json!({
            "content": [{ "type": "text", "text": tool_error_text(&err) }],
            "isError": true,
        }),
    }
}

fn tool_error_text(err: &ToolError) -> String {
    err.to_string()
}

fn ok_response(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn error_response(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

fn write_message(stdout: &mut io::Stdout, message: &Value) {
    let mut line = message.to_string();
    line.push('\n');
    let _ = stdout.write_all(line.as_bytes());
    let _ = stdout.flush();
}
