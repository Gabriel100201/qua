/**
 * Reloj compartido de todos los eventos del content script.
 *
 * `t` viaja como epoch-ms absoluto (`performance.timeOrigin + performance.now()`);
 * el daemon lo normaliza contra `t0_wall` de la sesión (§02, comentario de
 * `Event.t` en `packages/protocol/src/event.ts`). El content script no conoce
 * `t0_wall` y no le hace falta.
 */
export function nowMs(): number {
  return Math.round(performance.timeOrigin + performance.now());
}
