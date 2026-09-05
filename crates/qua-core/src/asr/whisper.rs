//! Worker de whisper vía `whisper-rs` (§06.1).
//!
//! Un solo `WhisperContext` por worker: whisper.cpp **no es thread-safe para
//! inferencia paralela** sobre el mismo contexto (DECISIÓN de §06.1), así que cada
//! worker de `--asr-workers N` tiene el suyo propio, y dentro de un worker las
//! transcripciones son estrictamente secuenciales.

use std::path::Path;

use qua_protocol::utterance::{Utterance, Word};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

use crate::asr::config::AsrConfig;

#[derive(Debug, thiserror::Error)]
pub enum WhisperWorkerError {
    #[error("no se pudo cargar el modelo whisper desde {path}: {source}")]
    LoadModel {
        path: String,
        #[source]
        source: whisper_rs::WhisperError,
    },
    #[error("whisper-rs: {0}")]
    Whisper(#[from] whisper_rs::WhisperError),
}

/// Envuelve un `WhisperContext` cargado y aplica exactamente los parámetros del
/// bloque DECISIÓN de §06.1 en cada corrida.
pub struct WhisperWorker {
    ctx: WhisperContext,
}

impl WhisperWorker {
    pub fn load(model_path: &Path) -> Result<Self, WhisperWorkerError> {
        let ctx = WhisperContext::new_with_params(model_path, WhisperContextParameters::default())
            .map_err(|source| WhisperWorkerError::LoadModel {
                path: model_path.display().to_string(),
                source,
            })?;
        Ok(Self { ctx })
    }

    /// Transcribe un segmento de audio (f32, 16 kHz, mono) cerrado por el VAD y arma
    /// la [`Utterance`] del protocolo. `t_offset_ms` es dónde arranca este segmento
    /// en el reloj de la sesión — whisper devuelve timestamps relativos al audio que
    /// se le pasó, no a la sesión.
    pub fn transcribe(
        &mut self,
        id: String,
        samples: &[f32],
        t_offset_ms: i64,
        cfg: &AsrConfig,
        initial_prompt: &str,
    ) -> Result<Utterance, WhisperWorkerError> {
        let mut state = self.ctx.create_state()?;

        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 0 });
        // Parámetros exactos del bloque DECISIÓN de §06.1.
        params.set_language(Some(cfg.language.as_str()));
        params.set_temperature(cfg.temperature);
        params.set_token_timestamps(cfg.token_timestamps);
        params.set_suppress_blank(cfg.suppress_blank);
        params.set_no_speech_thold(cfg.no_speech_thold);
        if !initial_prompt.is_empty() {
            params.set_initial_prompt(initial_prompt);
        }

        params.set_translate(false);
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        params.set_n_threads(num_cpus::get() as i32);

        state.full(params, samples)?;

        Ok(build_utterance(id, &state, t_offset_ms))
    }
}

