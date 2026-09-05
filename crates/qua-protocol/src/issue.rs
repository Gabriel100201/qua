//! `Issue` y su anclaje. Espejo de `packages/protocol/src/issue.ts`.

use serde::{Deserialize, Serialize};

use crate::event::Event;
use crate::target::TargetRef;

/// Las 3 clases de §07 paso 6. Regla de oro: ante duda, degradar a `route`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AnchorKind {
    Element,
    Route,
    Session,
}

/// A qué apunta un issue, y con cuánta confianza (§07).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Anchor {
    pub kind: AnchorKind,
    /// Presente solo cuando `kind == Element`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<TargetRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tab: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// `clamp(best.score / 6, 0, 1)`, penalizado ×0.7 si el ratio best/second < 1.3.
    pub confidence: f64,
    /// Traza legible de por qué se eligió: `["click −0.9s", "deixis:este"]`.
    pub reason: Vec<String>,
}

/// Medición derivada de un click seguido de `mutation_burst` o `nav` (§07 paso 7).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Timing {
    pub label: String,
    pub ms: i64,
}

/// Evidencia adjunta en la ventana `E = [t_ref − 6000, t_ref + 4000]`, misma pestaña.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Evidence {
    /// Eventos `console` (error/warn) de la ventana E.
    pub console: Vec<Event>,
    /// Eventos `net_fail` y `net_slow` de la ventana E.
    pub net: Vec<Event>,
    pub timings: Vec<Timing>,
    /// Ruta relativa al directorio de la sesión: `assets/i03.png`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub screenshot: Option<String>,
}

/// Precedencia de §07 paso 8: bug > perf > copy > ui > idea. Default: ui.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum IssueCategory {
    Ui,
    Bug,
    Perf,
    Copy,
    Idea,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Low,
    Med,
    High,
}

/// Lo que produce el correlador y consume el agente (§03, §07).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Issue {
    /// `i` + 2 dígitos: `i03`.
    pub id: String,
    /// Utterances fusionadas que lo originaron (§07 paso 1).
    pub utterance_ids: Vec<String>,
    /// `t_ref` del grupo: el `mark` si lo hubo, si no el `t_start`.
    pub t: i64,
    pub text: String,
    pub anchor: Anchor,
    pub evidence: Evidence,
    pub category: IssueCategory,
    pub severity: Severity,
    /// URL del ticket, o `null` si todavía no se exportó.
    pub exported_to: Option<String>,
}
