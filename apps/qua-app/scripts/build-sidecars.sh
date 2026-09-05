#!/usr/bin/env bash
# Compila `quad` y `qua` en release y los copia a src-tauri/binaries/ con el sufijo de
# target-triple que espera tauri-plugin-shell para un sidecar (§09). Correr antes de
# `pnpm tauri dev` / `pnpm tauri build` — no están commiteados (son binarios de ~25 MB
# cada uno, se regeneran del mismo código fuente que ya está en el repo).
set -euo pipefail

cd "$(dirname "$0")/../../.."  # raíz del monorepo

CARGO="${CARGO:-$HOME/.cargo/bin/cargo}"
RUSTC="${RUSTC:-$HOME/.cargo/bin/rustc}"
# `rustup` se instaló con --no-modify-path, así que ni `cargo` ni `rustc` están en el PATH
# de una shell nueva. Se invocan por ruta absoluta a propósito: la versión anterior de este
# script hacía `rustc -vV` a secas y, con `set -e`, moría en silencio antes de llegar a su
# propio fallback.
command -v "$CARGO" >/dev/null || { echo "no encuentro cargo en $CARGO" >&2; exit 1; }
TRIPLE="$("$RUSTC" -vV | awk '/^host:/{print $2}')"
[ -n "$TRIPLE" ] || { echo "no pude resolver el target triple" >&2; exit 1; }

echo "==> Compilando quad y qua (release, target $TRIPLE)"
"$CARGO" build --release -p quad --bin quad
"$CARGO" build --release -p quad --bin qua

DEST="apps/qua-app/src-tauri/binaries"
mkdir -p "$DEST"
cp "target/release/quad" "$DEST/quad-$TRIPLE"
cp "target/release/qua" "$DEST/qua-$TRIPLE"
chmod +x "$DEST"/*"-$TRIPLE"

echo "==> Listo: $DEST/{quad,qua}-$TRIPLE"
