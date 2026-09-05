//! `qua-protocol` — espejo Rust de `packages/protocol`.
//!
//! La fuente de verdad es TypeScript + Zod (§01). Este crate está escrito a mano y lo
//! único que garantiza que no divergen son las fixtures doradas de `fixtures/`, que
//! `tests/fixtures.rs` parsea y vuelve a serializar exigiendo igualdad.
//!
//! Regla: nadie modifica este crate ni `fixtures/` fuera de la tarea F0. Si una tarea
//! necesita un cambio de contrato, lo reporta.

#![deny(rust_2018_idioms)]

pub mod audio_frame;
pub mod constants;
pub mod event;
pub mod issue;
pub mod literal;
pub mod messages;
pub mod session;
pub mod target;
pub mod utterance;

pub use audio_frame::{is_audio_frame, AudioFrame, AudioFrameError};
pub use constants::{
    ANCHOR_KINDS, AUDIO_CHANNELS, AUDIO_SAMPLE_RATE, DAEMON_HOST, DEFAULT_DAEMON_PORT, EVENT_KINDS,
    HEALTH_PATH, PAIR_PATH, PROTOCOL_VERSION, REDACTED, SCHEMA_SESSION, UNANCHORED_CONFIDENCE,
    WS_PATH,
};
pub use event::{ConsoleLevel, Event, FieldRef, MarkSource, Modifier, NavKind};
pub use issue::{Anchor, AnchorKind, Evidence, Issue, IssueCategory, Severity, Timing};
pub use literal::{ProtocolVersionTag, SessionSchemaTag};
pub use messages::{
    ClientMessage, HealthResponse, PairRequest, PairResponse, ServerMessage, SessionStartPayload,
};
pub use session::{
    AudioInfo, EnvInfo, GitInfo, ProjectRef, Session, SessionStats, SessionStatus, TabInfo,
    ViewportInfo,
};
pub use target::{ComputedStyle, Rect, SelectorStrategy, SourceRef, TargetRef};
pub use utterance::{Utterance, Word};
