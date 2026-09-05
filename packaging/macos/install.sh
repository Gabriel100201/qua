#!/bin/bash
# Instala quad + qua en ~/.local/bin. Corré esto desde el volumen montado del .dmg
# (o desde donde hayas copiado quad/qua/install.sh juntos).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="$HOME/.local/bin"
mkdir -p "$DEST"

cp "$SCRIPT_DIR/quad" "$DEST/quad"
cp "$SCRIPT_DIR/qua" "$DEST/qua"
chmod +x "$DEST/quad" "$DEST/qua"

echo "Instalado en $DEST"
if ! echo "$PATH" | tr ':' '\n' | grep -qx "$DEST"; then
  echo
  echo "$DEST no está en tu PATH. Agregá esto a tu ~/.zshrc o ~/.bashrc:"
  echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
fi
