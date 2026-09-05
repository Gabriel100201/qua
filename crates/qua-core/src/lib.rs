//! `qua-core` — ingest · asr · correlate · render · store (§02).
//!
//! B1 entrega `ingest` (raw log crash-safe + recover) y `store` (esquema SQLite +
//! persistencia de sesiones). B4 entrega `render` (`report.md`, `issues.json`,
//! `transcript.txt`, recortes PNG — §08). `asr` y `correlate` los implementan B2 y B3
//! — `ingest::pipeline` deja sus interfaces.

#![deny(rust_2018_idioms)]

pub mod ingest;
pub mod render;
pub mod store;

pub use ingest::{
    build_session, read_meta, recover_session, RawAudioLog, RawEventLog, RecoverError, SessionMeta,
};
pub use render::{render_session, DefaultRenderer, RenderError, RenderOutput};
pub use store::{apply_schema, StoreError, SCHEMA_SQL};
