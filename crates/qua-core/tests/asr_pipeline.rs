//! Test de aceptación de B2 (§06.1, §14): un WAV corto en español, de punta a punta
//! por el pipeline real —
//!
//! ```text
//! WAV → AudioFrame[] (simula los frames del WS) → jitter buffer → ring buffer
//!     → VAD silero real → segmento cerrado → worker de whisper real (modelo
//!       descargado y verificado por SHA-256) → Utterance con timestamps por palabra
//! ```
//!
//! `fixtures/audio/es-hover-sidebar.wav` es habla sintetizada con `say -v Mónica`
//! (voz de macOS en español) y bajada a 16 kHz mono con ffmpeg — ver
//! `docs/DECISIONS.md` (B2) para por qué no es una grabación humana. El texto
//! incluye vocabulario técnico de `vocab.txt` ("hover", "sidebar", "componente")
//! a propósito, para poder verificar que el priming del prompt de §06.1 hace lo que
//! promete.
//!
//! Usa `ggml-base` (no `ggml-large-v3-turbo-q5_0`): la descarga del modelo grande
//! son ~574 MB, demasiado para un test que corre en cada `cargo test`. `ensure_model`
//! es el mismo camino de producción, solo que apuntado al modelo chico — ver D-10 en
//! `docs/DECISIONS.md`.

use qua_core::asr::{
    self, ensure_model, ensure_vocab_seeded, AsrConfig, AudioFrontend, WhisperWorker, BASE,
};
use qua_protocol::audio_frame::AudioFrame;

const SAMPLES_PER_FRAME: usize = 320; // 20ms @ 16kHz, layout de §04.

fn load_wav_i16(path: &std::path::Path) -> (Vec<i16>, u32, u16) {
    let mut reader = hound::WavReader::open(path).expect("abrir el WAV de fixtures/audio/");
    let spec = reader.spec();
    let samples: Vec<i16> = reader
        .samples::<i16>()
        .map(|s| s.expect("muestra inválida en el WAV"))
        .collect();
    (samples, spec.sample_rate, spec.channels)
}

fn to_frames(samples: &[i16]) -> Vec<AudioFrame> {
    samples
        .chunks(SAMPLES_PER_FRAME)
        .enumerate()
        .map(|(i, chunk)| {
            let mut padded = chunk.to_vec();
            padded.resize(SAMPLES_PER_FRAME, 0);
            AudioFrame {
                seq: i as u32,
                t_ms: (i as u64) * 20,
                samples: padded,
            }
        })
        .collect()
}

