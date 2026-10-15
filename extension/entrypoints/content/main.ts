import type { Event } from "@qua/protocol";
import { createEmit, type EmitFn } from "./lib/emit.js";
import { DEFAULT_REDACTION_CONFIG, type RedactionConfig } from "./lib/redact.js";
import { NULL_SOURCE_RESOLVER, loadSourceResolver, type ComponentSourceResolver } from "./lib/source-resolver.js";
import { installHooks, type Teardown } from "./lib/hooks.js";
import { installListeners } from "./lib/listeners.js";
import { installObservers } from "./lib/observers.js";
import { installMarkRelay } from "./lib/mark.js";
import { installPingResponder } from "./lib/ping.js";
import { installOverlay } from "./lib/overlay.js";
import { nowMs } from "./lib/clock.js";
import type { BuildTargetRefOptions } from "./lib/target.js";

export interface StartOptions {
  window?: Window & typeof globalThis;
  document?: Document;
  emit?: EmitFn;
  redaction?: RedactionConfig;
  sourceResolver?: ComponentSourceResolver;
  /** Inyectable para tests — ver `installObservers`. */
  PerformanceObserverCtor?: typeof PerformanceObserver;
  /** Si es `false`, no intenta cargar `@qua/source-resolver` en segundo plano (tests). */
  autoLoadSourceResolver?: boolean;
  /** Si es `false`, no instala la pastilla de grabación (tests). */
  overlay?: boolean;
}

export type { Teardown };

/**
 * Instala todo lo de §05.1 (hooks, listeners, observers, hover, mark) y emite
 * los eventos iniciales (`nav` load + `viewport`). Devuelve un teardown que
 * deshace todo — usado por los tests para no filtrar estado entre casos.
 */
export function startQuaContentScript(opts: StartOptions = {}): Teardown {
  const win = opts.window ?? (window as Window & typeof globalThis);
  const doc = opts.document ?? document;
  const emit = opts.emit ?? createEmit();
  const redaction = opts.redaction ?? DEFAULT_REDACTION_CONFIG;

  const targetRefOptions: BuildTargetRefOptions = {
    redaction,
    sourceResolver: opts.sourceResolver ?? NULL_SOURCE_RESOLVER,
  };

  const target = { window: win, document: doc };

  // Cada parte se instala por separado: si una falla en una página rara, las demás siguen.
  const teardowns: Teardown[] = [];
  const install = (name: string, fn: () => Teardown) => {
    try {
      teardowns.push(fn());
    } catch (err) {
      console.warn(`[qua] no se pudo instalar ${name}`, err);
    }
  };
  install("hooks", () => installHooks(target, emit, { redaction }));
  install("listeners", () => installListeners(target, emit, { targetRefOptions }));
  install("observers", () => installObservers(target, emit, { targetRefOptions, PerformanceObserverCtor: opts.PerformanceObserverCtor }));
  install("mark", () => installMarkRelay(emit));
  install("ping", () => installPingResponder());

  // La pastilla va solo en el frame principal (no en cada iframe de la página).
  if (win.top === win && opts.overlay !== false) install("overlay", () => installOverlay(doc));

  emit({ t: nowMs(), k: "nav", url: win.location.href, title: doc.title, kind: "load" } as Event);
  emit({ t: nowMs(), k: "viewport", w: win.innerWidth, h: win.innerHeight, dpr: win.devicePixelRatio || 1 } as Event);

  if (!opts.sourceResolver && opts.autoLoadSourceResolver !== false) {
    loadSourceResolver()
      .then((resolver) => {
        targetRefOptions.sourceResolver = resolver;
      })
      .catch(() => {
        // loadSourceResolver ya degrada sola; esto es un cinturón extra.
      });
  }

  return () => teardowns.forEach((t) => t());
}
