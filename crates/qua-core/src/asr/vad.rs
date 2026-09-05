//! VAD silero y el segmentador de habla de §06.1.
//!
//! ```text
//! VAD silero, ventanas de 30 ms
//!    threshold 0.5 · min_speech 250 ms
//!    min_silence 600 ms · padding 300 ms a cada lado
//! → segmento cerrado (o corte forzado a 25 s)
//! ```
//!
//! `voice_activity_detector` envuelve el modelo silero v5, y ese modelo **exige**
//! `chunk_size = 512` a 16 kHz (documentado en su propio `VadConfigError`) — no acepta
//! ventanas arbitrarias. 512 muestras a 16 kHz son 32 ms, no 30. Ver D-09 en
//! `docs/DECISIONS.md`: se usa 32 ms porque es lo único que el modelo permite; la
//! diferencia con la spec es un redondeo del modelo, no una decisión de diseño.

use voice_activity_detector::VoiceActivityDetector;

/// Tamaño de chunk que el modelo silero v5 exige a 16 kHz. Ver el módulo doc.
pub const CHUNK_SIZE_16K: usize = 512;

/// Duración en ms de un chunk de [`CHUNK_SIZE_16K`] muestras a 16 kHz.
pub const CHUNK_MS_16K: u32 =
    (CHUNK_SIZE_16K as u32 * 1000) / crate::asr::ring::SAMPLE_RATE_HZ as u32;

/// Abstrae el modelo silero para poder testear el segmentador con probabilidades
/// determinísticas, sin cargar el ONNX real en cada test unitario.
pub trait SpeechProbability {
    /// Probabilidad de habla en `[0, 1]` para un chunk de exactamente
    /// [`CHUNK_SIZE_16K`] muestras f32 en `[-1, 1]`.
    fn speech_probability(&mut self, chunk: &[f32]) -> f32;
}

impl SpeechProbability for VoiceActivityDetector {
    fn speech_probability(&mut self, chunk: &[f32]) -> f32 {
        self.predict(chunk.iter().copied())
    }
}

/// Construye el detector silero de 16 kHz que usa el pipeline real (no-op en tests,
/// que usan un mock de [`SpeechProbability`]).
pub fn new_silero_16k() -> Result<VoiceActivityDetector, voice_activity_detector::Error> {
    VoiceActivityDetector::builder()
        .sample_rate(16_000i64)
        .chunk_size(CHUNK_SIZE_16K)
        .build()
}

/// Un segmento de habla cerrado, en ms absolutos desde el arranque del stream.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SpeechSegment {
    pub start_ms: u64,
    pub end_ms: u64,
}

