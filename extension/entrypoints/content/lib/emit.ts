import { EventSchema, type Event } from "@qua/protocol";

export type EmitFn = (event: Event) => void;

/** Mensaje interno hacia el service worker. El batching/outbox es de A2 (§5.3). */
export interface QuaEventMessage {
  type: "qua:event";
  event: Event;
}

function hasRuntime(): boolean {
  return typeof chrome !== "undefined" && !!chrome.runtime?.id && typeof chrome.runtime.sendMessage === "function";
}

/**
 * Manda un evento ya construido al service worker. Valida contra `EventSchema`
 * antes de mandar nada — un bug en un builder nunca debería llegar a cruzar el
 * límite de proceso silenciosamente mal formado, pero tampoco debe tirar acá:
 * si no valida, se descarta con un `console.warn` y listo.
 *
 * `chrome.runtime.sendMessage` puede tirar ("Extension context invalidated",
 * página sin content script activo, etc.) — nunca debe propagar: es exactamente
 * el tipo de excepción que el criterio de aceptación de A1 prohíbe.
 */
export function createEmit(sink: EmitFn = defaultSink): EmitFn {
  return (event: Event) => {
    const result = EventSchema.safeParse(event);
    if (!result.success) {
      console.warn("[qua] evento inválido descartado", result.error.issues, event);
      return;
    }
    try {
      sink(result.data);
    } catch {
      // El sink (transporte, colector de test, etc.) nunca debe tirar hacia acá.
    }
  };
}

function defaultSink(event: Event): void {
  if (!hasRuntime()) return;
  try {
    const message: QuaEventMessage = { type: "qua:event", event };
    const maybePromise = chrome.runtime.sendMessage(message) as unknown;
    if (maybePromise && typeof (maybePromise as Promise<unknown>).catch === "function") {
      (maybePromise as Promise<unknown>).catch(() => {
        // Nadie del otro lado (aún no hay service worker, o se recicló) — se ignora.
      });
    }
  } catch {
    // Contexto de extensión invalidado u otro fallo de transporte — nunca tira.
  }
}

/** Emisor que junta todo en un array, para tests. */
export function createCollectingEmit(): { emit: EmitFn; events: Event[] } {
  const events: Event[] = [];
  return { emit: createEmit((e) => events.push(e)), events };
}
