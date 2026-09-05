//! `qua-core` — ingest · asr · correlate · render · store (§02).
//!
//! Estado de los módulos:
//! - `ingest` (B1): raw log crash-safe + `recover`, y las interfaces que consumen los demás.
//! - `store`  (F0/B1): esquema SQLite + persistencia de sesiones.
//! - `asr`    (B2): jitter buffer, VAD silero y worker de whisper (§06.1).
//! - `correlate` (B3) y `render` (B4): los agregan sus tareas.

#![deny(rust_2018_idioms)]

pub mod asr;
pub mod ingest;
pub mod store;

pub use ingest::{
    build_session, read_meta, recover_session, RawAudioLog, RawEventLog, RecoverError, SessionMeta,
};
pub use store::{apply_schema, StoreError, SCHEMA_SQL};