#[test]
fn wav_en_espanol_produce_una_utterance_con_timestamps_por_palabra() {
    let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/audio/es-hover-sidebar.wav");
    assert!(
        fixture.exists(),
        "falta la fixture de audio commiteada en fixtures/audio/: {fixture:?}"
    );

    let (samples, sample_rate, channels) = load_wav_i16(&fixture);
    assert_eq!(
        sample_rate, 16_000,
        "la fixture tiene que estar a 16kHz (§03 audio)"
    );
    assert_eq!(channels, 1, "la fixture tiene que ser mono");

    // --- 1. Descarga y verificación del modelo (§06.1: "Gestión del modelo") ---
    //
    // Se usa `asr::models_dir()` (el `~/.qua/models` real) y no un tempdir: es
    // exactamente lo que hace el daemon, y evita volver a bajar ~148 MB en cada
    // corrida local de `cargo test` — `ensure_model` ya es idempotente por SHA-256,
    // así que una vez cacheado esto no toca la red de nuevo.
    let models_dir = asr::models_dir();
    let mut progress_calls = 0u32;
    let mut last_progress = None;
    let model_path = ensure_model(&BASE, &models_dir, |p| {
        progress_calls += 1;
        last_progress = Some(p);
    })
    .expect("la descarga y verificación SHA-256 del modelo tienen que andar");
    assert!(model_path.exists());
    // Si el modelo no estaba cacheado hubo progreso; si ya estaba (`cargo test`
    // repetido localmente) puede ser cero porque `ensure_model` es idempotente.
    if progress_calls > 0 {
        let last = last_progress.unwrap();
        assert!(last.downloaded_bytes > 0);
    }

    // Re-verificar contra el mismo modelo no debe volver a bajar nada.
    let calls_before = progress_calls;
    ensure_model(&BASE, &models_dir, |_| progress_calls += 1)
        .expect("segunda llamada, ya cacheado");
    assert_eq!(progress_calls, calls_before, "ensure_model es idempotente");

    // --- 2. Priming del prompt (§06.1): vocab.txt sembrado + sin utterance previa ---
    let vocab_dir = tempfile::tempdir().expect("tmp vocab dir");
    let vocab_path = vocab_dir.path().join("vocab.txt");
    let vocab = ensure_vocab_seeded(&vocab_path).expect("sembrar vocab.txt");
    assert!(vocab.contains("hover"));
    assert!(vocab.contains("sidebar"));
    let initial_prompt = asr::build_initial_prompt(&vocab, None);

    // --- 3. Pipeline de audio: frames -> jitter -> ring -> VAD silero real ---
    let cfg = AsrConfig::default();
    let vad = asr::vad::new_silero_16k().expect("cargar el modelo silero embebido");
    let mut frontend =
        AudioFrontend::new(&cfg, vad, asr::vad::CHUNK_SIZE_16K, asr::vad::CHUNK_MS_16K);

    let mut pending = Vec::new();
    for frame in to_frames(&samples) {
        pending.extend(frontend.push_frame(frame));
    }
    pending.extend(frontend.flush());

    assert!(
        !pending.is_empty(),
        "el VAD tiene que haber cerrado al menos un segmento de habla en 4s de audio hablado"
    );

    // --- 4. Worker de whisper real, con los parámetros exactos de la DECISIÓN ---
    let mut worker = WhisperWorker::load(&model_path).expect("cargar el contexto de whisper");

    let mut utterances = Vec::new();
    for (i, seg) in pending.into_iter().enumerate() {
        let id = format!("u{:02}", i + 1);
        let utterance = worker
            .transcribe(id, &seg.samples, seg.t_offset_ms, &cfg, &initial_prompt)
            .expect("la transcripción tiene que correr sin error");
        utterances.push(utterance);
    }

    let utterance = utterances
        .into_iter()
        .max_by_key(|u| u.text.len())
        .expect("al menos una utterance");

    eprintln!("--- transcripción de es-hover-sidebar.wav ---");
    eprintln!("texto: {:?}", utterance.text);
    eprintln!(
        "avg_logprob: {} no_speech_prob: {}",
        utterance.avg_logprob, utterance.no_speech_prob
    );
    for w in &utterance.words {
        eprintln!("  {:>6} ms +{:<4} ms  p={:.2}  {:?}", w.t, w.d, w.p, w.w);
    }

    assert!(
        !utterance.text.trim().is_empty(),
        "whisper tiene que haber transcripto algo"
    );
    assert_eq!(utterance.lang, "es");
    assert!(
        !utterance.words.is_empty(),
        "el criterio de B2 exige timestamps por palabra"
    );
    for pair in utterance.words.windows(2) {
        assert!(
            pair[1].t >= pair[0].t,
            "las palabras tienen que venir en orden temporal no decreciente: {pair:?}"
        );
    }
    for w in &utterance.words {
        assert!(w.t >= 0, "timestamp de palabra negativo: {w:?}");
        assert!(
            (0.0..=1.0).contains(&w.p),
            "probabilidad de palabra fuera de rango: {w:?}"
        );
    }

    // El VAD no tiene que alucinar sobre silencio puro (§15, riesgo conocido): con
    // 4s de habla real el no_speech_prob del segmento principal tiene que ser bajo.
    assert!(
        utterance.no_speech_prob < 0.6,
        "no_speech_prob sospechosamente alto para un segmento con habla real: {}",
        utterance.no_speech_prob
    );
}
