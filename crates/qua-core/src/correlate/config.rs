//! `[correlator]` de `~/.qua/config.toml` (§13).
//!
//! **Ningún umbral de §07 está hardcodeado en la lógica.** Todos viven acá con el valor
//! de la spec como default, y se pisan desde el toml. Eso es lo que hace que `qua
//! reprocess` sirva para tunear sin recompilar (§6.2).
//!
//! §13 muestra solo 5 claves en el ejemplo (`window_back_ms`, `window_fwd_ms`,
//! `decay_ms`, `min_score`, `dominance_ratio`), pero §07 dice «todos los umbrales viven
//! en `[correlator]`». Se expone el resto de las constantes numéricas de §07 con los
//! mismos defaults: un `config.toml` que solo tenga las 5 del ejemplo se comporta igual
//! que antes. Ver `docs/DECISIONS.md`, D-B3-01.

use std::path::Path;

use serde::{Deserialize, Serialize};

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("no se pudo leer {path}: {source}")]
    Io {
        path: String,
        #[source]
        source: std::io::Error,
    },
    #[error("config.toml inválido: {0}")]
    Toml(#[from] toml::de::Error),
    #[error("[correlator] inválido: {0}")]
    Invalid(String),
}

/// Envoltorio para leer solo la sección que le importa al correlador.
#[derive(Debug, Default, Deserialize)]
struct ConfigFile {
    #[serde(default)]
    correlator: CorrelatorConfig,
}

/// Los umbrales de §07. `deny_unknown_fields` a propósito: una clave mal escrita en el
/// toml es exactamente el error que arruina una sesión de tuning sin dar señal.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, default)]
pub struct CorrelatorConfig {
    // ---- Paso 1 · agrupación ----
    /// Gap máximo entre utterances para fusionarlas.
    pub merge_gap_ms: i64,
    /// Duración combinada máxima de un grupo.
    pub max_group_ms: i64,

    // ---- Paso 2 · filtro de ruido ----
    pub max_no_speech_prob: f64,
    pub min_avg_logprob: f64,
    /// Mínimo de palabras para aceptar un grupo sin `mark`.
    pub min_words: usize,

    // ---- Paso 4 · ventana de candidatos ----
    pub window_back_ms: i64,
    pub window_fwd_ms: i64,
    /// Ventana cuando el grupo tiene `mark`: el ancla dura es más precisa.
    pub marked_window_back_ms: i64,
    pub marked_window_fwd_ms: i64,
    /// Permanencia mínima para que un `hover` sea candidato.
    pub min_hover_dwell_ms: i64,

    // ---- Paso 5 · scoring ----
    pub base_click: f64,
    pub base_hover: f64,
    pub base_focus: f64,
    pub base_scroll_top: f64,
    /// Constante de la exponencial de recency.
    pub decay_ms: f64,
    /// Multiplicador de deixis POINTER sobre hover y click.
    pub bias_pointer: f64,
    /// Multiplicador de deixis ACTION sobre el click anterior a `t_ref`.
    pub bias_action: f64,
    /// Factor cuando el target no es visible o tiene área 0.
    pub visibility_penalty: f64,
    /// Peso de los aportes secundarios al fusionar candidatos del mismo `sel`.
    ///
    /// §07 paso 5 dice «se suman los scores», que es `1.0` y es el default. Es la única
    /// perilla del correlador que puede cambiar cuál de dos elementos gana, así que vive
    /// acá y no en el código: con `0.0` el score fusionado pasa a ser el del aporte más
    /// fuerte. Ver `docs/DECISIONS.md`, D-B3-07.
    pub merge_extra_weight: f64,

    // ---- Paso 6 · decisión de ancla ----
    pub min_score: f64,
    pub dominance_ratio: f64,
    /// Divisor de `confidence = clamp(best / N, 0, 1)`.
    pub confidence_divisor: f64,
    /// Penalización de confianza cuando el ratio best/second queda corto.
    pub ambiguity_penalty: f64,
    /// Confianza de un ancla decidida por deixis SCREEN/GLOBAL, donde no hay score de
    /// candidato que medir. §07 no la define: ver `docs/DECISIONS.md`, D-B3-04.
    pub deictic_confidence: f64,

    // ---- Paso 7 · evidencia ----
    pub evidence_back_ms: i64,
    pub evidence_fwd_ms: i64,

    // ---- Paso 9 · screenshot ----
    pub screenshot_min_confidence: f64,
}

impl Default for CorrelatorConfig {
    /// Exactamente los números de §07 y del `[correlator]` de §13.
    fn default() -> Self {
        Self {
            merge_gap_ms: 1_500,
            max_group_ms: 45_000,

            max_no_speech_prob: 0.6,
            min_avg_logprob: -1.0,
            min_words: 3,

            window_back_ms: 4_500,
            window_fwd_ms: 1_500,
            marked_window_back_ms: 2_500,
            marked_window_fwd_ms: 500,
            min_hover_dwell_ms: 400,

            base_click: 3.0,
            base_hover: 2.5,
            base_focus: 1.8,
            base_scroll_top: 1.0,
            decay_ms: 2_500.0,
            bias_pointer: 1.5,
            bias_action: 2.0,
            visibility_penalty: 0.3,
            merge_extra_weight: 1.0,

            min_score: 2.0,
            dominance_ratio: 1.3,
            confidence_divisor: 6.0,
            ambiguity_penalty: 0.7,
            deictic_confidence: 0.8,

            evidence_back_ms: 6_000,
            evidence_fwd_ms: 4_000,

            screenshot_min_confidence: 0.5,
        }
    }
}

