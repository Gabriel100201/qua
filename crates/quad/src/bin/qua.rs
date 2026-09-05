//! `qua` — CLI de §6.2. B1 implementa `recover` (el criterio de aceptación de la
//! tarea) y un `doctor` mínimo que solo verifica que el daemon responda. El resto de
//! los subcomandos (`sessions`, `show`, `reprocess`, `refine`, `export`) dependen de
//! ASR (B2), el correlador (B3) o el renderer (B4) y quedan como stubs explícitos —
//! ver D-B1-05 en `docs/DECISIONS.md`.

use std::path::{Path, PathBuf};

use clap::{Parser, Subcommand};

#[derive(Parser, Debug)]
#[command(name = "qua", about = "CLI de QUA (§6.2).")]
struct Cli {
    /// Override de `~/.qua/` — lo usan los tests para no tocar el directorio real.
    #[arg(long, env = "QUA_HOME", global = true)]
    data_dir: Option<PathBuf>,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand, Debug)]
enum Command {
    /// Reconstruye una sesión desde `raw/` (§04 Resiliencia). Es el criterio de
    /// aceptación de B1: `kill -9` a mitad de sesión, después `qua recover <id>`.
    Recover {
        id: String,
    },
    /// Chequeo mínimo: `GET /health`. El resto de §6.2 (modelo, mic, pairing) depende
    /// de B2/A3/C1 y todavía no existe para chequear acá.
    Doctor {
        #[arg(long, default_value_t = qua_protocol::DEFAULT_DAEMON_PORT)]
        port: u16,
    },
    Sessions,
    Show {
        id: String,
    },
    Reprocess {
        id: String,
    },
    Refine {
        id: String,
    },
    Export {
        id: String,
    },
}

fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    let data_dir = cli.data_dir.unwrap_or_else(quad::config::qua_home);

    match cli.command {
        Command::Recover { id } => cmd_recover(&id, &data_dir),
        Command::Doctor { port } => cmd_doctor(port),
        Command::Sessions
        | Command::Show { .. }
        | Command::Reprocess { .. }
        | Command::Refine { .. }
        | Command::Export { .. } => {
            println!(
                "`qua {:?}` todavía no está implementado: depende del correlador (B3) o el renderer (B4).",
                cli.command
            );
            Ok(())
        }
    }
}

fn cmd_recover(id: &str, data_dir: &Path) -> anyhow::Result<()> {
    let dir = data_dir.join("sessions").join(id);
    if !dir.exists() {
        anyhow::bail!("no existe la sesión {id} en {}", dir.display());
    }

    let meta = qua_core::read_meta(&dir).map_err(|e| {
        anyhow::anyhow!("{e} — no hay nada recuperable más allá del directorio vacío")
    })?;
    let config = quad::config::Config::load(&data_dir.join("config.toml"))?;
    let project = config.match_project(&meta.base_url);

    let session = qua_core::recover_session(&dir, &meta, project)?;
    std::fs::write(
        dir.join("session.json"),
        serde_json::to_vec_pretty(&session)?,
    )?;

    let conn = qua_core::store::open(data_dir)?;
    qua_core::store::upsert_session(&conn, &session, &dir.to_string_lossy())?;

    println!(
        "Sesión {} reconstruida: {} eventos, status={:?} — {}",
        session.id,
        session.events.len(),
        session.status,
        dir.join("session.json").display()
    );
    Ok(())
}

fn cmd_doctor(port: u16) -> anyhow::Result<()> {
    use std::io::{Read, Write};
    use std::net::TcpStream;

    let mut stream = TcpStream::connect(("127.0.0.1", port)).map_err(|e| {
        anyhow::anyhow!("no se pudo conectar a 127.0.0.1:{port}: {e} (¿está corriendo `quad`?)")
    })?;
    stream.write_all(b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")?;
    let mut buf = String::new();
    stream.read_to_string(&mut buf)?;
    let body = buf.split("\r\n\r\n").nth(1).unwrap_or("").trim();
    println!("quad respondió en el puerto {port}: {body}");
    println!("(chequeo de modelo, mic y pairing pendiente de B2/A3/C1)");
    Ok(())
}
