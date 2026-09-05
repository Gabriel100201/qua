//! `quad` — el daemon (§06): servidor axum, pairing, ingesta y store (B1).
//!
//! Expuesto como lib además de bin para que `src/bin/qua.rs` (el CLI de §6.2) y los
//! tests de integración reutilicen `config`/`server`/`session` sin invocar el binario.

#![deny(rust_2018_idioms)]

pub mod cli;
pub mod config;
pub mod pairing;
pub mod server;
pub mod session;
pub mod ws;
