//! Gestión del modelo whisper (§06.1): descarga desde Hugging Face a `~/.qua/models/`,
//! verificación SHA-256 y progreso.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

/// Un modelo whisper conocido: dónde bajarlo y con qué hash verificarlo.
///
/// Los SHA-256 son los que reporta la API de Hugging Face para el blob LFS
/// (`GET /api/models/ggerganov/whisper.cpp?blobs=true`), no inventados.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ModelSpec {
    pub id: &'static str,
    pub filename: &'static str,
    pub url: &'static str,
    pub sha256: &'static str,
    pub approx_bytes: u64,
}

/// El modelo por defecto de §06.1: `large-v3-turbo-q5_0`, ~574 MB.
pub const LARGE_V3_TURBO_Q5_0: ModelSpec = ModelSpec {
    id: "large-v3-turbo-q5_0",
    filename: "ggml-large-v3-turbo-q5_0.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin",
    sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2",
    approx_bytes: 574_041_195,
};

/// Fallback de §06.1 para máquinas sin aceleración: `base`, ~148 MB.
pub const BASE: ModelSpec = ModelSpec {
    id: "base",
    filename: "ggml-base.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
    sha256: "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe",
    approx_bytes: 147_951_465,
};

pub const KNOWN_MODELS: &[ModelSpec] = &[LARGE_V3_TURBO_Q5_0, BASE];

impl ModelSpec {
    pub fn by_id(id: &str) -> Option<ModelSpec> {
        KNOWN_MODELS.iter().copied().find(|m| m.id == id)
    }

    /// Ruta destino en `~/.qua/models/<filename>`.
    pub fn dest_path(&self, models_dir: &Path) -> PathBuf {
        models_dir.join(self.filename)
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ModelError {
    #[error("modelo desconocido: {0:?}. Conocidos: {known:?}", known = KNOWN_MODELS.iter().map(|m| m.id).collect::<Vec<_>>())]
    UnknownModel(String),
    #[error("HTTP {0}")]
    Http(#[from] Box<ureq::Error>),
    #[error("I/O: {0}")]
    Io(#[from] std::io::Error),
    #[error(
        "SHA-256 no coincide para {filename}: esperado {expected}, calculado {got}. \
         El archivo descargado está corrupto o el servidor cambió el contenido."
    )]
    ChecksumMismatch {
        filename: String,
        expected: String,
        got: String,
    },
}

/// Progreso de la descarga: bytes ya escritos y total esperado (del `Content-Length`,
/// con fallback a `approx_bytes` del [`ModelSpec`] si el servidor no lo manda).
#[derive(Debug, Clone, Copy)]
pub struct DownloadProgress {
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
}

/// Descarga (si hace falta) y verifica un modelo. Idempotente: si el archivo ya
/// existe en disco y su SHA-256 matchea, no vuelve a bajar nada.
///
/// `on_progress` se llama repetidamente durante la descarga — es el enganche para la
/// barra de progreso "vía la app" de §06.1; en tests y en `qua doctor` (CLI) puede ser
/// un closure que no hace nada.
pub fn ensure_model(
    spec: &ModelSpec,
    models_dir: &Path,
    mut on_progress: impl FnMut(DownloadProgress),
) -> Result<PathBuf, ModelError> {
    std::fs::create_dir_all(models_dir)?;
    let dest = spec.dest_path(models_dir);

    if dest.exists() && sha256_file(&dest)? == spec.sha256 {
        return Ok(dest);
    }

    let tmp = dest.with_extension("part");
    download_with_progress(spec, &tmp, &mut on_progress)?;

    let got = sha256_file(&tmp)?;
    if got != spec.sha256 {
        let _ = std::fs::remove_file(&tmp);
        return Err(ModelError::ChecksumMismatch {
            filename: spec.filename.to_string(),
            expected: spec.sha256.to_string(),
            got,
        });
    }

    std::fs::rename(&tmp, &dest)?;
    Ok(dest)
}

fn download_with_progress(
    spec: &ModelSpec,
    tmp_dest: &Path,
    on_progress: &mut impl FnMut(DownloadProgress),
) -> Result<(), ModelError> {
    let response = ureq::get(spec.url).call().map_err(Box::new)?;
    let total_bytes = response
        .headers()
        .get("content-length")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(spec.approx_bytes);

    let mut reader = response.into_body().into_reader();
    let mut file = std::fs::File::create(tmp_dest)?;
    let mut buf = [0u8; 64 * 1024];
    let mut downloaded_bytes = 0u64;

    loop {
        let n = reader.read(&mut buf)?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n])?;
        downloaded_bytes += n as u64;
        on_progress(DownloadProgress {
            downloaded_bytes,
            total_bytes,
        });
    }
    file.flush()?;
    Ok(())
}

pub fn sha256_file(path: &Path) -> std::io::Result<String> {
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn by_id_encuentra_los_dos_modelos_conocidos() {
        assert_eq!(ModelSpec::by_id("base").unwrap().filename, "ggml-base.bin");
        assert_eq!(
            ModelSpec::by_id("large-v3-turbo-q5_0").unwrap().filename,
            "ggml-large-v3-turbo-q5_0.bin"
        );
        assert!(ModelSpec::by_id("no-existe").is_none());
    }

    #[test]
    fn sha256_file_calcula_el_hash_correcto() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("hola.txt");
        std::fs::write(&path, b"hola mundo").unwrap();
        // sha256("hola mundo")
        assert_eq!(
            sha256_file(&path).unwrap(),
            "0b894166d3336435c800bea36ff21b29eaa801a52f584c006c49289a0dcf6e2f"
        );
    }

    #[test]
    fn ensure_model_no_redescarga_si_ya_existe_y_matchea() {
        let dir = tempfile::tempdir().unwrap();
        let fake = ModelSpec {
            id: "fake",
            filename: "fake.bin",
            url: "http://127.0.0.1:0/no-existe", // si intenta bajar, esto falla la conexión
            sha256: "",
            approx_bytes: 3,
        };
        let content = b"abc";
        let expected_sha = sha256_bytes(content);
        let fake = ModelSpec {
            sha256: Box::leak(expected_sha.into_boxed_str()),
            ..fake
        };
        std::fs::write(fake.dest_path(dir.path()), content).unwrap();

        let mut calls = 0;
        let path = ensure_model(&fake, dir.path(), |_| calls += 1).expect("no debe redescargar");
        assert_eq!(std::fs::read(path).unwrap(), content);
        assert_eq!(calls, 0, "no se llamó a on_progress: no hubo descarga");
    }

    fn sha256_bytes(bytes: &[u8]) -> String {
        let mut hasher = Sha256::new();
        hasher.update(bytes);
        format!("{:x}", hasher.finalize())
    }
}
