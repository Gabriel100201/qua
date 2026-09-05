//! `qua-core` — ingest · asr · correlate · render · store (§02).
//!
//! **F0 solo entrega `store::schema.sql` y `store::apply_schema`.** El resto de los
//! módulos los implementan B1 (servidor y store), B2 (audio y ASR), B3 (correlador)
//! y B4 (renderer).

#![deny(rust_2018_idioms)]

pub mod store;

pub use store::{apply_schema, StoreError, SCHEMA_SQL};
