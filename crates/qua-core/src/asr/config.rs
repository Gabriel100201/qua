//! Umbrales del pipeline de audio y ASR (§06.1, §13).
//!
//! Los valores por defecto son los de `docs/SPEC.md` §13 (`~/.qua/config.toml`, tabla
//! `[asr]`). Nunca se hardcodean en el pipeline: todo lo que toca este módulo lee de
//! [`AsrConfig`], que a su vez puede poblarse desde el `config.toml` real del usuario.
//! Los campos que la spec no expone en el `[asr]` de ejemplo (ventana del jitter buffer,
//! padding del VAD, corte forzado, tamaño de la cola) son igual de ajustables: viven en
//! la misma tabla con `serde(default)`, así que un usuario que los necesite tunear no
//! tiene que recompilar, y uno que no los toca ni se entera de que existen.

use std::path::Path;

use serde::Deserialize;

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(default)]
pub struct AsrConfig {
    /// Id corto del modelo whisper. Ver [`crate::asr::model::ModelSpec::by_id`].
    pub model: String,
    /// Código ISO 639-1. La DECISIÓN de §06.1 lo fija en `"es"`.
    pub language: String,
    /// Workers de whisper en paralelo. Un solo `WhisperContext` no es thread-safe
    /// para inferencia paralela, así que esto controla cuántos contextos independientes
    /// se instancian, no hilos compartiendo uno.
    pub workers: usize,
    /// Umbral de probabilidad de habla del VAD silero, 0..1.
    pub vad_threshold: f32,
    /// Silencio continuo para cerrar un segmento.
    pub min_silence_ms: u32,
    /// Habla continua mínima para abrir un segmento (evita clics y ruido corto).
    pub min_speech_ms: u32,
    /// Padding agregado a cada lado del segmento detectado.
    pub vad_padding_ms: u32,
    /// Duración máxima de un segmento antes del corte forzado de §06.1.
    pub forced_cutoff_ms: u32,
    /// Ventana de reordenamiento del jitter buffer (§06.1).
    pub jitter_window_ms: u32,
    /// Capacidad del ring buffer de audio, en segundos.
    pub ring_seconds: u32,
    /// Tamaño máximo de la cola entre el VAD y el worker de whisper.
    pub queue_cap: usize,
    /// Parámetros exactos del bloque DECISIÓN de §06.1.
    pub temperature: f32,
    pub no_speech_thold: f32,
    pub token_timestamps: bool,
    pub suppress_blank: bool,
}

impl Default for AsrConfig {
    fn default() -> Self {
        Self {
            model: "large-v3-turbo-q5_0".to_string(),
            language: "es".to_string(),
            workers: 1,
            vad_threshold: 0.5,
            min_silence_ms: 600,
            min_speech_ms: 250,
            vad_padding_ms: 300,
            forced_cutoff_ms: 25_000,
            jitter_window_ms: 200,
            ring_seconds: 60,
            queue_cap: 8,
            temperature: 0.0,
            no_speech_thold: 0.6,
            token_timestamps: true,
            suppress_blank: true,
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("no se pudo leer {path}: {source}")]
    Read {
        path: String,
        #[source]
        source: std::io::Error,
    },
    #[error("TOML inválido en {path}: {source}")]
    Parse {
        path: String,
        #[source]
        source: toml::de::Error,
    },
}

#[derive(Debug, Default, Deserialize)]
struct ConfigFile {
    #[serde(default)]
    asr: AsrConfig,
}

impl AsrConfig {
    /// Lee `[asr]` de un `config.toml`. Si el archivo no existe, devuelve los
    /// defaults de §13 sin error: un daemon recién instalado no tiene por qué
    /// tener `~/.qua/config.toml` todavía.
    pub fn load(path: &Path) -> Result<Self, ConfigError> {
        let text = match std::fs::read_to_string(path) {
            Ok(text) => text,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Self::default());
            }
            Err(source) => {
                return Err(ConfigError::Read {
                    path: path.display().to_string(),
                    source,
                })
            }
        };
        Self::from_toml_str(&text).map_err(|source| ConfigError::Parse {
            path: path.display().to_string(),
            source,
        })
    }

    pub fn from_toml_str(text: &str) -> Result<Self, toml::de::Error> {
        let file: ConfigFile = toml::from_str(text)?;
        Ok(file.asr)
    }

    /// `~/.qua/config.toml`, resuelto contra `$HOME`.
    pub fn default_path() -> std::path::PathBuf {
        crate::asr::qua_home().join("config.toml")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sin_archivo_usa_los_defaults_de_la_spec() {
        let cfg = AsrConfig::load(Path::new("/no/existe/config.toml")).expect("defaults");
        assert_eq!(cfg, AsrConfig::default());
        assert_eq!(cfg.language, "es");
        assert_eq!(cfg.no_speech_thold, 0.6);
    }

    #[test]
    fn lee_overrides_parciales_y_completa_el_resto_con_defaults() {
        let cfg = AsrConfig::from_toml_str(
            r#"
            [asr]
            model = "base"
            vad_threshold = 0.7
            "#,
        )
        .expect("parse");
        assert_eq!(cfg.model, "base");
        assert_eq!(cfg.vad_threshold, 0.7);
        // el resto sigue en default pese al override parcial
        assert_eq!(cfg.min_silence_ms, 600);
        assert_eq!(cfg.language, "es");
    }
}
