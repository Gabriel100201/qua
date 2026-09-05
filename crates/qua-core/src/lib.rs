//! `qua-core` — ingest · asr · correlate · render · store (§02).
//!
//! - `ingest`    (B1): raw log crash-safe + `recover`, e interfaces para los demás.
//! - `store`     (F0/B1): esquema SQLite + persistencia de sesiones.
//! - `asr`       (B2): jitter buffer, VAD silero y worker de whisper (§06.1).
//! - `correlate` (B3): los 9 pasos de §07, con umbrales en `[correlator]`.
//! - `render`    (B4): report.md, issues.json y recortes PNG (§08).

#![deny(rust_2018_idioms)]

pub mod asr;
pub mod correlate;
pub mod ingest;
pub mod store;

pub use ingest::{
    build_session, read_meta, recover_session, RawAudioLog, RawEventLog, RecoverError, SessionMeta,
};
pub use store::{apply_schema, StoreError, SCHEMA_SQL};
