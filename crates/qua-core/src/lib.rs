//! `qua-core` — ingest · asr · correlate · render · store (§02).
//!
//! `store` lo entregó F0 y `correlate` (§07) la tarea B3. El resto de los módulos los
//! implementan B1 (servidor y store), B2 (audio y ASR) y B4 (renderer).

#![deny(rust_2018_idioms)]

pub mod correlate;
pub mod store;

pub use correlate::{correlate, CaptureRequest, Correlation, CorrelatorConfig};
pub use store::{apply_schema, StoreError, SCHEMA_SQL};
