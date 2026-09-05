//! B4 (§08, §06.2): `report.md` + `issues.json` + `transcript.txt` + recortes PNG.
//!
//! Cada submódulo es una función pura `Session -> String` (o `Session -> Vec<u8>` para
//! el recorte), para que el formato completo se pueda testear byte a byte contra una
//! fixture de F0 sin levantar ningún I/O. [`render_session`] es la única función que
//! toca disco: le pega a esas funciones puras y escribe el resultado bajo
//! `<session_dir>/{report.md,issues.json,transcript.txt,assets/}`.

pub mod issues_json;
pub mod report;
pub mod screenshot;
pub mod transcript;

mod time_fmt;

use std::path::{Path, PathBuf};

use qua_protocol::Session;

pub use issues_json::render_issues_json;
pub use report::render_report_md;
pub use screenshot::{crop_for_target, CONTEXT_WIDTH_PX, TARGET_PADDING_PX};
pub use transcript::render_transcript;

#[derive(Debug, thiserror::Error)]
pub enum RenderError {
    #[error("IO: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON: {0}")]
    Json(#[from] serde_json::Error),
}

/// Lo que produjo un `render_session` exitoso, para que el CLI (§6.2) y los tests
/// sepan qué se escribió sin tener que volver a listar el directorio.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RenderOutput {
    pub report_path: PathBuf,
    pub issues_path: PathBuf,
    pub transcript_path: PathBuf,
    /// Capturas efectivamente recortadas — solo las que tenían un frame crudo
    /// disponible en `raw/frames/` (§07 paso 9; ver D-B4-05 en `docs/DECISIONS.md`).
    pub screenshots: Vec<PathBuf>,
}

/// Escribe los cuatro artefactos de §8.2 que le tocan a B4 dentro de `session_dir`.
/// Es la implementación concreta de `qua_core::ingest::pipeline::Renderer`.
///
/// Idempotente: es una función pura de `session` más lo que haya en
/// `raw/frames/<issue_id>.{jpg,jpeg,png}`, así que correrla dos veces sobre los mismos
/// datos produce bytes idénticos — es lo que hace que `qua reprocess` se pueda repetir
/// sin drift (criterio de aceptación de B4).
pub fn render_session(session: &Session, session_dir: &Path) -> Result<RenderOutput, RenderError> {
    std::fs::create_dir_all(session_dir)?;

    let report_path = session_dir.join("report.md");
    std::fs::write(&report_path, render_report_md(session))?;

    let issues_path = session_dir.join("issues.json");
    std::fs::write(&issues_path, render_issues_json(session)?)?;

    let transcript_path = session_dir.join("transcript.txt");
    std::fs::write(&transcript_path, render_transcript(session))?;

    let screenshots = screenshot::render_screenshots(session, session_dir)?;

    Ok(RenderOutput {
        report_path,
        issues_path,
        transcript_path,
        screenshots,
    })
}

/// Implementación concreta de `ingest::pipeline::Renderer` para que el daemon (o
/// `qua reprocess`) la use detrás del trait sin importar `qua_core::render` directo.
pub struct DefaultRenderer;

impl crate::ingest::pipeline::Renderer for DefaultRenderer {
    fn render(
        &self,
        session: &Session,
        out_dir: &Path,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        render_session(session, out_dir)?;
        Ok(())
    }
}
