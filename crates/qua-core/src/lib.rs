//! `qua-core` — ingest · asr · correlate · render · store (§02).
//!
<<<<<<< HEAD
//! B1 entrega `ingest` (raw log crash-safe + recover) y `store` (esquema SQLite +
//! persistencia de sesiones). `asr`, `correlate` y `render` los implementan B2, B3 y
//! B4 respectivamente — `ingest::pipeline` deja sus interfaces.

#![deny(rust_2018_idioms)]

pub mod ingest;
=======
//! **F0 solo entrega `store::schema.sql` y `store::apply_schema`.** `asr` lo implementa
//! B2 (pipeline de audio y ASR, §06.1). El resto de los módulos los implementan B1
//! (servidor y store), B3 (correlador) y B4 (renderer).

#![deny(rust_2018_idioms)]

pub mod asr;
>>>>>>> b2
pub mod store;

pub use ingest::{
    build_session, read_meta, recover_session, RawAudioLog, RawEventLog, RecoverError, SessionMeta,
};
pub use store::{apply_schema, StoreError, SCHEMA_SQL};
