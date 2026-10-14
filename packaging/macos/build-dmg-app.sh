#!/usr/bin/env bash
# Distribución completa: QUA.app + sidecars + extensión lista para cargar.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
export PATH="$HOME/.cargo/bin:$PATH"
# create-dmg usa Perl; `C.UTF-8` no existe en macOS y hace fallar el bundle.
export LC_ALL=C
export LANG=C

cd "$REPO_ROOT"
pnpm --filter @qua/extension run build
apps/qua-app/scripts/build-sidecars.sh
cd apps/qua-app
pnpm tauri build --bundles app,dmg

echo "Listo: $REPO_ROOT/target/release/bundle/dmg/"
echo "Build sin firmar: al abrir, usá clic derecho → Abrir; si macOS lo bloquea,"
echo "andá a Configuración del Sistema → Privacidad y seguridad → Abrir de todas formas."
