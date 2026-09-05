#!/bin/bash
# G1 (§14, §09): empaqueta el daemon (`quad`) y el CLI (`qua`) en un .dmg de macOS.
#
# La spec (§09) ata el .dmg a la app Tauri (C1: tray, sidecar, onboarding, firma y
# notarización) — C1 ya cerró (`apps/qua-app`, ver STATE.md), pero firmar/notarizar
# necesitaría un Developer ID de Apple que este entorno no tiene. Este script sigue
# empaquetando lo que SÍ se puede distribuir sin eso: los dos binarios de línea de
# comandos, sin la app de bandeja. Es un .dmg real, instalable, sin firmar —
# Gatekeeper va a pedir "clic derecho > Abrir" la primera vez (documentado en
# README.md). El equivalente con la app real es `pnpm tauri build --bundles app,dmg`
# desde `apps/qua-app` (ver su README) — este script queda para quien solo quiera los
# binarios de CLI.
#
# Uso: packaging/macos/build-dmg.sh [--release-dir <target/release>]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CARGO_BIN="$HOME/.cargo/bin/cargo"

VERSION="$(grep -m1 '^version' "$REPO_ROOT/Cargo.toml" | sed -E 's/version *= *"(.*)"/\1/')"
DMG_NAME="qua-cli-macos-${VERSION}"
STAGING_DIR="$REPO_ROOT/target/dmg-staging"
OUT_DIR="$REPO_ROOT/target/dist"

echo "==> Compilando quad + qua en release (esto tarda ~1 min)"
"$CARGO_BIN" build --release -p quad --manifest-path "$REPO_ROOT/Cargo.toml"

QUAD_BIN="$REPO_ROOT/target/release/quad"
QUA_BIN="$REPO_ROOT/target/release/qua"
[ -x "$QUAD_BIN" ] || { echo "falta $QUAD_BIN"; exit 1; }
[ -x "$QUA_BIN" ] || { echo "falta $QUA_BIN"; exit 1; }

echo "==> Armando el volumen del .dmg"
rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR"
cp "$QUAD_BIN" "$STAGING_DIR/quad"
cp "$QUA_BIN" "$STAGING_DIR/qua"
cp "$SCRIPT_DIR/install.sh" "$STAGING_DIR/install.sh"
chmod +x "$STAGING_DIR/install.sh"
cp "$REPO_ROOT/packaging/macos/README-DMG.md" "$STAGING_DIR/README.md"

mkdir -p "$OUT_DIR"
DMG_PATH="$OUT_DIR/${DMG_NAME}.dmg"
rm -f "$DMG_PATH"

echo "==> Corriendo hdiutil"
hdiutil create -volname "QUA CLI ${VERSION}" -srcfolder "$STAGING_DIR" -ov -format UDZO "$DMG_PATH"

echo "==> Listo: $DMG_PATH"
echo "    Sin firmar (no hay Developer ID de Apple en este entorno) — ver README-DMG.md."
