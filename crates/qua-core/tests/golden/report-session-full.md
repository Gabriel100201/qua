# QUA — Agendi
2026-09-04 14:32 · 6m 52s · rama `main` @ `9f21ac3` (dirty) · 4 issues

| # | Categoría | Sev | Confianza | Ancla |
|---|-----------|-----|-----------|-------|
| 1 | bug  | high | 0.74 | `form[data-testid="form-turno"]` |
| 2 | ui   | low  | 0.91 | `button[data-testid="nuevo-turno"]` |
| 3 | idea | low  | 0.55 | `/agenda/mes` |
| 4 | ui   | low  | 0.40 | (sesión completa) |

---

## 01 · bug · high
**Dicho** (00:00:15) — "pará, cuando le doy a guardar tira un error y no me dice nada, se queda el modal abierto y listo"

**Ancla** `form[data-testid="form-turno"]` · confianza 0.74 · mark · deixis:accion · submit −2.8s
**Ruta** `/agenda/semana` (pestaña 42)
**Fuente** `src/components/NuevoTurnoModal.tsx:118` — `NuevoTurnoModal > Form`
**Geometría** 552×424 px @ (480, 196) · viewport 1512×857 @2x
**Clases** `flex flex-col gap-4`
**Captura** ![](assets/i02.png)

---

## 02 · ui · low
**Dicho** (00:00:05) — "che, este botón de nuevo turno es re chico, en mobile casi no lo encontrás y además tarda un montón en abrir el modal"

**Ancla** `button[data-testid="nuevo-turno"]` · confianza 0.91 · hover 2.1s · deixis:este · click −0.9s
**Ruta** `/agenda/semana` (pestaña 42)
**Fuente** `src/components/AgendaHeader.tsx:42` — `AgendaHeader > Button`
**Geometría** 88×32 px @ (1180, 96) · viewport 1512×857 @2x
**Clases** `px-3 py-1.5 text-sm rounded-md bg-zinc-900 text-zinc-50 hover:bg-zinc-800`
**Timing** click → primer render del modal: 1412 ms
**Captura** ![](assets/i01.png)

---

## 03 · idea · low
**Dicho** (00:00:27) — "otra cosa, esta pantalla del mes se siente vacía, le falta el resumen de arriba que tiene la semana"

**Ancla** `/agenda/mes` · confianza 0.55 · deixis:pantalla · nav spa −0.7s
**Ruta** `/agenda/mes` (pestaña 42)

---

## 04 · ui · low
**Dicho** (00:00:46) — "en general en toda la app los botones primarios están medio apagados, deberían tener más contraste"

**Ancla** (sesión completa) · confianza 0.40 · deixis:global
**Ruta** (sesión completa)

---
