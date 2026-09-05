//! Mensajes del protocolo de §04. Espejo de `packages/protocol/src/messages.ts`.

use serde::{Deserialize, Serialize};

use crate::event::Event;
use crate::literal::ProtocolVersionTag;
use crate::session::EnvInfo;
use crate::utterance::Utterance;

/// Cabecera de `session.start`. Fija `t0_wall`, el origen del reloj único (§02).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SessionStartPayload {
    pub t0_wall: i64,
    pub base_url: String,
    pub env: EnvInfo,
}

/// Cliente → servidor.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ClientMessage {
    /// Primer mensaje tras conectar. El daemon responde `hello.ok`.
    #[serde(rename = "hello")]
    Hello {
        v: ProtocolVersionTag,
        ext_version: String,
        chrome: String,
        platform: String,
    },
    #[serde(rename = "session.start")]
    SessionStart {
        v: ProtocolVersionTag,
        session: SessionStartPayload,
    },
    /// Lote de eventos. `seq` es monótono por sesión y es lo que el outbox usa
    /// para el replay (§04).
    #[serde(rename = "events")]
    Events {
        v: ProtocolVersionTag,
        seq: i64,
        items: Vec<Event>,
    },
    /// Marcador de precisión. Fuerza flush inmediato.
    #[serde(rename = "mark")]
    Mark { v: ProtocolVersionTag, t: i64 },
    /// Respuesta a `capture.request`: el frame del ring más cercano a `t_target`.
    #[serde(rename = "frame")]
    Frame {
        v: ProtocolVersionTag,
        t: i64,
        tab: i64,
        /// JPEG q60 en base64, con los nodos redactados ya tapados (§12).
        jpeg_b64: String,
    },
    #[serde(rename = "session.stop")]
    SessionStop { v: ProtocolVersionTag, t: i64 },
    /// Keepalive. No tiene respuesta propia: ver `docs/DECISIONS.md` (D-03).
    #[serde(rename = "ping")]
    Ping { v: ProtocolVersionTag },
}

/// Servidor → cliente.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ServerMessage {
    /// Handshake aceptado. `session_dir` es absoluto.
    #[serde(rename = "hello.ok")]
    HelloOk {
        v: ProtocolVersionTag,
        daemon_version: String,
        session_dir: String,
    },
    /// Confirma que todo lote con seq ≤ este está en `raw/events.ndjson`.
    #[serde(rename = "ack")]
    Ack { v: ProtocolVersionTag, seq: i64 },
    /// Transcripción en vivo para el popup. No es el resultado final.
    #[serde(rename = "transcript.partial")]
    TranscriptPartial {
        v: ProtocolVersionTag,
        utterance: Utterance,
    },
    /// Pedido retroactivo de screenshot al ring de la extensión (§5.3, §07 paso 9).
    #[serde(rename = "capture.request")]
    CaptureRequest {
        v: ProtocolVersionTag,
        tab: i64,
        t_target: i64,
    },
    #[serde(rename = "session.done")]
    SessionDone {
        v: ProtocolVersionTag,
        report_path: String,
        issues: i64,
    },
    #[serde(rename = "error")]
    Error {
        v: ProtocolVersionTag,
        code: String,
        message: String,
    },
}

/// Códigos de error conocidos. `code` acepta otros: ver `docs/DECISIONS.md` (D-04).
pub mod error_codes {
    /// Token ausente, vencido o desconocido.
    pub const UNAUTHORIZED: &str = "unauthorized";
    /// El header `Origin` no está en la allowlist.
    pub const ORIGIN_REJECTED: &str = "origin_rejected";
    /// El mensaje no valida contra el esquema.
    pub const BAD_MESSAGE: &str = "bad_message";
    /// Llegó un `events`/`mark`/`frame` sin `session.start` previo.
    pub const NO_SESSION: &str = "no_session";
    /// `v` distinto de `PROTOCOL_VERSION`.
    pub const VERSION_MISMATCH: &str = "version_mismatch";
    /// El daemon no pudo escribir a disco.
    pub const STORAGE: &str = "storage";
    /// Falla del pipeline de ASR. La sesión sigue grabando.
    pub const ASR: &str = "asr";
    /// Cualquier otra.
    pub const INTERNAL: &str = "internal";
}

/// `POST /pair` con `Origin: chrome-extension://<id>`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PairRequest {
    /// 6 dígitos.
    pub code: String,
}

/// Respuesta de `POST /pair`. El token son 32 bytes en hex.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PairResponse {
    pub token: String,
    pub daemon_version: String,
}

/// Respuesta de `GET /health` (§09).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HealthResponse {
    pub ok: bool,
    pub daemon_version: String,
    pub uptime_ms: i64,
    /// Id de la sesión en curso, o `null` si está idle.
    pub session: Option<String>,
    /// El modelo de whisper está descargado y cargado.
    pub model_ready: bool,
}
