//! `TargetRef` y compañía. Espejo de `packages/protocol/src/target.ts`.

use serde::{Deserialize, Serialize};

/// Rectángulo en coordenadas de viewport, en píxeles CSS.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// Cascada de §5.2: primer match único gana.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SelectorStrategy {
    #[serde(rename = "testid")]
    TestId,
    #[serde(rename = "id")]
    Id,
    #[serde(rename = "role-name")]
    RoleName,
    #[serde(rename = "css-path")]
    CssPath,
}

/// Subconjunto de `getComputedStyle`. Solo se calcula en `click` y en `hover` con
/// dwell > 800 ms, porque fuerza reflow (§03).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputedStyle {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_size: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_weight: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub padding: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub margin: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background_color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub border_radius: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display: Option<String>,
}

/// Referencia a archivo fuente resuelta por `@qua/source-resolver` (§11).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SourceRef {
    /// Ruta relativa al repo del proyecto, normalizada por el daemon.
    pub file: String,
    pub line: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub col: Option<i64>,
    /// 1 = plugin de build · 2 = `_debugStack` · 3 = cadena de componentes · 4 = solo selector.
    pub tier: u8,
}

/// Referencia a un elemento del DOM (§03).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TargetRef {
    /// Selector CSS validado como único al momento de emitir.
    pub sel: String,
    pub strategy: SelectorStrategy,
    pub tag: String,
    /// `"[redactado]"` bajo subárbol privado (§12).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rect: Option<Rect>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visible: Option<bool>,
    /// Cadena de clases COMPLETA, sin truncar: con Tailwind v4 la clase es el estilo (§03).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub classes: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub computed: Option<ComputedStyle>,
    /// Cadena de `_debugOwner`, de afuera hacia adentro. Tier 3 de §11.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub component: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub src: Option<SourceRef>,
}
