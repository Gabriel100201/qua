# QUA — Agendi
2026-09-04 14:32 · 6m 52s · rama `main` @ `9f21ac3` (dirty) · 4 issues

| # | Categoría | Sev | Confianza | Ancla |
|---|-----------|-----|-----------|-------|
| 1 | perf | med | 0.48 | `button[data-testid="nuevo-turno"]` |
| 2 | ui   | low | 0.80 | `/agenda/mes` |
| 3 | ui   | low | 0.80 | (sesión completa) |

---

## 01 · perf · med
**Dicho** (00:00:05) — "che, este botón de nuevo turno es re chico, en mobile casi no lo encontrás y además tarda un montón en abrir el modal"

**Ancla** `button[data-testid="nuevo-turno"]` · confianza 0.48 · click 1.1s · deixis:este · hover 2.1s
**Ruta** `/agenda/semana` (pestaña 42)
**Fuente** `src/components/AgendaHeader.tsx:42` — `AgendaHeader > Button`
**Geometría** 88×32 px @ (1180, 96) · viewport 1512×857 @2x
**Clases** `px-3 py-1.5 text-sm rounded-md bg-zinc-900 text-zinc-50 hover:bg-zinc-800`
**Timing** click → primer render: 1412 ms

---

## 02 · ui · low
**Dicho** (00:00:27) — "otra cosa, esta pantalla del mes se siente vacía, le falta el resumen de arriba que tiene la semana"

**Ancla** `/agenda/mes` · confianza 0.80 · deixis:esta pantalla
**Ruta** `/agenda/mes` (pestaña 42)

---

## 03 · ui · low
**Dicho** (00:00:46) — "en general en toda la app los botones primarios están medio apagados, deberían tener más contraste"

**Ancla** (sesión completa) · confianza 0.80 · deixis:en general
**Ruta** (sesión completa)

---

## Sin anclar

- (00:00:15) bug/high — "pará, cuando le doy a guardar tira un error y no me dice nada, se queda el modal abierto y listo" · ruta `/agenda/semana`
