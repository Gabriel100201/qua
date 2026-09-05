//! La unión discriminada `Event`. Espejo de `packages/protocol/src/event.ts`.
//!
//! Los 18 tipos de la tabla de §03, como enum con `#[serde(tag = "k")]`.

use serde::{Deserialize, Serialize};

use crate::target::TargetRef;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Modifier {
    Shift,
    Ctrl,
    Alt,
    Meta,
}

/// Carga o cambio de ruta SPA.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NavKind {
    Load,
    Spa,
    Back,
    Forward,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConsoleLevel {
    Error,
    Warn,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MarkSource {
    Hotkey,
    Popup,
}

/// Campo de formulario. NUNCA lleva `value` (§12).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct FieldRef {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(rename = "type", default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

/// Evento de sesión (§03). Discriminado por `k`.
///
/// `t` es entero en ms desde `t0_wall` (§02). `tab` es el id de pestaña de Chrome.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "k", rename_all = "snake_case")]
pub enum Event {
    Nav {
        t: i64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tab: Option<i64>,
        url: String,
        title: String,
        kind: NavKind,
    },
    TabSwitch {
        t: i64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tab: Option<i64>,
        from: Option<i64>,
        to: i64,
        url: String,
    },
    TabClose {
        t: i64,
        tab: i64,
    },
    Click {
        t: i64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tab: Option<i64>,
        target: TargetRef,
        /// `MouseEvent.button`: 0 principal, 1 medio, 2 secundario.
        button: u8,
        mods: Vec<Modifier>,
    },
    Hover {
        t: i64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tab: Option<i64>,
        target: TargetRef,
        dwell_ms: i64,
    },
    FocusChange {
        t: i64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tab: Option<i64>,
        target: TargetRef,
    },
    Input {
        t: i64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tab: Option<i64>,
        target: TargetRef,
        field: FieldRef,
    },
    Submit {
        t: i64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tab: Option<i64>,
        target: TargetRef,
    },
    ScrollSettle {
        t: i64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tab: Option<i64>,
        y: f64,
        /// Porcentaje del documento scrolleado, 0..1.
        pct: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        top_target: Option<TargetRef>,
    },
    Viewport {
        t: i64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tab: Option<i64>,
        w: i64,
        h: i64,
        dpr: f64,
    },
    Console {
        t: i64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tab: Option<i64>,
        level: ConsoleLevel,
        text: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        stack: Option<String>,
    },
    NetFail {
        t: i64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tab: Option<i64>,
        method: String,
        url: String,
        /// 0 cuando la request murió sin respuesta.
        status: i64,
        duration_ms: i64,
    },
    NetSlow {
        t: i64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tab: Option<i64>,
        method: String,
        url: String,
        status: i64,
        duration_ms: i64,
    },
    LongTask {
        t: i64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tab: Option<i64>,
        duration_ms: i64,
    },
    LayoutShift {
        t: i64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tab: Option<i64>,
        value: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        sources: Option<Vec<TargetRef>>,
    },
    MutationBurst {
        t: i64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tab: Option<i64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        target: Option<TargetRef>,
        count: i64,
    },
    Mark {
        t: i64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tab: Option<i64>,
        source: MarkSource,
    },
    AudioGap {
        t: i64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tab: Option<i64>,
        duration_ms: i64,
    },
}

impl Event {
    /// El discriminante `k` tal como sale serializado.
    pub fn kind(&self) -> &'static str {
        match self {
            Event::Nav { .. } => "nav",
            Event::TabSwitch { .. } => "tab_switch",
            Event::TabClose { .. } => "tab_close",
            Event::Click { .. } => "click",
            Event::Hover { .. } => "hover",
            Event::FocusChange { .. } => "focus_change",
            Event::Input { .. } => "input",
            Event::Submit { .. } => "submit",
            Event::ScrollSettle { .. } => "scroll_settle",
            Event::Viewport { .. } => "viewport",
            Event::Console { .. } => "console",
            Event::NetFail { .. } => "net_fail",
            Event::NetSlow { .. } => "net_slow",
            Event::LongTask { .. } => "long_task",
            Event::LayoutShift { .. } => "layout_shift",
            Event::MutationBurst { .. } => "mutation_burst",
            Event::Mark { .. } => "mark",
            Event::AudioGap { .. } => "audio_gap",
        }
    }

    /// `t` en ms desde `t0_wall`.
    pub fn t(&self) -> i64 {
        match self {
            Event::Nav { t, .. }
            | Event::TabSwitch { t, .. }
            | Event::TabClose { t, .. }
            | Event::Click { t, .. }
            | Event::Hover { t, .. }
            | Event::FocusChange { t, .. }
            | Event::Input { t, .. }
            | Event::Submit { t, .. }
            | Event::ScrollSettle { t, .. }
            | Event::Viewport { t, .. }
            | Event::Console { t, .. }
            | Event::NetFail { t, .. }
            | Event::NetSlow { t, .. }
            | Event::LongTask { t, .. }
            | Event::LayoutShift { t, .. }
            | Event::MutationBurst { t, .. }
            | Event::Mark { t, .. }
            | Event::AudioGap { t, .. } => *t,
        }
    }

    /// Pestaña a la que pertenece el evento, si la tiene.
    pub fn tab(&self) -> Option<i64> {
        match self {
            Event::TabClose { tab, .. } => Some(*tab),
            Event::Nav { tab, .. }
            | Event::TabSwitch { tab, .. }
            | Event::Click { tab, .. }
            | Event::Hover { tab, .. }
            | Event::FocusChange { tab, .. }
            | Event::Input { tab, .. }
            | Event::Submit { tab, .. }
            | Event::ScrollSettle { tab, .. }
            | Event::Viewport { tab, .. }
            | Event::Console { tab, .. }
            | Event::NetFail { tab, .. }
            | Event::NetSlow { tab, .. }
            | Event::LongTask { tab, .. }
            | Event::LayoutShift { tab, .. }
            | Event::MutationBurst { tab, .. }
            | Event::Mark { tab, .. }
            | Event::AudioGap { tab, .. } => *tab,
        }
    }

    /// El `TargetRef` principal del evento, si lo tiene. Lo usa el correlador (§07).
    pub fn target(&self) -> Option<&TargetRef> {
        match self {
            Event::Click { target, .. }
            | Event::Hover { target, .. }
            | Event::FocusChange { target, .. }
            | Event::Input { target, .. }
            | Event::Submit { target, .. } => Some(target),
            Event::ScrollSettle { top_target, .. } => top_target.as_ref(),
            Event::MutationBurst { target, .. } => target.as_ref(),
            _ => None,
        }
    }
}
