#!/usr/bin/env bash
# Compila `quad` y `qua` en release y los copia a src-tauri/binaries/ con el sufijo de
# target-triple que espera tauri-plugin-shell para un sidecar (§09). Correr antes de
# `pnpm tauri dev` / `pnpm tauri build` — no están commiteados (son binarios de ~25 MB
# cada uno, se regeneran del mismo código fuente que ya está en el repo).
set -euo pipefail

cd "$(dirname "$0")/../../.."  # raíz del monorepo

CARGO="${CARGO:-$HOME/.cargo/bin/cargo}"
TRIPLE="$("$CARGO" --version >/dev/null 2>&1 && rustc -vV 2>/dev/null | awk '/^host:/{print $2}')"
if [ -z "$TRIPLE" ]; then
  TRIPLE="$("$HOME/.cargo/bin/rustc" -vV | awk '/^host:/{print $2}')"
fi

echo "==> Compilando quad y qua (release, target $TRIPLE)"
"$CARGO" build --release -p quad --bin quad
"$CARGO" build --release -p quad --bin qua

DEST="apps/qua-app/src-tauri/binaries"
mkdir -p "$DEST"
cp "target/release/quad" "$DEST/quad-$TRIPLE"
cp "target/release/qua" "$DEST/qua-$TRIPLE"
chmod +x "$DEST"/*"-$TRIPLE"

echo "==> Listo: $DEST/{quad,qua}-$TRIPLE"
