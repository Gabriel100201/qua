# Chrome Web Store — QUA

Todo lo que pide el formulario del Developer Dashboard, listo para copiar.

- **Paquete:** `qua-0.2.0.zip` (se regenera con `pnpm --filter @qua/extension run build` y
  `cd extension/build/chrome-mv3 && zip -qr ../../../packaging/chrome-web-store/qua-<versión>.zip .`)
- **Imágenes:** `assets/` (generadas desde `src/*.html` con Chrome headless)

## Store listing

**Name:** QUA

**Summary** (en el manifest, 130/132):
Talk through what you see while testing a web app. QUA turns your voice into a QA report anchored to each element. Runs on-device.

**Category:** Developer Tools · **Language:** English (agregar Español como traducción)

**Description (English):**

```
Test a web app and say out loud what you notice: "this button does nothing", "the text gets cut off here". QUA records the session, transcribes your voice and anchors each comment to the element you were looking at or clicking.

Every issue in the report includes:
• What you said, with its timestamp
• The element: stable selector, geometry, classes and its text
• The route, console errors and network requests around that moment
• A cropped screenshot

The result is a Markdown report you can paste straight into your coding agent (Claude Code, Cursor, Codex…), Linear or Slack.

100% ON-DEVICE
Whisper large-v3-turbo runs on your GPU with WebGPU. The correlator that matches your words to elements is written in Rust and compiled to WebAssembly. Your audio never leaves the browser. No account, no server, no analytics.

HOW IT WORKS
1. Click the ring (or press Ctrl+Shift+1 from any app) and start talking.
2. Use Mark (Ctrl+Shift+2) to pin a precise moment.
3. Stop. You get a notification with "Copy report".

It understands deixis: when you say "this", "here" or "the section above", QUA looks back at what you hovered, clicked or focused right before. When it isn't sure, it anchors to the page route instead of guessing.

NOTES
• The interface and reports are in Spanish for now; English is coming next.
• The first run downloads the Whisper model (~1 GB) from Hugging Face, once.
• WebGPU strongly recommended. Without it, QUA uses a smaller model on the CPU.

Open source (MIT): https://github.com/Gabriel100201/qua
```

**Description (Español):**

```
Probás una web y vas diciendo en voz alta lo que ves: "este botón no hace nada", "acá el texto se corta". QUA graba la sesión, transcribe tu voz y ancla cada comentario al elemento que estabas mirando o clickeando.

Cada issue del reporte trae:
• Lo que dijiste, con su momento
• El elemento: selector estable, geometría, clases y su texto
• La ruta, los errores de consola y los requests de ese momento
• Una captura recortada

El resultado es un reporte en Markdown listo para pegarle a tu agente de código (Claude Code, Cursor, Codex…), a Linear o a Slack.

100 % EN TU DISPOSITIVO
Whisper large-v3-turbo corre en tu GPU con WebGPU. El correlador que une tus palabras con los elementos está escrito en Rust y compilado a WebAssembly. El audio nunca sale del navegador. Sin cuenta, sin servidor, sin analytics.

CÓMO SE USA
1. Tocá el anillo (o Ctrl+Shift+1 desde cualquier app) y empezá a hablar.
2. Con Marcar (Ctrl+Shift+2) dejás una marca en un momento preciso.
3. Detené. Te llega una notificación con "Copiar reporte".

Entiende deixis: cuando decís "este", "acá" o "la sección de arriba", QUA mira lo que tocaste, señalaste o enfocaste justo antes. Si no está seguro, ancla a la ruta en vez de inventar.

NOTAS
• La primera vez baja el modelo de Whisper (~1 GB) desde Hugging Face, una sola vez.
• Se recomienda WebGPU. Sin GPU usa un modelo más chico en la CPU.

Código abierto (MIT): https://github.com/Gabriel100201/qua
```

**Graphic assets:**
- Store icon 128×128: `extension/build/chrome-mv3/icon/128.png`
- Screenshots 1280×800, en este orden: `1-grabar.png`, `2-reporte-md.png`, `3-local.png`, `4-pastilla.png`, `5-visor.png`, `6-primera-vez.png`
- Small promo tile 440×280: `promo-small-440x280.png`
- Marquee 1400×560 (opcional): `promo-marquee-1400x560.png`

**Homepage URL:** https://github.com/Gabriel100201/qua
**Support URL:** https://github.com/Gabriel100201/qua/issues

## Privacy practices

**Single purpose:**
Record a QA session of a web page (the user's voice plus their interactions with the page) and turn it into a written report where each spoken comment is anchored to the page element it refers to.

**Permission justifications:**

| Permission | Justification |
|---|---|
| `audioCapture` | Required for the extension's offscreen document to open the microphone with getUserMedia and record the user's spoken comments during a session they start. |
| `offscreen` | The offscreen document records the microphone and runs speech recognition (Whisper on WebGPU/WASM), which can't run in the service worker. |
| `tabs` | Read the URL/title of the tab being tested for the report and capture screenshots of the visible tab (captureVisibleTab) as evidence for each issue. |
| `scripting` | Inject the content script that records clicks, hover, focus and console/network errors into the tab the user chose to record, including tabs opened before installing. |
| `webNavigation` | Detect route changes in single-page apps (onHistoryStateUpdated) so each comment is linked to the right route. |
| `storage` | Save settings (microphone, shortcuts, model) and the state of the current session. |
| `unlimitedStorage` | Store the Whisper model weights (~1 GB) in the extension's cache and keep recorded sessions in IndexedDB on the user's device. |
| `alarms` | Keep the session alive while recording: a periodic alarm prevents the service worker from being stopped in the middle of a session. |
| `downloads` | Save the report and its screenshots to the user's Downloads folder when they click Download. |
| `notifications` | Tell the user the report is ready, with a "Copy report" button. |
| `clipboardWrite` | Copy the report to the clipboard when the user clicks "Copy report". |
| Host permission `<all_urls>` | The user can test any website (including localhost during development); the content script must run on whichever page they choose to record. Nothing is recorded unless the user starts a session. |

**Remote code:** No, I am not using remote code. (Todo el JS y WASM va en el paquete; de Hugging Face solo se bajan pesos del modelo, que son datos.)

**Data usage:** no marcar ninguna categoría. QUA no recolecta ni transmite datos de usuario: todo se procesa y guarda en el dispositivo.
Marcar las tres certificaciones (no vende datos, no los usa para fines ajenos al propósito, no los usa para créditos).

**Privacy policy URL:** https://github.com/Gabriel100201/qua/blob/main/PRIVACY.md

## Distribution

- Visibility: **Public**
- Regions: todas
- Pricing: gratis

## Notas para la revisión

- Pide `<all_urls>` y micrófono: la revisión suele tardar más (de unos días a 2–3 semanas).
- En "Test instructions" (opcional) se puede poner: "Open any website, click the extension icon, press the ring to record, talk, then press Stop. The first run downloads the Whisper model (~1 GB)."