/// Junta todos los segmentos que whisper haya devuelto para este audio en una sola
/// [`Utterance`] — nuestro VAD ya decidió los límites de la utterance antes de
/// llamar a whisper, así que un segmento cerrado de §06.1 es siempre una Utterance.
fn build_utterance(id: String, state: &whisper_rs::WhisperState, t_offset_ms: i64) -> Utterance {
    let mut text_parts = Vec::new();
    let mut words = Vec::new();
    let mut logprobs = Vec::new();
    let mut no_speech_probs = Vec::new();
    let mut t_start: Option<i64> = None;
    let mut t_end: i64 = t_offset_ms;

    for segment in state.as_iter() {
        no_speech_probs.push(segment.no_speech_probability());
        let seg_text = segment
            .to_str_lossy()
            .unwrap_or_default()
            .trim()
            .to_string();
        if !seg_text.is_empty() {
            text_parts.push(seg_text);
        }

        let seg_t0_ms = t_offset_ms + segment.start_timestamp() * 10;
        let seg_t1_ms = t_offset_ms + segment.end_timestamp() * 10;
        t_start.get_or_insert(seg_t0_ms);
        t_end = seg_t1_ms;

        for word in group_tokens_into_words(&segment, t_offset_ms) {
            logprobs.push(word.plog);
            words.push(Word {
                w: word.text,
                t: word.t_start_ms,
                d: (word.t_end_ms - word.t_start_ms).max(0),
                p: word.probability as f64,
            });
        }
    }

    let avg_logprob = if logprobs.is_empty() {
        0.0
    } else {
        (logprobs.iter().sum::<f32>() / logprobs.len() as f32) as f64
    };
    let no_speech_prob = if no_speech_probs.is_empty() {
        0.0
    } else {
        (no_speech_probs.iter().sum::<f32>() / no_speech_probs.len() as f32) as f64
    };

    Utterance {
        id,
        t_start: t_start.unwrap_or(t_offset_ms),
        t_end,
        text: text_parts.join(" ").trim().to_string(),
        lang: "es".to_string(),
        words,
        avg_logprob,
        no_speech_prob,
        marked: false,
    }
}

struct WordAccum {
    text: String,
    t_start_ms: i64,
    t_end_ms: i64,
    probability: f32,
    plog: f32,
}

/// whisper.cpp no tiene un concepto nativo de "palabra": agrupa tokens en palabras
/// cuando el token siguiente arranca con un espacio, que es como el propio CLI de
/// whisper.cpp arma `word_timestamps` (ver `common-whisper.cpp` upstream). Los
/// timestamps por token (`t0`/`t1`, en centisegundos) están disponibles porque
/// `set_token_timestamps(true)` está siempre prendido (DECISIÓN de §06.1).
fn group_tokens_into_words(
    segment: &whisper_rs::WhisperSegment<'_>,
    t_offset_ms: i64,
) -> Vec<WordAccum> {
    let mut words = Vec::new();
    let mut current: Option<WordAccum> = None;

    for i in 0..segment.n_tokens() {
        let Some(token) = segment.get_token(i) else {
            continue;
        };
        let Ok(text) = token.to_str_lossy() else {
            continue;
        };
        // Tokens especiales (`[_BEG_]`, `[_TT_123]`, marcadores de idioma, etc.) no
        // son texto transcripto.
        if text.starts_with('[') && text.ends_with(']') {
            continue;
        }
        if text.is_empty() {
            continue;
        }

        let data = token.token_data();
        let t0_ms = t_offset_ms + data.t0 * 10;
        let t1_ms = t_offset_ms + data.t1 * 10;
        let starts_new_word = text.starts_with(' ') || text.starts_with('\u{a0}');
        let trimmed = text.trim().to_string();
        if trimmed.is_empty() {
            continue;
        }

        match &mut current {
            Some(word) if !starts_new_word => {
                word.text.push_str(&trimmed);
                word.t_end_ms = t1_ms;
                word.probability = word.probability.min(token.token_probability());
                word.plog += data.plog;
            }
            _ => {
                if let Some(finished) = current.take() {
                    words.push(finished);
                }
                current = Some(WordAccum {
                    text: trimmed,
                    t_start_ms: t0_ms,
                    t_end_ms: t1_ms,
                    probability: token.token_probability(),
                    plog: data.plog,
                });
            }
        }
    }
    if let Some(finished) = current.take() {
        words.push(finished);
    }
    words
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn params_exactos_de_la_decision_no_se_hardcodean_fuera_de_config() {
        // Documental: si esto compila, `AsrConfig::default()` sigue siendo la única
        // fuente de los valores del bloque DECISIÓN de §06.1.
        let cfg = AsrConfig::default();
        assert_eq!(cfg.language, "es");
        assert_eq!(cfg.temperature, 0.0);
        assert!(cfg.token_timestamps);
        assert!(cfg.suppress_blank);
        assert_eq!(cfg.no_speech_thold, 0.6);
    }
}
