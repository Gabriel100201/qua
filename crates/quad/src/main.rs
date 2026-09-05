//! `quad` — arranca el servidor (§06). El resto del CLI de §6.2 (`sessions`, `show`,
//! `recover`, ...) vive en el binario `qua` (`src/bin/qua.rs`).

use std::path::PathBuf;

use clap::Parser;

#[derive(Parser, Debug)]
#[command(
    name = "quad",
    about = "Daemon de QUA: servidor WS, pairing, ingesta y store (§06)."
)]
struct Args {
    /// Puerto del WS/HTTP. Default: `[daemon].port` en config.toml, o 7331.
    #[arg(long)]
    port: Option<u16>,
    /// Override de `~/.qua/` — lo usan los tests para no tocar el directorio real.
    #[arg(long, env = "QUA_HOME")]
    data_dir: Option<PathBuf>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        // Sin color: los logs del daemon van a un archivo (§09 `~/.qua/logs/`), no a
        // una terminal, y los códigos ANSI le complican la vida a cualquiera que los
        // parsee (incluido `qua doctor` o los tests).
        .with_ansi(false)
        .try_init()
        .ok();

    let args = Args::parse();
    let data_dir = args.data_dir.unwrap_or_else(quad::config::qua_home);
    quad::server::run(args.port, data_dir).await
}