impl CorrelatorConfig {
    /// Lee el `[correlator]` de un `config.toml` completo. Las claves ausentes toman el
    /// default de §07; el resto del archivo (`[daemon]`, `[asr]`, …) se ignora.
    pub fn from_toml_str(s: &str) -> Result<Self, ConfigError> {
        let file: ConfigFile = toml::from_str(s)?;
        file.correlator.validated()
    }

    /// Igual que [`Self::from_toml_str`] pero desde disco. Un archivo inexistente **no**
    /// es error: el correlador tiene que poder correr sin `~/.qua/config.toml`.
    pub fn from_path(path: &Path) -> Result<Self, ConfigError> {
        match std::fs::read_to_string(path) {
            Ok(s) => Self::from_toml_str(&s),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(source) => Err(ConfigError::Io {
                path: path.display().to_string(),
                source,
            }),
        }
    }

    fn validated(self) -> Result<Self, ConfigError> {
        let bad = |m: &str| ConfigError::Invalid(m.to_string());
        if self.decay_ms <= 0.0 {
            return Err(bad("decay_ms tiene que ser > 0: es el denominador de recency"));
        }
        if self.confidence_divisor <= 0.0 {
            return Err(bad("confidence_divisor tiene que ser > 0"));
        }
        if self.dominance_ratio < 1.0 {
            return Err(bad(
                "dominance_ratio < 1 haría que el segundo candidato gane: no tiene sentido",
            ));
        }
        if self.window_back_ms < 0
            || self.window_fwd_ms < 0
            || self.marked_window_back_ms < 0
            || self.marked_window_fwd_ms < 0
        {
            return Err(bad("las ventanas se declaran en ms positivos"));
        }
        if !(0.0..=1.0).contains(&self.max_no_speech_prob) {
            return Err(bad("max_no_speech_prob es una probabilidad: 0..1"));
        }
        if !(0.0..=1.0).contains(&self.visibility_penalty) {
            return Err(bad("visibility_penalty es un factor: 0..1"));
        }
        if !(0.0..=1.0).contains(&self.ambiguity_penalty) {
            return Err(bad("ambiguity_penalty es un factor: 0..1"));
        }
        if !(0.0..=1.0).contains(&self.merge_extra_weight) {
            return Err(bad("merge_extra_weight es un factor: 0..1"));
        }
        Ok(self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// El `[correlator]` literal de §13 tiene que dar exactamente los defaults.
    #[test]
    fn el_ejemplo_de_la_spec_coincide_con_los_defaults() {
        let cfg = CorrelatorConfig::from_toml_str(
            r#"
            [daemon]
            port = 7331

            [correlator]
            window_back_ms = 4500
            window_fwd_ms = 1500
            decay_ms = 2500
            min_score = 2.0
            dominance_ratio = 1.3
            "#,
        )
        .expect("parsea");
        assert_eq!(cfg, CorrelatorConfig::default());
    }

    #[test]
    fn sin_seccion_correlator_usa_defaults() {
        let cfg = CorrelatorConfig::from_toml_str("[daemon]\nport = 7331\n").expect("parsea");
        assert_eq!(cfg, CorrelatorConfig::default());
    }

    #[test]
    fn pisa_solo_lo_declarado() {
        let cfg = CorrelatorConfig::from_toml_str("[correlator]\nmin_score = 3.5\n").expect("ok");
        assert_eq!(cfg.min_score, 3.5);
        assert_eq!(cfg.window_back_ms, 4_500);
    }

    /// Una clave mal escrita tiene que romper, no ignorarse en silencio.
    #[test]
    fn clave_desconocida_es_error() {
        let err = CorrelatorConfig::from_toml_str("[correlator]\nmin_scor = 3.5\n");
        assert!(err.is_err(), "un typo de umbral tiene que fallar ruidoso");
    }

    #[test]
    fn valida_rangos() {
        assert!(CorrelatorConfig::from_toml_str("[correlator]\ndecay_ms = 0\n").is_err());
        assert!(CorrelatorConfig::from_toml_str("[correlator]\ndominance_ratio = 0.5\n").is_err());
        assert!(CorrelatorConfig::from_toml_str("[correlator]\nmax_no_speech_prob = 2\n").is_err());
    }

    #[test]
    fn archivo_inexistente_da_defaults() {
        let cfg = CorrelatorConfig::from_path(Path::new("/no/existe/config.toml")).expect("ok");
        assert_eq!(cfg, CorrelatorConfig::default());
    }
}
