# Tarea: hacer QUA distribuible

> Escrito para que otro agente lo ejecute sin contexto previo.
> Leé `README.md`, `docs/SPEC.md` y `STATE.md` antes de empezar.

## El problema

QUA funciona, pero **sólo en la máquina de quien lo construyó**. Gabriel lo dijo así:

> "Quiero que sea más agnóstico, que pueda descargarlo una persona, instalarlo fácil,
> configurarlo, que le den un output listo para pegárselo a la gente."

Hoy, para usar QUA hay que: clonar el repo, tener Rust instalado, compilar el daemon,
construir la extensión con pnpm, cargarla sin empaquetar en Chrome con el modo desarrollador,
y editar un TOML a mano. Eso no es un producto, es un entorno de desarrollo.

## Estado real hoy

| | Hoy | Debería ser |
|---|---|---|
| Instalar | clonar + compilar Rust + `pnpm build` + cargar sin empaquetar | bajar un instalador y abrirlo |
| Configurar | editar `~/.qua/config.toml` a mano | la app pregunta lo mínimo, o nada |
| Sacar el reporte | `cat ~/.qua/sessions/<id>/report.md` | un botón "Copiar" |
| Compartirlo | copiar y pegar a mano | listo para pegar, o un archivo |

---

## D1 · Sacar el reporte en un click

**Es lo más urgente y lo más barato.** Hoy terminás de grabar y el reporte queda en un archivo
que tenés que ir a buscar por terminal.

- Botón **"Copiar reporte"** en el popup, visible apenas la sesión termina de procesarse.
  Copia el `report.md` completo al portapapeles.
- Un segundo botón **"Abrir carpeta"** que revela la sesión en Finder/Explorer.
- En el CLI: `qua last` que imprime el reporte de la última sesión, y `qua last --copy` que lo
  manda al portapapeles (`pbcopy` en macOS, `clip` en Windows, `xclip`/`wl-copy` en Linux).

**Criterio:** grabás, parás, apretás un botón, y el reporte está en el portapapeles listo para
pegar en Linear, Slack o un chat con un agente. Sin tocar la terminal.

---

## D2 · Desacoplar el reporte de los repositorios

**Gabriel:** *"No tiene sentido que esté asociado a proyectos si el usuario que lo va a usar
incluso a veces no tiene acceso a los repositorios."*

Tiene razón. El bloque `[[projects]]` de `config.toml` mapea un origen web a un repo local para
poder anclar al archivo fuente (`AgendaHeader.tsx:42`). Eso sirve a quien desarrolla la app.
No sirve a un QA, a un diseñador, ni a nadie que pruebe una app ajena.

**El anclaje a código ya es opcional y degrada bien** (§11: tier 4 = selector + texto + clases).
El problema no es técnico, es de presentación: hoy `[[projects]]` aparece como si fuera parte
del setup obligatorio.

Qué hacer:
- Sacar `[[projects]]` del camino crítico. QUA tiene que funcionar y dar un reporte completo
  sin que exista ese bloque.
- El reporte sin repo mapeado **no debe verse degradado ni incompleto**: selector, texto del
  elemento, rol, geometría, clases, errores de consola, timings y captura ya alcanzan para que
  alguien entienda el problema. Revisá que el renderer no muestre huecos ni "(desconocido)".
- Si alguien SÍ tiene el repo, que sea un extra que se ofrece después, no un requisito previo.
- Ver también el bug 3 de la tarea V1 (enriquecer el `TargetRef` cuando el selector cae a
  `css-path`): sin repo, ese contexto legible es lo único que tiene el lector.

**Criterio:** un `config.toml` sin ningún `[[projects]]` produce un reporte que se lee completo
y accionable. Compará lado a lado con uno que sí tiene repo y confirmá que la única diferencia
es la línea de archivo fuente.

---

## D3 · Instalador de verdad

Hoy hay un `.dmg` sin firmar que trae sólo el daemon y el CLI (`packaging/macos/`), y la app
Tauri (`apps/qua-app/`) que hay que compilar. La extensión hay que cargarla sin empaquetar.

- **macOS primero:** un `.dmg` que instale la app Tauri (que ya lleva el daemon como sidecar).
  Sin Developer ID no se puede firmar — dejá las instrucciones de Gatekeeper bien visibles en
  el instalador, no enterradas en un README.
- **La extensión:** empaquetarla como `.crx` o publicarla en la Chrome Web Store. Si eso no es
  viable ahora, al menos que el instalador deje la carpeta en un lugar fijo y la app muestre
  la ruta con un botón de copiar y las instrucciones exactas.
- **Windows y Linux** después. La arquitectura ya es portable (Rust + Tauri + extensión de
  Chrome); lo que falta es empaquetado, no diseño.

**Criterio:** una persona que nunca vio el repo puede instalar y grabar una sesión siguiendo
sólo lo que ve en pantalla.

---

## D4 · Primer uso sin fricción

El onboarding actual asume demasiado. Hoy hace falta: levantar el daemon a mano, emparejar,
conceder el micrófono, y **recargar la pestaña** (paso que no es obvio y que hizo que Gabriel
creyera que no funcionaba).

- Que la app levante el daemon sola, sin terminal.
- El emparejamiento ya es un click (`POST /pair/auto`, ver D-U1-01). Verificá que funcione
  desde una instalación limpia.
- Lo de **recargar la pestaña** ya está detectado y se muestra en la franja de diagnóstico
  (D-U2-01). Que sea imposible de pasar por alto.
- Nada de editar TOML para el caso básico.

**Criterio:** de instalar a tener un `report.md` en el portapapeles, sin abrir una terminal
ni un editor de texto en ningún momento.

---

## Orden sugerido

1. **D1** — es horas de trabajo y resuelve la queja concreta de hoy.
2. **D2** — mayormente revisión y ajustes de presentación, poco código.
3. **D4** — depende de que la app Tauri esté andando.
4. **D3** — el más largo; firmar y publicar tiene trámites fuera del código.

## Reglas del proyecto

- `pnpm test` y `~/.cargo/bin/cargo test --workspace` verdes antes de reportar nada.
- Rust por ruta absoluta: `~/.cargo/bin/cargo` (rustup se instaló con `--no-modify-path`).
- Si dos entrypoints comparten un valor, va en `extension/shared/` con un test que falle si
  divergen. Ya hubo dos bugs por esto (ver `STATE.md`): el token de emparejamiento y la
  resolución de `@qua/protocol`.
- Nunca `rm` con un glob sobre una variable en un script. `mktemp -d` + `trap rm -rf`.
- Documentá las decisiones en `docs/DECISIONS.md`.

## Trampa conocida

**Los tests que mockean el otro lado dan verde y mienten.** Tres bugs de esta clase ya
llegaron a producción: el token guardado con una clave y leído con otra, `@qua/protocol`
resuelto contra un `dist/` viejo, y el popup que nunca se entera de que la sesión arrancó
porque el background no le avisa. El E2E existente (`e2e/session.e2e.mjs`) dispara la sesión
por mensajes y **nunca abre el popup ni aprieta un botón**. Si tocás la UI, probala de verdad.
