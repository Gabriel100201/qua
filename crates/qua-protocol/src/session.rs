//! `Session`: `session.json` (§8.2). Espejo de `packages/protocol/src/session.ts`.

use serde::{Deserialize, Serialize};

use crate::event::Event;
use crate::issue::Issue;
use crate::literal::SessionSchemaTag;
use crate::utterance::Utterance;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SessionStatus {
    Recording,
    Processing,
    Ready,
    Failed,
}

/// Proyecto de `config.toml` al que se atribuyó la sesión (§13).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProjectRef {
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo: Option<String>,
}

/// Estado del repo al arrancar la sesión.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GitInfo {
    pub branch: String,
    pub sha: String,
    pub dirty: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ViewportInfo {
    pub w: i64,
    pub h: i64,
    pub dpr: f64,
}

/// Entorno del navegador. Se manda una vez, en `session.start`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EnvInfo {
    pub ua: String,
    pub chrome: String,
    pub platform: String,
    pub viewport: ViewportInfo,
    /// Versión de la extensión.
    pub ext: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AudioInfo {
    /// Relativa al directorio de la sesión.
    pub path: String,
    pub sample_rate: u32,
    /// Suma de las duraciones de los eventos `audio_gap`.
    pub gaps_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SessionStats {
    /// Eventos que emitió el content script.
    pub events_raw: i64,
    /// Eventos que sobrevivieron el filtrado y quedaron en `session.json`.
    pub events_kept: i64,
    pub utterances: i64,
    pub issues: i64,
}

/// Pestaña vista durante la sesión, con su ventana de actividad.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TabInfo {
    pub tab: i64,
    pub url: String,
    pub title: String,
    pub first_ms: i64,
    pub last_ms: i64,
}

/// La sesión completa.
///
/// `ended_at` y `duration_ms` faltan mientras `status == Recording`; ver
/// `docs/DECISIONS.md` (D-02).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Session {
    pub schema: SessionSchemaTag,
    /// ISO compacto + 4 hex: `2026-09-04T14-32-11Z-a3f9`.
    pub id: String,
    pub status: SessionStatus,
    /// `performance.timeOrigin + performance.now()` del `session.start`, en ms epoch.
    pub t0_wall: i64,
    pub started_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<i64>,
    pub project: ProjectRef,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub git: Option<GitInfo>,
    pub env: EnvInfo,
    pub audio: AudioInfo,
    pub stats: SessionStats,
    pub tabs: Vec<TabInfo>,
    pub events: Vec<Event>,
    pub utterances: Vec<Utterance>,
    pub issues: Vec<Issue>,
}
