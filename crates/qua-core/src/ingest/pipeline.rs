//! Interfaces que B1 deja listas para B2 (audio/ASR), B3 (correlador) y B4 (renderer).
//!
//! B1 termina en `session.json` con `utterances: []` e `issues: []` — el resto del
//! pipeline de §02 (`asr → correlate → render`) implementa estos traits sobre ese
//! archivo, sin tocar el servidor ni el store. `AsrPipeline` y `Correlator` siguen
//! siendo solo el contrato (B2/B3, en curso); `Renderer` ya tiene implementación
//! concreta en `qua_core::render::DefaultRenderer` (B4).

use std::error::Error;
use std::path::Path;

use qua_protocol::{Issue, Session, Utterance};

/// B2 (§6.1): jitter buffer → VAD silero → whisper.cpp sobre `raw/audio.pcm` (o
/// `audio.opus` una vez transcodificado).
pub trait AsrPipeline {
    fn transcribe(&self, pcm_path: &Path) -> Result<Vec<Utterance>, Box<dyn Error + Send + Sync>>;
}

/// B3 (§07): los 9 pasos del correlador sobre `events` + `utterances` de una `Session`.
pub trait Correlator {
    fn correlate(&self, session: &Session) -> Result<Vec<Issue>, Box<dyn Error + Send + Sync>>;
}

/// B4 (§8.1, §6.2): `report.md`, `issues.json`, recortes PNG, y los subcomandos que
/// dependen de haber corrido ASR + correlador (`show`, `export`, `reprocess`, `refine`).
pub trait Renderer {
    fn render(&self, session: &Session, out_dir: &Path)
        -> Result<(), Box<dyn Error + Send + Sync>>;
}
