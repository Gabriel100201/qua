/**
 * Reloj del offscreen doc. Mismo origen que `content/lib/clock.ts` (§02:
 * "calculado con el mismo origen") — se duplica en vez de importar entre
 * entrypoints porque cada uno es su propio bundle en MV3 (mismo patrón que
 * ya usa A1, ver `docs/DECISIONS.md`).
 */
export function nowMs(): number {
  return Math.round(performance.timeOrigin + performance.now());
}
