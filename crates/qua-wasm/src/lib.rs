//! `qua-core` para el navegador (D-L1-01, modo local sin daemon).
//!
//! La extensión hace en JS lo que necesita APIs del navegador (micrófono, silero y
//! whisper vía onnxruntime-web, IndexedDB, capturas) y le pide a este módulo lo que ya
//! estaba resuelto y testeado en Rust: segmentar el audio con el mismo VAD de §06.1,
//! correr el correlador de §07 y renderizar el reporte de §08. Así el modo local y
//! `quad` producen exactamente el mismo `report.md` para los mismos datos.
//!
//! La interfaz es JSON por strings a propósito: los tipos ya tienen serde en
//! `qua-protocol` y el espejo TS en `@qua/protocol`, así que no hay un tercer contrato
//! que mantener.

use qua_core::asr::vad::{SpeechProbability, CHUNK_MS_16K, CHUNK_SIZE_16K};
use qua_core::asr::{AsrConfig, AudioFrontend};
use qua_core::correlate::{self, CorrelatorConfig};
use qua_core::render::{crop_for_target, render_issues_json, render_report_md, render_transcript};
use qua_core::SessionMeta;
use qua_protocol::audio_frame::AudioFrame;
use qua_protocol::{Event, ProjectRef, Rect, Session, SessionStatus, Utterance};
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

/// Muestras por frame de 20 ms a 16 kHz (§04), igual que la extensión y `quad`.
const SAMPLES_PER_FRAME: usize = 320;

fn js_err(e: impl std::fmt::Display) -> JsError {
    JsError::new(&e.to_string())
}

/// Probabilidades de silero ya calculadas en JS, una por chunk de [`CHUNK_SIZE_16K`]
/// muestras desde el inicio del audio. Se consumen en orden, igual que el detector real.
struct Precomputed {
    probs: Vec<f32>,
    next: usize,
}

impl SpeechProbability for Precomputed {
    fn speech_probability(&mut self, _chunk: &[f32]) -> f32 {
        let p = self.probs.get(self.next).copied().unwrap_or(0.0);
        self.next += 1;
        p
    }
}

#[derive(Serialize)]
struct Segment {
    /// ms desde el inicio de la sesión (mismo reloj que `Utterance.t_start`).
    t_offset_ms: i64,
    /// Índice de la primera muestra del segmento dentro del PCM recibido.
    start_sample: usize,
    /// Cantidad de muestras.
    len: usize,
}

/// Tamaño de chunk que espera [`segment`] para las probabilidades de silero.
#[wasm_bindgen]
pub fn vad_chunk_size() -> usize {
    CHUNK_SIZE_16K
}

/// §06.1 sin whisper: corre el `AudioFrontend` de `quad` sobre el PCM completo de la
/// sesión con las probabilidades de silero que calculó JS, y devuelve los segmentos de
/// habla como rangos de muestras (JSON). `asr_toml` es el `config.toml` (puede estar vacío).
#[wasm_bindgen]
pub fn segment(pcm: &[i16], probs: &[f32], asr_toml: &str) -> Result<String, JsError> {
    let cfg = AsrConfig::from_toml_str(asr_toml).map_err(js_err)?;
    let vad = Precomputed { probs: probs.to_vec(), next: 0 };
    let mut frontend = AudioFrontend::new(&cfg, vad, CHUNK_SIZE_16K, CHUNK_MS_16K);

    let mut pending = Vec::new();
    for (i, chunk) in pcm.chunks(SAMPLES_PER_FRAME).enumerate() {
        let mut samples = chunk.to_vec();
        samples.resize(SAMPLES_PER_FRAME, 0);
        pending.extend(frontend.push_frame(AudioFrame { seq: i as u32, t_ms: (i as u64) * 20, samples }));
    }
    pending.extend(frontend.flush());

    let segments: Vec<Segment> = pending
        .into_iter()
        .map(|p| Segment {
            t_offset_ms: p.t_offset_ms,
            start_sample: (p.t_offset_ms as usize) * 16,
            len: p.samples.len(),
        })
        .collect();
    serde_json::to_string(&segments).map_err(js_err)
}

#[derive(Deserialize)]
struct FinalizeInput {
    meta: SessionMeta,
    /// Eventos tal como los emite el content script (`t` en epoch-ms absoluto).
    events: Vec<serde_json::Value>,
    /// Ya en ms desde `t0_wall`.
    utterances: Vec<Utterance>,
    t_stop: i64,
    ended_at: String,
    #[serde(default)]
    config_toml: String,
}

#[derive(Serialize)]
struct Capture {
    issue_id: String,
    tab: i64,
    t_target: i64,
}

#[derive(Serialize)]
struct FinalizeOutput {
    session: Session,
    captures: Vec<Capture>,
    /// Eventos que no matchearon el esquema (se descartan, igual que `events_from_ndjson`).
    skipped_events: usize,
}

