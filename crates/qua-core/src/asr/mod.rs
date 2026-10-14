//! Pipeline de audio y ASR (§06.1): jitter buffer → ring buffer → VAD silero →
//! cola acotada → worker de whisper → `Utterance`.
//!
//! ```text
//! frames WS → jitter buffer (reordena por seq, ventana 200 ms)
//!           → ring buffer f32 · 16 kHz · 60 s
//!           → VAD silero, ventanas de 30 ms
//!                threshold 0.5 · min_speech 250 ms
//!                min_silence 600 ms · padding 300 ms a cada lado
//!           → segmento cerrado (o corte forzado a 25 s)
//!           → cola acotada (cap 8) → 1 worker whisper
//!           → Utterance → sesión + transcript.partial
//! ```

pub mod config;
pub mod jitter;
#[cfg(feature = "native")]
pub mod model;
pub mod pipeline;
pub mod prompt;
pub mod queue;
pub mod ring;
pub mod vad;
#[cfg(feature = "native")]
pub mod whisper;

pub use config::AsrConfig;
#[cfg(feature = "native")]
pub use model::{ensure_model, DownloadProgress, ModelError, ModelSpec, BASE, LARGE_V3_TURBO_Q5_0};
pub use pipeline::{AudioFrontend, PromptState};
#[cfg(feature = "native")]
pub use pipeline::run_whisper_worker;
pub use prompt::{build_initial_prompt, ensure_vocab_seeded, DEFAULT_VOCAB};
#[cfg(feature = "native")]
pub use whisper::{WhisperWorker, WhisperWorkerError};

/// `~/.qua`, la raíz de todo lo que este módulo persiste (modelos, vocab, config).
/// Respeta `$HOME` en vez de asumir una ruta fija, para que los tests puedan
/// redirigirla con variables de entorno si hiciera falta.
pub fn qua_home() -> std::path::PathBuf {
    let home = std::env::var_os("HOME").expect("$HOME no está seteado");
    std::path::PathBuf::from(home).join(".qua")
}

pub fn models_dir() -> std::path::PathBuf {
    qua_home().join("models")
}

pub fn vocab_path() -> std::path::PathBuf {
    qua_home().join("vocab.txt")
}
