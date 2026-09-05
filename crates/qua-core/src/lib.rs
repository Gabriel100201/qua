//! `qua-core` — ingest · asr · correlate · render · store (§02).
//!
//! **F0 solo entrega `store::schema.sql` y `store::apply_schema`.** `asr` lo implementa
//! B2 (pipeline de audio y ASR, §06.1). El resto de los módulos los implementan B1
//! (servidor y store), B3 (correlador) y B4 (renderer).

#![deny(rust_2018_idioms)]

pub mod asr;
pub mod store;

pub use store::{apply_schema, StoreError, SCHEMA_SQL};
