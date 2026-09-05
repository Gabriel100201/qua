//! Rutas de `~/.qua/` (§09, §13). Reusa `quad::config::qua_home` en vez de reinventar
//! el directorio de datos — es el mismo daemon al que este app le habla.

use std::path::PathBuf;

pub fn qua_home() -> PathBuf {
    quad::config::qua_home()
}

pub fn logs_dir() -> PathBuf {
    qua_home().join("logs")
}

pub fn models_dir() -> PathBuf {
    qua_home().join("models")
}

pub fn sessions_dir() -> PathBuf {
    qua_home().join("sessions")
}

pub fn config_path() -> PathBuf {
    qua_home().join("config.toml")
}

/// Puerto configurado del daemon (`[daemon].port`, default 7331). Si `config.toml`
/// todavía no existe, cae al default de `qua-protocol` sin crear nada — crear el
/// archivo es responsabilidad de `quad` al arrancar.
pub fn daemon_port() -> u16 {
    quad::config::Config::load(&config_path())
        .map(|c| c.daemon.port)
        .unwrap_or(qua_protocol::DEFAULT_DAEMON_PORT)
}

pub fn daemon_base_url() -> String {
    format!("http://127.0.0.1:{}", daemon_port())
}

/// Token de `POST /control` (§09, `docs/DECISIONS.md` D-P1-01) — el daemon lo genera
/// y lo persiste en `config.toml` en su primer arranque. Si `config.toml` todavía no
/// existe (el sidecar no arrancó ni una vez), cae a un string vacío: el daemon
/// rechaza eso igual que cualquier otro token inválido, no hace falta un caso
/// especial acá.
pub fn daemon_control_token() -> String {
    quad::config::Config::load(&config_path())
        .map(|c| c.daemon.control_token)
        .unwrap_or_default()
}
