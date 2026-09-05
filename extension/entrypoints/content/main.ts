import type { Event } from "@qua/protocol";
import { createEmit, type EmitFn } from "./lib/emit.js";
import { DEFAULT_REDACTION_CONFIG, type RedactionConfig } from "./lib/redact.js";
import { NULL_SOURCE_RESOLVER, loadSourceResolver, type ComponentSourceResolver } from "./lib/source-resolver.js";
import { installHooks, type Teardown } from "./lib/hooks.js";
import { installListeners } from "./lib/listeners.js";
import { installObservers } from "./lib/observers.js";
import { installMarkRelay } from "./lib/mark.js";
import { installPingResponder } from "./lib/ping.js";
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

  const teardowns: Teardown[] = [
    installHooks(target, emit, { redaction }),
    installListeners(target, emit, { targetRefOptions }),
    installObservers(target, emit, { targetRefOptions, PerformanceObserverCtor: opts.PerformanceObserverCtor }),
    installMarkRelay(emit),
    installPingResponder(),
  ];

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
