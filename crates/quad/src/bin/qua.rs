//! `qua` — CLI de §6.2. Los ocho subcomandos completos: B1 dejó `recover`/`doctor`
//! (§04 Resiliencia, criterio de aceptación de B1); B4 agrega `sessions`, `show`,
//! `reprocess`, `refine` y `export` sobre `qua-core::render` y `qua-core::store`. La
//! lógica de cada uno vive en `quad::cli` — este binario solo parsea `clap` y
//! despacha, así los tests de integración pueden ejercer lo mismo sin invocar el
//! binario.

use std::path::PathBuf;

use clap::{Parser, Subcommand};
use quad::cli::{ExportFormat, ShowFormat};

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
    Recover { id: String },
    /// Chequeo mínimo: `GET /health`. El resto de §6.2 (modelo, mic, pairing) depende
    /// de B2/A3/C1 y todavía no existe para chequear acá.
    Doctor {
        #[arg(long, default_value_t = qua_protocol::DEFAULT_DAEMON_PORT)]
        port: u16,
    },
    /// Lista sesiones grabadas, más recientes primero.
    Sessions {
        #[arg(long)]
        project: Option<String>,
        #[arg(long)]
        limit: Option<i64>,
    },
    /// Muestra una sesión: `report.md` (default) o `session.json` completo.
    Show {
        id: String,
        #[arg(long, value_enum, default_value_t = ShowFormat::Md)]
        format: ShowFormat,
    },
    /// Re-corre el pipeline de render (y, cuando existan, ASR + correlador) sobre una
    /// sesión ya grabada, sin regrabar nada. Idempotente.
    Reprocess { id: String },
    /// Pase LLM opcional sobre `issues.json` (§8.3). Nunca corre solo.
    Refine { id: String },
    /// Exporta `report.md` o `issues.json` a stdout.
    Export {
        id: String,
        #[arg(long, value_enum, default_value_t = ExportFormat::Md)]
        format: ExportFormat,
    },
}

fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    let data_dir = cli.data_dir.unwrap_or_else(quad::config::qua_home);

    let output = match cli.command {
        Command::Recover { id } => quad::cli::recover(&id, &data_dir),
        Command::Doctor { port } => quad::cli::doctor(port),
        Command::Sessions { project, limit } => {
            quad::cli::sessions(&data_dir, project.as_deref(), limit)
        }
        Command::Show { id, format } => quad::cli::show(&data_dir, &id, format),
        Command::Reprocess { id } => quad::cli::reprocess(&data_dir, &id),
        Command::Refine { id } => quad::cli::refine(&data_dir, &id),
        Command::Export { id, format } => quad::cli::export(&data_dir, &id, format),
    }?;

    println!("{output}");
    Ok(())
}
