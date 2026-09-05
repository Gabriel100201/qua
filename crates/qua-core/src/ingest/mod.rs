//! Ingesta: escritura cruda crash-safe (§04 Resiliencia) y reconstrucción desde `raw/`.
//!
//! Este módulo lo implementa la tarea B1. El servidor axum (`quad`) es el único
//! escritor: abre un [`raw_log::RawEventLog`] y un [`raw_log::RawAudioLog`] por sesión,
//! los llena mientras la sesión graba, y usa [`recover::recover_session`] tanto en el
//! flujo normal de `session.stop` como en `qua recover <id>` tras un `kill -9`.
//!
//! `asr`, `correlate` y `render` (B2, B3, B4) no viven acá: [`pipeline`] deja las
//! interfaces que esas tareas implementan sin tocar el servidor ni el store.

pub mod pipeline;
pub mod raw_log;
pub mod recover;
pub mod session_builder;

pub use raw_log::{RawAudioLog, RawEventLog};
pub use recover::{read_meta, recover_session, RecoverError, SessionMeta};
pub use session_builder::build_session;
