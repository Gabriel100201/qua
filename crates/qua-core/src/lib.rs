//! `qua-core` — ingest · asr · correlate · render · store (§02).
//!
//! B1 entrega `ingest` (raw log crash-safe + recover) y `store` (esquema SQLite +
//! persistencia de sesiones). `asr`, `correlate` y `render` los implementan B2, B3 y
//! B4 respectivamente — `ingest::pipeline` deja sus interfaces.

#![deny(rust_2018_idioms)]

pub mod ingest;
pub mod store;

pub use ingest::{
    build_session, read_meta, recover_session, RawAudioLog, RawEventLog, RecoverError, SessionMeta,
};
pub use store::{apply_schema, StoreError, SCHEMA_SQL};
