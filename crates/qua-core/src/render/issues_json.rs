//! `issues.json` (§8.2): "solo issues — es lo que lee el agente".
//!
//! Se serializan en el mismo orden que trae `Session.issues` (el orden del correlador,
//! por `id`), no el orden de despliegue de `report.md` — un consumidor programático
//! quiere `i01, i02, i03, ...` predecible, no reordenado por severidad.

use qua_protocol::Session;

pub fn render_issues_json(session: &Session) -> serde_json::Result<String> {
    serde_json::to_string_pretty(&session.issues)
}
