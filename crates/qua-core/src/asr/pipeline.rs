//! Cablea todo el pipeline de §06.1:
//!
//! ```text
//! frames WS → jitter buffer → ring buffer → VAD silero → segmento cerrado
//!           → cola acotada → 1 worker whisper → Utterance
//! ```
//!
//! [`AudioFrontend`] es la parte síncrona y pura (jitter + ring + VAD): reordena
//! frames y devuelve segmentos cerrados, sin tocar disco ni red — se testea sin
//! cargar ni el modelo VAD real ni whisper. El worker de whisper (que sí necesita el
//! modelo cargado) vive en [`run_whisper_worker`], pensado para correr en su propio
//! hilo consumiendo la cola.

use qua_protocol::audio_frame::AudioFrame;
use qua_protocol::utterance::Utterance;

use crate::asr::config::AsrConfig;
use crate::asr::jitter::JitterBuffer;
use crate::asr::prompt::build_initial_prompt;
use crate::asr::queue::PendingSegment;
use crate::asr::ring::{i16_to_f32, RingBuffer, SAMPLE_RATE_HZ};
use crate::asr::vad::{Segmenter, SegmenterParams, SpeechProbability};
#[cfg(feature = "native")]
use crate::asr::whisper::{WhisperWorker, WhisperWorkerError};

const MS_PER_SEC: u64 = 1000;

/// La parte síncrona del pipeline: jitter buffer + ring buffer + VAD. No conoce
/// whisper ni hilos — solo consume [`AudioFrame`]s y devuelve [`PendingSegment`]s.
pub struct AudioFrontend<V: SpeechProbability> {
    jitter: JitterBuffer,
    ring: RingBuffer,
    segmenter: Segmenter<V>,
    vad_chunk_size: usize,
    vad_accum: Vec<f32>,
}

impl<V: SpeechProbability> AudioFrontend<V> {
    pub fn new(cfg: &AsrConfig, vad: V, vad_chunk_size: usize, vad_chunk_ms: u32) -> Self {
        let params = SegmenterParams {
            threshold: cfg.vad_threshold,
            min_speech_ms: cfg.min_speech_ms,
            min_silence_ms: cfg.min_silence_ms,
            padding_ms: cfg.vad_padding_ms,
            forced_cutoff_ms: cfg.forced_cutoff_ms,
            chunk_ms: vad_chunk_ms,
        };
        Self {
            jitter: JitterBuffer::new(cfg.jitter_window_ms as u64),
            ring: RingBuffer::with_seconds(cfg.ring_seconds),
            segmenter: Segmenter::new(vad, params),
            vad_chunk_size,
            vad_accum: Vec::with_capacity(vad_chunk_size),
        }
    }

    /// Empuja un frame recién llegado del WS. Devuelve cero o más segmentos que el
    /// VAD acaba de cerrar y ya están listos para la cola de whisper.
    pub fn push_frame(&mut self, frame: AudioFrame) -> Vec<PendingSegment> {
        let mut out = Vec::new();
        for ordered in self.jitter.push(frame) {
            out.extend(self.feed_ring(&ordered.samples));
        }
        out
    }

    /// Fin de sesión: drena el jitter buffer y cierra cualquier segmento que haya
    /// quedado abierto en el VAD.
    pub fn flush(&mut self) -> Vec<PendingSegment> {
        let mut out = Vec::new();
        for ordered in self.jitter.flush() {
            out.extend(self.feed_ring(&ordered.samples));
        }
        if let Some(seg) = self.segmenter.flush() {
            if let Some(pending) = self.segment_to_pending(seg) {
                out.push(pending);
            }
        }
        out
    }

    fn feed_ring(&mut self, samples_i16: &[i16]) -> Vec<PendingSegment> {
        self.ring.push_i16(samples_i16);
        let mut out = Vec::new();
        for &s in samples_i16 {
            self.vad_accum.push(i16_to_f32(s));
            if self.vad_accum.len() == self.vad_chunk_size {
                let chunk =
                    std::mem::replace(&mut self.vad_accum, Vec::with_capacity(self.vad_chunk_size));
                if let Some(seg) = self.segmenter.push(&chunk) {
                    if let Some(pending) = self.segment_to_pending(seg) {
                        out.push(pending);
                    }
                }
            }
        }
        out
    }

    fn segment_to_pending(&self, seg: crate::asr::vad::SpeechSegment) -> Option<PendingSegment> {
        let start_sample = ms_to_samples(seg.start_ms);
        let end_sample = ms_to_samples(seg.end_ms).max(start_sample + 1);
        match self.ring.read_range(start_sample, end_sample) {
            Ok(samples) => Some(PendingSegment {
                samples,
                t_offset_ms: seg.start_ms as i64,
            }),
            Err(err) => {
                tracing::warn!(
                    "segmento de VAD [{}, {}) ms ya no está en el ring buffer: {err}",
                    seg.start_ms,
                    seg.end_ms
                );
                None
            }
        }
    }
}

fn ms_to_samples(ms: u64) -> u64 {
    ms * SAMPLE_RATE_HZ as u64 / MS_PER_SEC
}

/// Estado que el worker de whisper mantiene entre utterances para el priming del
/// prompt de §06.1: `vocab.txt` + últimos 200 chars de la utterance anterior.
pub struct PromptState {
    vocab: String,
    last_utterance_text: Option<String>,
}

