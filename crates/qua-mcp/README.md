# qua-mcp

Servidor MCP de QUA (§10 de `docs/SPEC.md`). Binario `qua-mcp`, transporte **stdio**,
JSON-RPC 2.0. Solo lectura sobre el SQLite del daemon (`~/.qua/qua.db`, modo WAL) —
la única escritura que hace es `qua_issue_mark_exported`, y la hace por una conexión
separada abierta en modo lectura-escritura; las otras 4 herramientas abren la conexión
con `SQLITE_OPEN_READ_ONLY`, así que no hay forma de que escriban aunque el código
cambie sin darse cuenta.

## Herramientas

| Herramienta | Parámetros | Devuelve |
|---|---|---|
| `qua_sessions_list` | `limit?`, `since?`, `project?` | `id`, fecha, proyecto, duración, cantidad de issues, estado |
| `qua_session_get` | `id`, `include_events?` (default `false`) | `report.md` + `issues.json`; si `include_events` es `true`, agrega `session.json` completo |
| `qua_issues_pending` | `project?`, `min_confidence?`, `category?` | Issues con `exported_to IS NULL`, ordenados por severidad y luego confianza |
| `qua_issues_search` | `query`, `project?` | Búsqueda FTS5 sobre el texto de todos los issues (incluye los ya exportados) |
| `qua_issue_mark_exported` | `session_id`, `issue_id`, `ticket_url` | `{ok: true}` — única escritura, idempotente |

Cada issue devuelto es el objeto `Issue` de §03 tal cual quedó en la columna `json`, más
`session_id` para que el agente sepa de qué sesión salió.

`issues.id` es correlativo *por sesión* (`i01`, `i02`, ...), no global — la clave real de
un issue es el par `(session_id, id)` (`docs/DECISIONS.md`, D-B4-07). Por eso
`qua_issue_mark_exported` pide `session_id` además de `issue_id`: los dos salen directo
de un issue que ya devolvió `qua_issues_pending`/`qua_issues_search`, así que el agente
nunca tiene que armar el par a mano.

## Cómo lo enchufa Gabriel a Claude Code

Con la CLI (recomendado — apunta al binario compilado en este repo):

```bash
claude mcp add qua -- ~/Projects/personal/qua/target/release/qua-mcp
```

O a mano, agregando esto a `~/.claude.json` (alcance de usuario) o a `.mcp.json` del
proyecto:

```json
{
  "mcpServers": {
    "qua": {
      "command": "/Users/gabrielfunes/Projects/personal/qua/target/release/qua-mcp",
      "args": []
    }
  }
}
```

Por default lee `$QUA_HOME/qua.db` (o `~/.qua/qua.db` si `QUA_HOME` no está seteada) —
el mismo archivo que arma `quad`. Para apuntar a otra DB (p. ej. en tests, o una copia):

```json
{
  "mcpServers": {
    "qua": {
      "command": "/Users/gabrielfunes/Projects/personal/qua/target/release/qua-mcp",
      "args": ["--db", "/ruta/a/otra/qua.db"]
    }
  }
}
```

Antes de enchufarlo hace falta compilar el binario una vez:

```bash
~/.cargo/bin/cargo build --release -p qua-mcp
```

## Tests

```bash
~/.cargo/bin/cargo test -p qua-mcp
```

`tests/mcp_protocol.rs` levanta el binario como subproceso real, siembra una DB temporal
desde `tests/fixtures/seed.json` (aplicando el esquema real de `qua-core::store`) con un
directorio de sesión de fixture (`tests/fixtures/session/`: `report.md`, `issues.json`,
`session.json`), y le habla el protocolo MCP de verdad por stdin/stdout: `initialize` →
`notifications/initialized` → `tools/list` → `tools/call` × 5. Verifica en particular que
`qua_issue_mark_exported` hace que ese issue deje de aparecer en `qua_issues_pending`
(pero siga siendo buscable por `qua_issues_search`, ahora con `exported_to` seteado).
