//! Implementación de los subcomandos de `qua` (§6.2). `src/bin/qua.rs` solo parsea
//! `clap` y llama para acá — así los tests de integración (`tests/reprocess_idempotent.rs`)
//! ejercen exactamente el mismo código sin invocar el binario por `std::process::Command`.

use std::path::{Path, PathBuf};

use qua_protocol::Session;

use crate::config::Config;

#[derive(Debug, Clone, Copy, PartialEq, Eq, clap::ValueEnum, Default)]
pub enum ShowFormat {
    /// `report.md`, legible por humano y por agente (§8.2). Default.
    #[default]
    Md,
    /// `session.json` completo.
    Json,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, clap::ValueEnum, Default)]
pub enum ExportFormat {
    #[default]
    Md,
    Json,
}

fn session_dir(data_dir: &Path, id: &str) -> PathBuf {
    data_dir.join("sessions").join(id)
}

fn load_session_json(dir: &Path) -> anyhow::Result<Session> {
    let path = dir.join("session.json");
    let raw = std::fs::read_to_string(&path)
        .map_err(|e| anyhow::anyhow!("no pude leer {}: {e}", path.display()))?;
    Ok(serde_json::from_str(&raw)?)
}

/// `qua recover <id>` (§04 Resiliencia, criterio de aceptación de B1): reconstruye
/// `session.json` desde `raw/` cuando el proceso normal no llegó a escribirlo.
pub fn recover(id: &str, data_dir: &Path) -> anyhow::Result<String> {
    let dir = session_dir(data_dir, id);
    if !dir.exists() {
        anyhow::bail!("no existe la sesión {id} en {}", dir.display());
    }

    let meta = qua_core::read_meta(&dir).map_err(|e| {
        anyhow::anyhow!("{e} — no hay nada recuperable más allá del directorio vacío")
    })?;
    let config = Config::load(&data_dir.join("config.toml"))?;
    let project = config.match_project(&meta.base_url);

    let session = qua_core::recover_session(&dir, &meta, project)?;
    std::fs::write(
        dir.join("session.json"),
        serde_json::to_vec_pretty(&session)?,
    )?;

    let conn = qua_core::store::open(data_dir)?;
    qua_core::store::upsert_session(&conn, &session, &dir.to_string_lossy())?;

    Ok(format!(
        "Sesión {} reconstruida: {} eventos, status={:?} — {}",
        session.id,
        session.events.len(),
        session.status,
        dir.join("session.json").display()
    ))
}