fn project_for(base_url: &str) -> ProjectRef {
    // Mismo fallback que `quad::config::match_project` sin `[[projects]]` (D2 de
    // TAREA-distribucion): el host de la página.
    let label = base_url
        .split_once("://")
        .map(|(_, rest)| rest.split(['/', '?', '#']).next().unwrap_or(""))
        .filter(|h| !h.is_empty())
        .map(|h| h.rsplit_once('@').map_or(h, |(_, host)| host))
        .map(|h| h.split(':').next().unwrap_or(h).to_string())
        .unwrap_or_else(|| "Sesión sin proyecto".to_string());
    ProjectRef { label, repo: None }
}

/// El `finalize` de `quad` (ws.rs) menos el disco: arma la `Session`, corre el
/// correlador y devuelve la sesión lista para [`render`] junto con los pedidos de
/// captura del paso 9 de §07.
#[wasm_bindgen]
pub fn finalize(input_json: &str) -> Result<String, JsError> {
    let input: FinalizeInput = serde_json::from_str(input_json).map_err(js_err)?;
    let correlator_cfg = CorrelatorConfig::from_toml_str(&input.config_toml).map_err(js_err)?;

    let mut skipped = 0;
    let events: Vec<Event> = input
        .events
        .into_iter()
        .filter_map(|v| match serde_json::from_value(v) {
            Ok(e) => Some(e),
            Err(_) => {
                skipped += 1;
                None
            }
        })
        .collect();

    let mut session = qua_core::build_session(
        &input.meta,
        events,
        SessionStatus::Processing,
        Some(input.ended_at),
        Some(input.t_stop),
        project_for(&input.meta.base_url),
        "audio.webm".to_string(),
    );
    session.utterances = input.utterances;

    let correlation = correlate::correlate(&session.events, &session.utterances, &correlator_cfg);
    session.issues = correlation.issues;
    session.stats.utterances = session.utterances.len() as i64;
    session.stats.issues = session.issues.len() as i64;
    session.status = SessionStatus::Ready;

    let out = FinalizeOutput {
        session,
        captures: correlation
            .captures
            .into_iter()
            .map(|c| Capture { issue_id: c.issue_id, tab: c.tab, t_target: c.t_target })
            .collect(),
        skipped_events: skipped,
    };
    serde_json::to_string(&out).map_err(js_err)
}

#[derive(Serialize)]
struct Rendered {
    report_md: String,
    issues_json: String,
    transcript: String,
}

/// §08: `report.md`, `issues.json` y `transcript.txt` de una `Session` (JSON).
#[wasm_bindgen]
pub fn render(session_json: &str) -> Result<String, JsError> {
    let session: Session = serde_json::from_str(session_json).map_err(js_err)?;
    let out = Rendered {
        report_md: render_report_md(&session),
        issues_json: render_issues_json(&session).map_err(js_err)?,
        transcript: render_transcript(&session),
    };
    serde_json::to_string(&out).map_err(js_err)
}

/// Recorte de §07 paso 9 sobre un frame JPEG del ring: mismo algoritmo que
/// `render_screenshots` de `quad`. Devuelve PNG.
///
/// El ring reduce cada captura a 1280 px de ancho (§5.3), así que la escala de px CSS a
/// px de imagen no es el `dpr`: es `ancho del frame / ancho del viewport`. Con el `dpr`,
/// en una pantalla retina (1710 px CSS → 3420 físicos → 1280 en el frame) el rect caía
/// fuera de la imagen y el recorte quedaba vacío (D-L1-07).
#[wasm_bindgen]
pub fn crop(jpeg: &[u8], rect_json: &str, viewport_w: f64) -> Result<Vec<u8>, JsError> {
    let rect: Rect = serde_json::from_str(rect_json).map_err(js_err)?;
    let img = image::load_from_memory(jpeg).map_err(js_err)?;
    let scale = if viewport_w > 0.0 { img.width() as f64 / viewport_w } else { 1.0 };
    let cropped = crop_for_target(&img, &rect, scale);
    let mut out = std::io::Cursor::new(Vec::new());
    cropped.write_to(&mut out, image::ImageFormat::Png).map_err(js_err)?;
    Ok(out.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn jpeg(w: u32, h: u32) -> Vec<u8> {
        let img = image::DynamicImage::new_rgb8(w, h);
        let mut out = std::io::Cursor::new(Vec::new());
        img.write_to(&mut out, image::ImageFormat::Jpeg).unwrap();
        out.into_inner()
    }

    #[test]
    fn recorta_un_frame_reducido_de_una_pantalla_retina() {
        // Viewport de 1710 px CSS a 2x, frame del ring reducido a 1280 × 734.
        let rect = r#"{"x":309,"y":567.8,"w":165.5,"h":21.75}"#;
        let png = crop(&jpeg(1280, 734), rect, 1710.0).expect("recorta");
        let out = image::load_from_memory(&png).unwrap();
        assert!(out.height() > 20, "alto {}", out.height());
        assert!(out.width() >= 470, "ancho {}", out.width()); // 640 px CSS de contexto × 0,75
    }

    #[test]
    fn el_label_es_el_host_sin_proyecto() {
        assert_eq!(project_for("https://technodevs.com.ar/x?y").label, "technodevs.com.ar");
        assert_eq!(project_for("http://localhost:3000/").label, "localhost");
        assert_eq!(project_for("about:blank").label, "Sesión sin proyecto");
    }
}