impl PromptState {
    pub fn new(vocab: String) -> Self {
        Self {
            vocab,
            last_utterance_text: None,
        }
    }

    pub fn current_prompt(&self) -> String {
        build_initial_prompt(&self.vocab, self.last_utterance_text.as_deref())
    }

    pub fn record(&mut self, utterance: &Utterance) {
        if !utterance.text.is_empty() {
            self.last_utterance_text = Some(utterance.text.clone());
        }
    }
}

/// Cuerpo del worker de whisper de §06.1: consume la cola acotada en orden y produce
/// una `Utterance` por segmento, hasta que el canal se cierra (fin de sesión).
/// Pensado para correr en su propio hilo (`std::thread::spawn`) — un solo
/// `WhisperContext` por worker, nunca compartido entre hilos concurrentemente.
#[cfg(feature = "native")]
pub fn run_whisper_worker(
    mut worker: WhisperWorker,
    cfg: &AsrConfig,
    vocab: String,
    rx: std::sync::mpsc::Receiver<PendingSegment>,
    mut on_utterance: impl FnMut(Utterance),
) -> Result<(), WhisperWorkerError> {
    let mut prompt_state = PromptState::new(vocab);

    for (next_id, pending) in (1u32..).zip(rx.iter()) {
        let id = format!("u{:02}", next_id);
        let prompt = prompt_state.current_prompt();
        let utterance =
            worker.transcribe(id, &pending.samples, pending.t_offset_ms, cfg, &prompt)?;
        prompt_state.record(&utterance);
        on_utterance(utterance);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::asr::vad::CHUNK_SIZE_16K;

    /// VAD determinístico para tests: habla mientras `speaking` sea true.
    struct ToggleVad {
        speaking: std::rc::Rc<std::cell::Cell<bool>>,
    }
    impl SpeechProbability for ToggleVad {
        fn speech_probability(&mut self, _chunk: &[f32]) -> f32 {
            if self.speaking.get() {
                0.95
            } else {
                0.0
            }
        }
    }

    fn frame(seq: u32, t_ms: u64, value: i16) -> AudioFrame {
        AudioFrame {
            seq,
            t_ms,
            samples: vec![value; 320],
        }
    }

    #[test]
    fn un_tramo_de_habla_sostenida_produce_un_segmento_pendiente() {
        let speaking = std::rc::Rc::new(std::cell::Cell::new(true));
        let vad = ToggleVad {
            speaking: speaking.clone(),
        };
        let cfg = AsrConfig::default();
        let mut frontend = AudioFrontend::new(&cfg, vad, CHUNK_SIZE_16K, 32);

        let mut pending = Vec::new();
        // 20ms/frame * 100 frames = 2s de habla, de sobra para min_speech (250ms).
        for seq in 0..100u32 {
            pending.extend(frontend.push_frame(frame(seq, seq as u64 * 20, 1000)));
        }
        // corta la voz: min_silence (600ms) => ~30 frames de 20ms
        speaking.set(false);
        for seq in 100..140u32 {
            pending.extend(frontend.push_frame(frame(seq, seq as u64 * 20, 0)));
        }

        assert_eq!(
            pending.len(),
            1,
            "un solo segmento de habla, cerrado por silencio"
        );
        assert!(!pending[0].samples.is_empty());
    }

    #[test]
    fn silencio_puro_no_produce_ningun_segmento() {
        let speaking = std::rc::Rc::new(std::cell::Cell::new(false));
        let vad = ToggleVad { speaking };
        let cfg = AsrConfig::default();
        let mut frontend = AudioFrontend::new(&cfg, vad, CHUNK_SIZE_16K, 32);

        let mut pending = Vec::new();
        for seq in 0..50u32 {
            pending.extend(frontend.push_frame(frame(seq, seq as u64 * 20, 0)));
        }
        pending.extend(frontend.flush());
        assert!(pending.is_empty());
    }

    #[test]
    fn flush_cierra_un_segmento_que_quedo_hablando_al_terminar_la_sesion() {
        let speaking = std::rc::Rc::new(std::cell::Cell::new(true));
        let vad = ToggleVad { speaking };
        let cfg = AsrConfig::default();
        let mut frontend = AudioFrontend::new(&cfg, vad, CHUNK_SIZE_16K, 32);

        let mut pending = Vec::new();
        for seq in 0..60u32 {
            pending.extend(frontend.push_frame(frame(seq, seq as u64 * 20, 1000)));
        }
        assert!(pending.is_empty(), "todavía no cerró nada, sigue hablando");
        pending.extend(frontend.flush());
        assert_eq!(pending.len(), 1);
    }

    #[test]
    fn prompt_state_encadena_vocab_y_la_utterance_anterior() {
        let mut state = PromptState::new("vocab-de-prueba".to_string());
        assert_eq!(state.current_prompt(), "vocab-de-prueba");

        state.record(&Utterance {
            id: "u01".into(),
            t_start: 0,
            t_end: 100,
            text: "hola mundo".into(),
            lang: "es".into(),
            words: vec![],
            avg_logprob: 0.0,
            no_speech_prob: 0.0,
            marked: false,
        });
        assert_eq!(state.current_prompt(), "vocab-de-prueba hola mundo");
    }
}
