#!/usr/bin/env bash
# Copia las capturas del popup/options (ya tomadas con claude-in-chrome) a
# docs/ejemplos/ con nombres estables. Recibe pares "origen:destino" por stdin
# o como argumentos, uno por línea, ej.: "/ruta/screenshot-0.png:popup-x.png".
#
# Regla de limpieza (U3b, docs/DECISIONS.md): nunca `rm` sobre un glob armado a
# partir de una variable. Cualquier archivo intermedio que este script genere
# vive en su propio directorio temporal, creado con mktemp, y ese directorio
# —no un glob— es lo único que el trap borra.
set -euo pipefail

SCRATCH="$(mktemp -d)"
[ -n "$SCRATCH" ] && [ -d "$SCRATCH" ] || exit 1
trap 'rm -rf "$SCRATCH"' EXIT

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEST_DIR="$REPO_ROOT/docs/ejemplos"
mkdir -p "$DEST_DIR"

if [ "$#" -gt 0 ]; then
  pairs=("$@")
else
  mapfile -t pairs
fi

for pair in "${pairs[@]}"; do
  src="${pair%%:*}"
  name="${pair##*:}"
  if [ ! -f "$src" ]; then
    echo "falta el origen: $src" >&2
    exit 1
  fi
  # Paso intermedio por SCRATCH (directorio propio, no un glob) antes del
  # destino final, para que una copia a medio hacer nunca ensucie docs/.
  cp "$src" "$SCRATCH/$name"
  cp "$SCRATCH/$name" "$DEST_DIR/$name"
  echo "listo: docs/ejemplos/$name"
done
