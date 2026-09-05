//! G1: cablea B2 (ASR) → B3 (correlador) → B4 (renderer) sobre una sesión de
//! `qua-core::ingest` (§02).
//!
//! B1 dejó `session.stop` respondiendo con `status = "processing"`, `utterances: []`
//! e `issues: []` a propósito (D-B1-04): B2/B3/B4 solo entregaron los *traits* de
//! `qua_core::ingest::pipeline`, sin una implementación concreta que los una. Este
//! módulo es esa implementación: `qua process` la corre una vez con audio real desde
//! `raw/audio.pcm`, y tanto `finalize` (fin de sesión en vivo) como `qua reprocess`
//! (re-tuning del correlador sin regrabar) la llaman.
//!
//! **Lo que falta a propósito, documentado en `docs/DECISIONS.md` (D-G1-01):** el
//! paso 9 de §07 (`CaptureRequest`) pide un recorte de pantalla en vivo por WS
//! mientras la sesión sigue conectada — acá la sesión ya terminó cuando esto corre,
//! así que las capturas se descartan y `report.md` sale sin recortes. `render_session`
//! ya degrada bien a "sin captura" (D-B4-05), así que el reporte es válido, solo que
//! sin evidencia visual.

use std::path::Path;

use qua_core::asr::{
    self, ensure_model, ensure_vocab_seeded, vad, AsrConfig, AudioFrontend, ModelSpec,
    PromptState, WhisperWorker,
};
use qua_core::correlate::{self, CorrelatorConfig};
use qua_protocol::audio_frame::AudioFrame;
use qua_protocol::{Session, SessionStatus, Utterance};

/// Cuántas muestras i16 trae un frame de 20 ms a 16 kHz (§04, igual que la extensión).
const SAMPLES_PER_FRAME: usize = 320;

fn read_pcm_i16(path: &Path) -> std::io::Result<Vec<i16>> {
    let bytes = std::fs::read(path)?;
    Ok(bytes
        .chunks_exact(2)
        .map(|c| i16::from_le_bytes([c[0], c[1]]))
        .collect())
}

/// ASR por lotes sobre un `raw/audio.pcm` ya cerrado: reconstruye los frames de 20 ms
/// tal como llegarían por WS (mismo layout, `t_ms` derivado del offset de muestra
/// porque el archivo ya está en orden de llegada — ver `RawAudioLog`) y corre el mismo
/// pipeline síncrono que B2 testeó en `asr_pipeline.rs`.
fn transcribe(pcm_path: &Path, cfg: &AsrConfig) -> anyhow::Result<Vec<Utterance>> {
    if !pcm_path.exists() {
        return Ok(Vec::new());
    }
    let samples = read_pcm_i16(pcm_path)?;
    if samples.is_empty() {
        return Ok(Vec::new());
    }

    let model_spec = ModelSpec::by_id(&cfg.model).unwrap_or(asr::BASE);
    let model_path = ensure_model(&model_spec, &asr::models_dir(), |_| {})?;
    let vocab = ensure_vocab_seeded(&asr::vocab_path())?;

    let silero = vad::new_silero_16k()?;
    let mut frontend = AudioFrontend::new(cfg, silero, vad::CHUNK_SIZE_16K, vad::CHUNK_MS_16K);

    let mut pending = Vec::new();
    for (i, chunk) in samples.chunks(SAMPLES_PER_FRAME).enumerate() {
        let mut padded = chunk.to_vec();
        padded.resize(SAMPLES_PER_FRAME, 0);
        pending.extend(frontend.push_frame(AudioFrame {
            seq: i as u32,
            t_ms: (i as u64) * 20,
            samples: padded,
        }));
    }
    pending.extend(frontend.flush());

    let mut worker = WhisperWorker::load(&model_path)?;
    let mut prompt_state = PromptState::new(vocab);
    let mut utterances = Vec::with_capacity(pending.len());
    for (i, seg) in pending.into_iter().enumerate() {
        let id = format!("u{:02}", i + 1);
        let prompt = prompt_state.current_prompt();
        let utterance = worker.transcribe(id, &seg.samples, seg.t_offset_ms, cfg, &prompt)?;
        prompt_state.record(&utterance);
        utterances.push(utterance);
    }
    Ok(utterances)
}

/// Corre ASR (si hace falta) + el correlador sobre `session`, in-place.
///
/// Idempotente a propósito: si `session.utterances` ya tiene datos (una corrida
/// anterior de este mismo proceso, vía `finalize` o `qua reprocess`) no vuelve a
/// transcribir — solo re-corre el correlador, que es rápido y es lo que permite
/// tunear `[correlator]` sin regrabar (§6.2). Solo transcribe de cero cuando
/// `utterances` está vacío y hay `raw/audio.pcm` con datos.
pub fn process(session: &mut Session, dir: &Path, data_dir: &Path) -> anyhow::Result<()> {
    let config_path = data_dir.join("config.toml");
    let asr_cfg = AsrConfig::load(&config_path)?;
    let correlator_cfg = CorrelatorConfig::from_path(&config_path)?;

    if session.utterances.is_empty() {
        session.utterances = transcribe(&dir.join("raw/audio.pcm"), &asr_cfg)?;
    }

    let correlation = correlate::correlate(&session.events, &session.utterances, &correlator_cfg);
    session.issues = correlation.issues;
    // D-G1-01: `correlation.captures` (pedidos de screenshot del paso 9) se descartan
    // a propósito — ver el comentario de módulo.

    session.stats.utterances = session.utterances.len() as i64;
    session.stats.issues = session.issues.len() as i64;
    session.status = SessionStatus::Ready;

    Ok(())
}