/// `qua doctor` (§6.2): hoy solo el `GET /health` que puede chequear B1. Modelo, mic y
/// pairing dependen de B2/A3/C1 (ver D-B1-05 en `docs/DECISIONS.md`).
pub fn doctor(port: u16) -> anyhow::Result<String> {
    use std::io::{Read, Write};
    use std::net::TcpStream;

    let mut stream = TcpStream::connect(("127.0.0.1", port)).map_err(|e| {
        anyhow::anyhow!("no se pudo conectar a 127.0.0.1:{port}: {e} (¿está corriendo `quad`?)")
    })?;
    stream.write_all(b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")?;
    let mut buf = String::new();
    stream.read_to_string(&mut buf)?;
    let body = buf.split("\r\n\r\n").nth(1).unwrap_or("").trim();
    Ok(format!(
        "quad respondió en el puerto {port}: {body}\n(chequeo de modelo, mic y pairing pendiente de B2/A3/C1)"
    ))
}

/// `qua sessions [--project X] [--limit N]` (§6.2).
pub fn sessions(
    data_dir: &Path,
    project: Option<&str>,
    limit: Option<i64>,
) -> anyhow::Result<String> {
    let conn = qua_core::store::open(data_dir)?;
    let rows = qua_core::store::list_sessions(&conn, project, limit)?;
    if rows.is_empty() {
        return Ok("no hay sesiones registradas.".to_string());
    }

    let mut out = String::new();
    out.push_str(
        "id                                  status      proyecto        issues  iniciada\n",
    );
    for row in rows {
        out.push_str(&format!(
            "{:<36}{:<12}{:<16}{:<8}{}\n",
            row.id, row.status, row.project, row.issue_count, row.started_at
        ));
    }
    Ok(out.trim_end().to_string())
}

/// `qua show <id> [--json|--md]` (§6.2). Default `--md`: imprime `report.md` — "legible
/// por humano y por agente" (§8.2).
pub fn show(data_dir: &Path, id: &str, format: ShowFormat) -> anyhow::Result<String> {
    let dir = session_dir(data_dir, id);
    match format {
        ShowFormat::Md => {
            let path = dir.join("report.md");
            std::fs::read_to_string(&path).map_err(|e| {
                anyhow::anyhow!(
                    "no pude leer {}: {e} (¿corriste `qua reprocess {id}`?)",
                    path.display()
                )
            })
        }
        ShowFormat::Json => {
            let session = load_session_json(&dir)?;
            Ok(serde_json::to_string_pretty(&session)?)
        }
    }
}

/// `qua export <id> --format md|json` (§6.2): igual que `show`, pero pensado para
/// redirigir a un archivo (`qua export i --format json > out.json`) más que para leer
/// en la terminal — por ahora el contenido es el mismo que `show`.
pub fn export(data_dir: &Path, id: &str, format: ExportFormat) -> anyhow::Result<String> {
    let show_format = match format {
        ExportFormat::Md => ShowFormat::Md,
        ExportFormat::Json => ShowFormat::Json,
    };
    if show_format == ShowFormat::Json {
        // `export --format json` es `issues.json` (lo que consume un agente), no el
        // `session.json` completo que devuelve `show --json` — D-B4-08.
        let dir = session_dir(data_dir, id);
        let path = dir.join("issues.json");
        return std::fs::read_to_string(&path)
            .map_err(|e| anyhow::anyhow!("no pude leer {}: {e}", path.display()));
    }
    show(data_dir, id, show_format)
}

/// `qua reprocess <id>` (§6.2): re-corre el pipeline de render sobre una sesión ya
/// grabada, sin volver a grabar audio ni eventos. Tiene que ser idempotente: es la
/// función que le permite a alguien tunear `[correlator]` en `config.toml` y volver a
/// correr sobre sesiones viejas hasta que el anclaje salga bien.
///
/// **Alcance real de B4** (ver D-B4-09 en `docs/DECISIONS.md`): sin una implementación
/// real de `AsrPipeline`/`Correlator` todavía mergeada (B2/B3 en curso), `reprocess` no
/// puede re-transcribir audio ni re-correr el correlador de verdad — reescribe
/// `session.json` tal cual (deterministamente) y vuelve a correr el renderer de B4
/// sobre `utterances`/`issues` como estén. En cuanto B2/B3 aterricen, este es el único
/// lugar que hay que tocar para que `reprocess` recalcule de punta a punta: la interfaz
/// de CLI y la garantía de idempotencia no cambian.
pub fn reprocess(data_dir: &Path, id: &str) -> anyhow::Result<String> {
    let dir = session_dir(data_dir, id);
    if !dir.exists() {
        anyhow::bail!("no existe la sesión {id} en {}", dir.display());
    }

    let session = if dir.join("session.json").exists() {
        load_session_json(&dir)?
    } else {
        let meta = qua_core::read_meta(&dir)?;
        let config = Config::load(&data_dir.join("config.toml"))?;
        let project = config.match_project(&meta.base_url);
        qua_core::recover_session(&dir, &meta, project)?
    };

    std::fs::write(
        dir.join("session.json"),
        serde_json::to_vec_pretty(&session)?,
    )?;

    let output = qua_core::render::render_session(&session, &dir)?;

    let conn = qua_core::store::open(data_dir)?;
    qua_core::store::upsert_session(&conn, &session, &dir.to_string_lossy())?;
    qua_core::store::upsert_issues(&conn, &session.id, &session.issues)?;

    Ok(format!(
        "Sesión {} reprocesada: {} issues — {}",
        session.id,
        session.issues.len(),
        output.report_path.display()
    ))
}

/// `qua refine <id>` (§8.3): "manda `issues.json` a un LLM y reescribe cada issue como
/// título + cuerpo de ticket, agrupando duplicados", a `report.refined.md` sin pisar el
/// original.
///
/// **Sin integración LLM real** (fuera del alcance de B4 — no hay credenciales ni
/// cliente de ningún proveedor en este repo, ver D-B4-10): esto arma una versión
/// determinística de "título + cuerpo" por issue, sin agrupar duplicados, para que el
/// comando exista y el archivo tenga la forma correcta en cuanto alguien cablee el
/// LLM de verdad.
pub fn refine(data_dir: &Path, id: &str) -> anyhow::Result<String> {
    let dir = session_dir(data_dir, id);
    let session = load_session_json(&dir)?;

    let mut out = String::new();
    out.push_str(&format!("# QUA — {} (refinado)\n\n", session.project.label));
    if session.issues.is_empty() {
        out.push_str("_sin issues que refinar._\n");
    }
    for issue in &session.issues {
        let title: String = issue.text.chars().take(72).collect();
        out.push_str(&format!("## {title}\n\n{}\n\n", issue.text));
    }

    let path = dir.join("report.refined.md");
    std::fs::write(&path, &out)?;
    Ok(format!(
        "{} (placeholder sin LLM real — ver D-B4-10 en docs/DECISIONS.md)",
        path.display()
    ))
}
