//! `Utterance`. Espejo de `packages/protocol/src/utterance.ts`.

use serde::{Deserialize, Serialize};

/// Palabra con timestamp y probabilidad, tal como la devuelve whisper.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Word {
    /// Texto de la palabra.
    pub w: String,
    /// Inicio en ms desde `t0_wall`.
    pub t: i64,
    /// Duración en ms.
    pub d: i64,
    /// Probabilidad del token, 0..1.
    pub p: f64,
}

/// Segmento de habla cerrado por el VAD y transcripto por whisper (§03, §6.1).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Utterance {
    /// `u` + 2 dígitos, correlativo dentro de la sesión: `u07`.
    pub id: String,
    pub t_start: i64,
    pub t_end: i64,
    pub text: String,
    pub lang: String,
    pub words: Vec<Word>,
    pub avg_logprob: f64,
    pub no_speech_prob: f64,
    /// Hubo un evento `mark` dentro de `[t_start, t_end]`.
    pub marked: bool,
}
