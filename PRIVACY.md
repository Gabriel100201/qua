# QUA — Privacy Policy

*Last updated: October 15, 2026* · [Español abajo](#política-de-privacidad)

QUA is a Chrome extension that records a QA session (your voice and your interactions with a
web page) and turns it into a report. It is built to work entirely on your device.

## What QUA handles

Only while you are recording a session, QUA captures:

- **Microphone audio**, to transcribe what you say.
- **Page activity in the tab you are testing**: clicks, hover, focus, route changes, element
  selectors and geometry, console errors, network request metadata and screenshots of the
  visible tab.

Elements marked with `data-private` are left out of the trace.

## Where it goes

Nowhere. Audio, transcripts, traces, screenshots and reports are processed and stored **locally**
in your browser (IndexedDB) and, if you choose to download a report, in your Downloads folder.
Speech recognition (Whisper) runs on your own GPU or CPU.

QUA does **not** send any of this data to the developer or to any third party. There is no
account, no server, no analytics and no telemetry.

## Network access

The only network request QUA makes is downloading the open-source Whisper model weights from
Hugging Face (`huggingface.co`) the first time you use it. They are cached by the browser. No
user data is included in that request.

## Retention and deletion

Sessions stay on your device until you delete them from QUA's settings or uninstall the
extension. Downloaded reports are regular files that you control.

## Contact

Gabriel Funes — gabrielfunes100202@gmail.com · [github.com/Gabriel100201/qua](https://github.com/Gabriel100201/qua)

---

# Política de privacidad

*Última actualización: 15 de octubre de 2026*

QUA es una extensión de Chrome que graba una sesión de QA (tu voz y lo que hacés en una página)
y la convierte en un reporte. Está hecha para funcionar entera en tu dispositivo.

**Qué captura, solo mientras grabás:** audio del micrófono para transcribirlo, y la actividad de
la pestaña que estás probando (clicks, hover, foco, cambios de ruta, selectores y geometría de
los elementos, errores de consola, metadatos de requests y capturas de la pestaña visible). Los
elementos marcados con `data-private` no se registran.

**Adónde va:** a ningún lado. Todo se procesa y se guarda **localmente** en tu navegador
(IndexedDB) y, si descargás un reporte, en tu carpeta de Descargas. El reconocimiento de voz
(Whisper) corre en tu GPU o CPU. QUA no envía estos datos al desarrollador ni a terceros: no hay
cuenta, servidor, analytics ni telemetría.

**Conexiones:** la única es bajar los pesos del modelo Whisper desde Hugging Face la primera
vez. Esa descarga no incluye datos tuyos.

**Borrado:** las sesiones quedan en tu dispositivo hasta que las borres desde los ajustes de QUA
o desinstales la extensión.

**Contacto:** Gabriel Funes — gabrielfunes100202@gmail.com
