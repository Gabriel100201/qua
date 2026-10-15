import type { Event, TargetRef } from "@qua/protocol";
import type { EmitFn } from "./emit.js";
import type { Teardown } from "./hooks.js";
import { buildTargetRef, type BuildTargetRefOptions } from "./target.js";
import { nowMs } from "./clock.js";

const LONG_TASK_MS = 200;
const LAYOUT_SHIFT_THRESHOLD = 0.05;
const MUTATION_WINDOW_MS = 100;
const MUTATION_THRESHOLD = 20;

export interface ObserversTarget {
  window: Window & typeof globalThis;
  document: Document;
}

export interface InstallObserversOptions {
  targetRefOptions?: BuildTargetRefOptions;
  /** Inyectable para tests — jsdom/happy-dom no implementan `PerformanceObserver`. */
  PerformanceObserverCtor?: typeof PerformanceObserver;
  mutationWindowMs?: number;
  mutationThreshold?: number;
}

interface LayoutShiftEntryLike extends PerformanceEntry {
  value: number;
  hadRecentInput: boolean;
  sources?: Array<{ node?: Node | null }>;
}

function installPerfObservers(target: ObserversTarget, emit: EmitFn, opts: InstallObserversOptions): Teardown {
  const Ctor = opts.PerformanceObserverCtor ?? target.window.PerformanceObserver;
  if (typeof Ctor !== "function") return () => {};

  const disconnects: Array<() => void> = [];

  try {
    const longTaskObserver = new Ctor((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration > LONG_TASK_MS) {
          emit({ t: nowMs(), k: "long_task", duration_ms: Math.round(entry.duration) } as Event);
        }
      }
    });
    longTaskObserver.observe({ type: "longtask", buffered: true });
    disconnects.push(() => longTaskObserver.disconnect());
  } catch {
    // 'longtask' no soportado en este navegador/entorno — se omite, nunca tira.
  }

  try {
    const layoutShiftObserver = new Ctor((list) => {
      for (const entry of list.getEntries() as LayoutShiftEntryLike[]) {
        if (entry.hadRecentInput || entry.value <= LAYOUT_SHIFT_THRESHOLD) continue;
        const sources = (entry.sources ?? [])
          .map((s) => (s.node instanceof Element ? buildTargetRef(s.node, opts.targetRefOptions) : undefined))
          .filter((t): t is TargetRef => !!t);
        emit({
          t: nowMs(),
          k: "layout_shift",
          value: entry.value,
          sources: sources.length > 0 ? sources : undefined,
        } as Event);
      }
    });
    layoutShiftObserver.observe({ type: "layout-shift", buffered: true });
    disconnects.push(() => layoutShiftObserver.disconnect());
  } catch {
    // 'layout-shift' no soportado — se omite.
  }

  return () => disconnects.forEach((d) => d());
}

/** `> 20` mutaciones en una ventana de 100 ms — proxy de "se abrió un modal" (§03). */
function installMutationObserver(target: ObserversTarget, emit: EmitFn, opts: InstallObserversOptions): Teardown {
  const { window: win, document: doc } = target;
  if (typeof win.MutationObserver !== "function") return () => {};

  const windowMs = opts.mutationWindowMs ?? MUTATION_WINDOW_MS;
  const threshold = opts.mutationThreshold ?? MUTATION_THRESHOLD;

  let windowStart = 0;
  let windowCount = 0;
  let flagged = false;
  let lastTarget: Element | undefined;

  const observer = new win.MutationObserver((records) => {
    const now = win.performance.now();
    if (now - windowStart > windowMs) {
      windowStart = now;
      windowCount = 0;
      flagged = false;
    }
    for (const record of records) {
      windowCount += record.addedNodes.length + record.removedNodes.length || 1;
      if (record.target instanceof Element) lastTarget = record.target;
    }
    if (!flagged && windowCount > threshold) {
      flagged = true;
      emit({
        t: nowMs(),
        k: "mutation_burst",
        target: lastTarget ? buildTargetRef(lastTarget, opts.targetRefOptions) : undefined,
        count: windowCount,
      } as Event);
    }
  });
  // En `document_start` todavía no hay `body`: `documentElement` ya existe y su subárbol
  // incluye al `body` que se agregue después. Observar `null` tiraba y mataba al content
  // script entero (desde A1: se perdían el ping, el `nav` inicial y la pastilla).
  observer.observe(doc.body ?? doc.documentElement, { childList: true, subtree: true });

  return () => observer.disconnect();
}

/** `PerformanceObserver('longtask'|'layout-shift')` + `MutationObserver` (§05.1). */
export function installObservers(target: ObserversTarget, emit: EmitFn, opts: InstallObserversOptions = {}): Teardown {
  const teardowns = [installPerfObservers(target, emit, opts), installMutationObserver(target, emit, opts)];
  return () => teardowns.forEach((t) => t());
}
