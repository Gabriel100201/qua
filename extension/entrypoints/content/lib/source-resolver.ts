import type { SourceRef } from "@qua/protocol";

/**
 * Puerto hacia `@qua/source-resolver` (tarea E1, §11 tiers 2 y 3).
 *
 * A1 NO implementa la resolución (caminar el fiber de React, parsear
 * `_debugStack`, etc.) — eso es de E1. Esta interfaz es el contrato que
 * el content script necesita para completar `TargetRef.component`/`.src`
 * cuando exista una implementación real detrás.
 */
export interface ComponentSourceResolver {
  /**
   * Devuelve la cadena de componentes (tier 3) y, si puede, el archivo+línea
   * (tier 2) para `el`. `undefined` si no hay nada que decir (no es React,
   * no hay fiber, prod build sin `_debugOwner`, etc.). Nunca tira.
   */
  resolve(el: Element): { component?: string[]; src?: SourceRef } | undefined;
}

/** Resolver nulo: usado mientras E1 no exista o no exponga la forma esperada. */
export const NULL_SOURCE_RESOLVER: ComponentSourceResolver = {
  resolve() {
    return undefined;
  },
};

/**
 * Shape que se espera que `@qua/source-resolver` exporte en su default export
 * una vez que E1 lo implemente. Se declara acá (en vez de en el paquete, que
 * está congelado fuera de E1) para no bloquear a A1 en el mientras tanto.
 */
interface SourceResolverModule {
  createSourceResolver?: () => ComponentSourceResolver;
}

/**
 * Intenta cargar `@qua/source-resolver`. Hoy el paquete es un stub (`export {}`,
 * ver `packages/source-resolver/src/index.ts`) así que esto siempre degrada a
 * `NULL_SOURCE_RESOLVER` — `TargetRef.component`/`.src` quedan `undefined`, que
 * son campos opcionales en el esquema. Cuando E1 entregue `createSourceResolver`,
 * este loader lo recoge sin que A1 tenga que cambiar una línea.
 */
export async function loadSourceResolver(): Promise<ComponentSourceResolver> {
  try {
    const mod = (await import("@qua/source-resolver")) as SourceResolverModule;
    if (typeof mod.createSourceResolver === "function") {
      return mod.createSourceResolver();
    }
  } catch {
    // Paquete ausente o roto — degradamos, nunca tiramos desde acá.
  }
  return NULL_SOURCE_RESOLVER;
}
