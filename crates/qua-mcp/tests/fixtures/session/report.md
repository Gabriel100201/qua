# QUA — Agendi

2026-09-04 14:32 · 6m 52s · rama `main` @ `9f21ac3` (dirty) · 3 issues

| # | Categoría | Sev | Confianza | Ancla |
|---|-----------|-----|-----------|-------|
| 1 | bug  | high | 0.74 | `/agenda/semana` |
| 2 | perf | med  | 0.50 | `supabase.com` |
| 3 | ui   | low  | 0.91 | `button[data-testid="nuevo-turno"]` |

---

## 01 · bug · high

**Dicho** (00:01:28) — "esto tarda un montón en guardar, se me colgó el filtro de la semana"

**Ancla** `/agenda/semana` · confianza 0.74 · net_slow +1.2s
**Timing** guardar → respuesta: 1800 ms

## 02 · perf · med

**Dicho** (00:02:30) — "la tabla de turnos de supabase tarda en cargar cuando hay muchas filas"

**Ancla** `https://supabase.com/dashboard/project/agendi/editor` · confianza 0.50 · sin click previo
**Exportado** https://linear.app/agendi/issue/AG-40

## 03 · ui · low

**Dicho** (00:00:05) — "este botón de nuevo turno es re chico, en mobile casi no lo encuentro"

**Ancla** `button[data-testid="nuevo-turno"]` · confianza 0.91 · click −0.9s · deixis:este
**Fuente** `src/components/AgendaHeader.tsx:42` — `AgendaHeader > Button`
