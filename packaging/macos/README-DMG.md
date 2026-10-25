# QUA CLI — instalación (macOS)

Este documento corresponde al instalador alternativo de **sólo CLI**. Para el producto
completo usá `packaging/macos/build-dmg-app.sh`: incluye QUA.app, daemon, CLI y la
extensión compilada, y no requiere terminal para usarlo.

## 1. Instalar

Arrastrá este volumen a donde quieras, o corré directamente:

```
./install.sh
```

Copia `quad` y `qua` a `~/.local/bin` (te avisa si hace falta agregarlo al `PATH`).

## 2. Gatekeeper (el binario no está firmado)

Este build no está firmado con un Developer ID de Apple — el entorno que lo generó
no tiene uno. macOS va a bloquear la primera corrida con "no se puede verificar el
desarrollador". Para un binario de línea de comandos (no una app de Finder), la
forma de destrabarlo es:

```
xattr -d com.apple.quarantine ~/.local/bin/quad
xattr -d com.apple.quarantine ~/.local/bin/qua
```

(Alternativa: System Settings → Privacy & Security → "Allow Anyway" después del
primer intento fallido.)

## 3. Arrancar el daemon

```
quad
```

Corre en primer plano, escuchando en `127.0.0.1:7331` por default. `Ctrl-C` para
pararlo. Los datos quedan en `~/.qua/` (sesiones, modelo de whisper, config).

## 4. Emparejar la extensión de Chrome

Cargá la extensión sin empaquetar (`chrome://extensions` → Modo desarrollador →
"Cargar descomprimida" → `extension/.output/chrome-mv3` del repo) y abrí las
opciones de la extensión: ahí te da un código de 6 dígitos. `quad` tiene que estar
corriendo para que el pairing funcione.

## 5. Grabar y ver una sesión

Con el daemon corriendo y la extensión emparejada, abrí el popup de la extensión y
apretá "Grabar". Cuando termines:

```
qua sessions              # lista las sesiones grabadas
qua show <id>             # report.md de una sesión
qua show <id> --format json   # session.json completo
qua export <id>           # issues.json a stdout
qua reprocess <id>        # re-corre ASR+correlador+render (tunear config.toml)
```

`~/.qua/config.toml` tiene los umbrales del correlador (`[correlator]`) y del ASR
(`[asr]`) — `qua reprocess` los vuelve a aplicar sin regrabar.

## Qué falta

- **App de bandeja** (menú, hotkey global, medidor de mic en vivo, onboarding): es
  C1 en `docs/STATE.md`, no cerró. Sin eso, arrancar/parar el daemon y emparejar
  son pasos manuales.
- **Firma y notarización**: necesitan un Developer ID de Apple, que este entorno no
  tiene. Ver la sección de Gatekeeper arriba.
- **Windows/Linux**: si `packaging/` tiene equivalentes para esas plataformas, van
  a estar documentados en el README principal del repo.
