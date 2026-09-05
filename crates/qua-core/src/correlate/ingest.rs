//! Lectura tolerante de `raw/events.ndjson`.
//!
//! El correlador corre sobre sesiones grabadas por versiones distintas de la extensión y
//! sobre archivos que quedaron a medio escribir tras un `kill -9` (§6.2, `qua recover`).
//! Una línea que no se entiende se saltea y se reporta; nunca aborta la correlación:
//! perder un evento es barato, perder la sesión entera no.

use qua_protocol::{Event, EVENT_KINDS};

/// Una línea que no se pudo usar, con el motivo, para que `qua reprocess` lo informe.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SkippedLine {
    /// Número de línea, base 1.
    pub line: usize,
    pub reason: SkipReason,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SkipReason {
    /// La línea no es JSON.
    NotJson,
    /// El `k` no es ninguno de los 18 del contrato (§03).
    UnknownKind(String),
    /// El `k` es conocido pero al evento le faltan campos o tienen el tipo equivocado.
    Malformed(String),
}

/// Parsea un `events.ndjson` devolviendo los eventos válidos y las líneas descartadas.
///
/// Los eventos salen ordenados por `t`: el resto del correlador asume orden temporal y el
/// outbox de la extensión puede reenviar lotes fuera de orden (§04).
pub fn events_from_ndjson(s: &str) -> (Vec<Event>, Vec<SkippedLine>) {
    let mut events = Vec::new();
    let mut skipped = Vec::new();

    for (i, raw) in s.lines().enumerate() {
        let line = i + 1;
        let raw = raw.trim();
        if raw.is_empty() {
            continue;
        }
        let value: serde_json::Value = match serde_json::from_str(raw) {
            Ok(v) => v,
            Err(_) => {
                skipped.push(SkippedLine {
                    line,
                    reason: SkipReason::NotJson,
                });
                continue;
            }
        };
        let kind = value.get("k").and_then(|k| k.as_str()).unwrap_or("");
        if !EVENT_KINDS.contains(&kind) {
            skipped.push(SkippedLine {
                line,
                reason: SkipReason::UnknownKind(kind.to_string()),
            });
            continue;
        }
        match serde_json::from_value::<Event>(value) {
            Ok(e) => events.push(e),
            Err(e) => skipped.push(SkippedLine {
                line,
                reason: SkipReason::Malformed(e.to_string()),
            }),
        }
    }

    events.sort_by_key(|e| e.t());
    (events, skipped)
}

#[cfg(test)]
mod tests {
    use super::*;

    const CLICK: &str = r#"{"t":100,"tab":1,"k":"click","target":{"sel":"button#a","strategy":"testid","tag":"button"},"button":0,"mods":[]}"#;

    #[test]
    fn parsea_lo_valido() {
        let (evs, skipped) = events_from_ndjson(CLICK);
        assert_eq!(evs.len(), 1);
        assert!(skipped.is_empty());
    }

    /// El harness de F1 emite `scroll`, que no existe en el contrato: se ignora, no rompe.
    #[test]
    fn un_k_desconocido_se_saltea_sin_romper() {
        let ndjson = format!("{{\"t\":50,\"tab\":1,\"k\":\"scroll\"}}\n{CLICK}\n");
        let (evs, skipped) = events_from_ndjson(&ndjson);
        assert_eq!(evs.len(), 1);
        assert_eq!(
            skipped,
            vec![SkippedLine {
                line: 1,
                reason: SkipReason::UnknownKind("scroll".into())
            }]
        );
    }

    #[test]
    fn una_linea_truncada_se_saltea() {
        let ndjson = format!("{CLICK}\n{{\"t\":200,\"k\":\"cli");
        let (evs, skipped) = events_from_ndjson(&ndjson);
        assert_eq!(evs.len(), 1);
        assert_eq!(skipped[0].reason, SkipReason::NotJson);
    }

    #[test]
    fn un_evento_conocido_pero_incompleto_se_saltea() {
        let ndjson = format!("{CLICK}\n{{\"t\":200,\"k\":\"click\"}}");
        let (evs, skipped) = events_from_ndjson(&ndjson);
        assert_eq!(evs.len(), 1);
        assert!(matches!(skipped[0].reason, SkipReason::Malformed(_)));
    }

    #[test]
    fn ordena_por_t() {
        let a = CLICK.replace("\"t\":100", "\"t\":900");
        let ndjson = format!("{a}\n{CLICK}\n");
        let (evs, _) = events_from_ndjson(&ndjson);
        assert_eq!(evs.iter().map(|e| e.t()).collect::<Vec<_>>(), vec![100, 900]);
    }

    #[test]
    fn las_lineas_vacias_no_cuentan() {
        let (evs, skipped) = events_from_ndjson(&format!("\n{CLICK}\n\n"));
        assert_eq!(evs.len(), 1);
        assert!(skipped.is_empty());
    }
}
