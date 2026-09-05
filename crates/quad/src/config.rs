//! `~/.qua/config.toml` (§13). Solo la parte que necesita B1: puerto, umbrales de
//! ingesta, extensiones pareadas y la lista de proyectos para atribuir sesiones.
//!
//! `[asr]` y `[correlator]` de la spec no viven acá — son de B2 y B3 sobre sus propios
//! umbrales. Agregarlos antes de que existan esos módulos sería adivinar su forma.

use std::path::{Path, PathBuf};

use qua_protocol::ProjectRef;
use serde::{Deserialize, Serialize};

/// Directorio de datos de QUA. `QUA_HOME` lo overridea (lo usan los tests para no
/// pisar `~/.qua/` de verdad); si no, `$HOME/.qua`.
pub fn qua_home() -> PathBuf {
    if let Ok(dir) = std::env::var("QUA_HOME") {
        return PathBuf::from(dir);
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".qua")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct DaemonConfig {
    pub port: u16,
    pub retention_days: u32,
    /// No está en la spec como umbral de `[daemon]`, pero es exactamente eso: el
    /// período de fsync de §04 (2 s). Configurable por la misma regla de "nunca
    /// hardcodeado" — y porque los tests de ingesta lo necesitan más chico.
    pub fsync_interval_ms: u64,
    /// Token de `POST /control` (ver `docs/DECISIONS.md` D-P1-01). Vacío hasta el
    /// primer arranque de [`crate::server::prepare`], que lo genera y persiste — no
    /// tiene un default útil porque es secreto por construcción, a diferencia de
    /// `port`/`retention_days`.
    #[serde(default)]
    pub control_token: String,
}

impl Default for DaemonConfig {
    fn default() -> Self {
        Self {
            port: qua_protocol::DEFAULT_DAEMON_PORT,
            retention_days: 90,
            fsync_interval_ms: 2000,
            control_token: String::new(),
        }
    }
}

/// Una extensión pareada (§04): el `Origin` que validó el código de 6 dígitos y el
/// token de 32 bytes que se le entregó.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PairedExtension {
    pub origin: String,
    pub token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProjectConfig {
    pub label: String,
    #[serde(default)]
    pub origins: Vec<String>,
    #[serde(default)]
    pub repo: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct Config {
    pub daemon: DaemonConfig,
    pub paired_extensions: Vec<PairedExtension>,
    #[serde(rename = "projects")]
    pub projects: Vec<ProjectConfig>,
}

impl Config {
    /// Carga `path`, o devuelve la config por defecto si el archivo todavía no existe
    /// (primer arranque).
    pub fn load(path: &Path) -> anyhow::Result<Config> {
        if !path.exists() {
            return Ok(Config::default());
        }
        let raw = std::fs::read_to_string(path)?;
        Ok(toml::from_str(&raw)?)
    }

    /// Escritura atómica: tmp + rename, para que un `kill -9` a mitad de un `qua pair`
    /// no deje `config.toml` truncado.
    pub fn save(&self, path: &Path) -> anyhow::Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let raw = toml::to_string_pretty(self)?;
        let tmp = path.with_extension("toml.tmp");
        std::fs::write(&tmp, raw)?;
        std::fs::rename(&tmp, path)?;
        Ok(())
    }

    /// Token + Origin contra la allowlist (§04). Las dos cosas tienen que matchear la
    /// misma entrada — un token robado desde otro origin no alcanza.
    pub fn is_allowed(&self, origin: &str, token: &str) -> bool {
        self.paired_extensions
            .iter()
            .any(|p| p.origin == origin && p.token == token)
    }

    pub fn add_paired_extension(&mut self, origin: String, token: String) {
        self.paired_extensions.retain(|p| p.origin != origin);
        self.paired_extensions
            .push(PairedExtension { origin, token });
    }

    /// Resuelve `base_url` contra `[[projects]].origins` (prefijo). Sin match, la
    /// sesión queda atribuida a un proyecto "unknown" en vez de fallar — la
    /// atribución es un enriquecimiento, no un requisito para grabar.
    pub fn match_project(&self, base_url: &str) -> ProjectRef {
        for project in &self.projects {
            if project.origins.iter().any(|o| base_url.starts_with(o)) {
                return ProjectRef {
                    label: project.label.clone(),
                    repo: project.repo.clone(),
                };
            }
        }
        ProjectRef {
            label: "unknown".to_string(),
            repo: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_sin_archivo() {
        let dir = tempfile::tempdir().unwrap();
        let cfg = Config::load(&dir.path().join("config.toml")).unwrap();
        assert_eq!(cfg.daemon.port, qua_protocol::DEFAULT_DAEMON_PORT);
        assert!(cfg.paired_extensions.is_empty());
    }

    #[test]
    fn save_y_load_redondean() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        let mut cfg = Config::default();
        cfg.add_paired_extension("chrome-extension://abc".into(), "token123".into());
        cfg.projects.push(ProjectConfig {
            label: "Agendi".into(),
            origins: vec!["http://localhost:3000".into()],
            repo: Some("/tmp/agendi".into()),
        });
        cfg.save(&path).unwrap();

        let loaded = Config::load(&path).unwrap();
        assert!(loaded.is_allowed("chrome-extension://abc", "token123"));
        assert!(!loaded.is_allowed("chrome-extension://abc", "wrong"));
        assert_eq!(
            loaded.match_project("http://localhost:3000/agenda").label,
            "Agendi"
        );
        assert_eq!(loaded.match_project("http://otra.app").label, "unknown");
    }

    #[test]
    fn repair_de_extension_reemplaza_la_anterior() {
        let mut cfg = Config::default();
        cfg.add_paired_extension("chrome-extension://abc".into(), "old".into());
        cfg.add_paired_extension("chrome-extension://abc".into(), "new".into());
        assert_eq!(cfg.paired_extensions.len(), 1);
        assert!(cfg.is_allowed("chrome-extension://abc", "new"));
        assert!(!cfg.is_allowed("chrome-extension://abc", "old"));
    }
}