impl SpeechSegment {
    pub fn duration_ms(&self) -> u64 {
        self.end_ms.saturating_sub(self.start_ms)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum State {
    Silence,
    Speech,
}

/// Parámetros del segmentador — todos vienen de [`crate::asr::config::AsrConfig`],
/// nunca hardcodeados en este módulo.
#[derive(Debug, Clone, Copy)]
pub struct SegmenterParams {
    pub threshold: f32,
    pub min_speech_ms: u32,
    pub min_silence_ms: u32,
    pub padding_ms: u32,
    pub forced_cutoff_ms: u32,
    pub chunk_ms: u32,
}

/// Máquina de estados que convierte un stream de probabilidades de habla en
/// segmentos cerrados (§06.1). Alimentada chunk a chunk por el pipeline.
pub struct Segmenter<V: SpeechProbability> {
    vad: V,
    params: SegmenterParams,
    state: State,
    cursor_ms: u64,
    speech_candidate_start_ms: Option<u64>,
    consecutive_speech_ms: u32,
    consecutive_silence_ms: u32,
    segment_start_ms: u64,
    last_speech_end_ms: u64,
}

impl<V: SpeechProbability> Segmenter<V> {
    pub fn new(vad: V, params: SegmenterParams) -> Self {
        Self {
            vad,
            params,
            state: State::Silence,
            cursor_ms: 0,
            speech_candidate_start_ms: None,
            consecutive_speech_ms: 0,
            consecutive_silence_ms: 0,
            segment_start_ms: 0,
            last_speech_end_ms: 0,
        }
    }

    /// Procesa un chunk (debe tener el largo de `params.chunk_ms`). Devuelve `Some`
    /// cuando el chunk cierra un segmento — por silencio sostenido o por corte forzado.
    pub fn push(&mut self, chunk: &[f32]) -> Option<SpeechSegment> {
        let prob = self.vad.speech_probability(chunk);
        let is_speech = prob >= self.params.threshold;
        let chunk_end_ms = self.cursor_ms + self.params.chunk_ms as u64;

        let mut closed = None;

        match self.state {
            State::Silence => {
                if is_speech {
                    let start = *self.speech_candidate_start_ms.get_or_insert(self.cursor_ms);
                    self.consecutive_speech_ms += self.params.chunk_ms;
                    if self.consecutive_speech_ms >= self.params.min_speech_ms {
                        self.segment_start_ms = start.saturating_sub(self.params.padding_ms as u64);
                        self.last_speech_end_ms = chunk_end_ms;
                        self.consecutive_silence_ms = 0;
                        self.speech_candidate_start_ms = None;
                        self.state = State::Speech;
                    }
                } else {
                    self.speech_candidate_start_ms = None;
                    self.consecutive_speech_ms = 0;
                }
            }
            State::Speech => {
                if is_speech {
                    self.last_speech_end_ms = chunk_end_ms;
                    self.consecutive_silence_ms = 0;
                } else {
                    self.consecutive_silence_ms += self.params.chunk_ms;
                    if self.consecutive_silence_ms >= self.params.min_silence_ms {
                        let end = self.last_speech_end_ms + self.params.padding_ms as u64;
                        closed = Some(SpeechSegment {
                            start_ms: self.segment_start_ms,
                            end_ms: end,
                        });
                        self.reset_to_silence();
                    }
                }

                // Corte forzado: no espera al silencio, el segmento ya es demasiado largo.
                if self.state == State::Speech
                    && chunk_end_ms.saturating_sub(self.segment_start_ms)
                        >= self.params.forced_cutoff_ms as u64
                {
                    closed = Some(SpeechSegment {
                        start_ms: self.segment_start_ms,
                        end_ms: chunk_end_ms,
                    });
                    // La voz puede seguir: se abre el próximo segmento pegado a este,
                    // sin padding (no hubo silencio real de por medio).
                    self.segment_start_ms = chunk_end_ms;
                    self.last_speech_end_ms = chunk_end_ms;
                    self.consecutive_silence_ms = 0;
                }
            }
        }

        self.cursor_ms = chunk_end_ms;
        closed
    }

    /// Cierra un segmento que haya quedado abierto (fin de sesión). No aplica
    /// padding final porque no hay más audio del lado derecho para respaldarlo.
    pub fn flush(&mut self) -> Option<SpeechSegment> {
        if self.state == State::Speech {
            let segment = SpeechSegment {
                start_ms: self.segment_start_ms,
                end_ms: self.last_speech_end_ms,
            };
            self.reset_to_silence();
            Some(segment)
        } else {
            None
        }
    }

    fn reset_to_silence(&mut self) {
        self.state = State::Silence;
        self.speech_candidate_start_ms = None;
        self.consecutive_speech_ms = 0;
        self.consecutive_silence_ms = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Un mock que devuelve, en orden, una probabilidad fija por chunk. Se repite el
    /// último valor si se piden más chunks de los que tiene la lista.
    struct ScriptedVad {
        probs: Vec<f32>,
        i: usize,
    }

    impl ScriptedVad {
        fn new(probs: Vec<f32>) -> Self {
            Self { probs, i: 0 }
        }
    }

    impl SpeechProbability for ScriptedVad {
        fn speech_probability(&mut self, _chunk: &[f32]) -> f32 {
            let p = *self.probs.get(self.i).unwrap_or(self.probs.last().unwrap());
            self.i += 1;
            p
        }
    }

    fn params() -> SegmenterParams {
        SegmenterParams {
            threshold: 0.5,
            min_speech_ms: 250,
            min_silence_ms: 600,
            padding_ms: 300,
            forced_cutoff_ms: 25_000,
            chunk_ms: 30, // números redondos para que los tests sean legibles
        }
    }

    fn chunk() -> Vec<f32> {
        vec![0.0; 16]
    }

    fn push_n(seg: &mut Segmenter<ScriptedVad>, n: usize) -> Vec<SpeechSegment> {
        let mut out = Vec::new();
        for _ in 0..n {
            if let Some(s) = seg.push(&chunk()) {
                out.push(s);
            }
        }
        out
    }

    #[test]
    fn silencio_puro_no_abre_ningun_segmento() {
        let mut seg = Segmenter::new(ScriptedVad::new(vec![0.0]), params());
        assert!(push_n(&mut seg, 50).is_empty());
        assert!(seg.flush().is_none());
    }

    #[test]
    fn habla_corta_por_debajo_de_min_speech_no_abre_segmento() {
        // 250ms / 30ms ~ 8.3 chunks. 5 chunks de habla (150ms) no alcanzan.
        let mut probs = vec![0.9; 5];
        probs.extend(vec![0.0; 30]);
        let mut seg = Segmenter::new(ScriptedVad::new(probs), params());
        assert!(push_n(&mut seg, 35).is_empty());
    }

    #[test]
    fn habla_sostenida_seguida_de_silencio_cierra_un_segmento_con_padding() {
        // 10 chunks de habla (300ms, supera min_speech) + 25 de silencio (750ms,
        // supera min_silence de 600ms).
        let mut probs = vec![0.9; 10];
        probs.extend(vec![0.0; 25]);
        let mut seg = Segmenter::new(ScriptedVad::new(probs), params());
        let closed = push_n(&mut seg, 35);
        assert_eq!(closed.len(), 1);
        let s = closed[0];

        // min_speech_ms=250 -> el segmento arranca a partir del chunk 9 (270ms de
        // habla acumulada, el primero que cruza el umbral), menos el padding.
        // start_ms del candidato de habla = 0 (arrancó en el primer chunk hablado).
        assert_eq!(s.start_ms, 0u64.saturating_sub(300)); // clamp a 0 vía saturating_sub
        assert!(s.duration_ms() > 0);
    }

    #[test]
    fn corte_forzado_a_25s_cierra_sin_esperar_silencio() {
        let chunk_ms = 30u32;
        let total_chunks_25s = 25_000 / chunk_ms + 5; // habla sin pausas, más de 25s
        let probs = vec![0.9; total_chunks_25s as usize];
        let mut seg = Segmenter::new(ScriptedVad::new(probs), params());
        let closed = push_n(&mut seg, total_chunks_25s as usize);
        assert!(!closed.is_empty(), "el corte forzado tiene que disparar");
        let first = closed[0];
        assert!(
            first.duration_ms() >= 25_000,
            "el primer corte forzado tiene que llegar a los 25s: {}",
            first.duration_ms()
        );
    }

    #[test]
    fn flush_cierra_un_segmento_que_quedo_abierto() {
        let probs = vec![0.9; 15]; // habla sostenida, sesión termina en medio del habla
        let mut seg = Segmenter::new(ScriptedVad::new(probs), params());
        assert!(push_n(&mut seg, 15).is_empty());
        let flushed = seg.flush().expect("tiene que haber un segmento abierto");
        assert!(flushed.duration_ms() > 0);
        assert!(seg.flush().is_none(), "no hay nada más para cerrar");
    }

    #[test]
    fn chunk_size_16k_es_512_muestras_32ms() {
        assert_eq!(CHUNK_SIZE_16K, 512);
        assert_eq!(CHUNK_MS_16K, 32);
    }
}
