import type { Event } from "@qua/protocol";
import type { EmitFn } from "./emit.js";
import { redactUrl, DEFAULT_REDACTION_CONFIG, type RedactionConfig } from "./redact.js";
import { nowMs } from "./clock.js";

const NET_SLOW_MS = 1200;

export interface HooksTarget {
  window: Window & typeof globalThis;
  document: Document;
}

export interface InstallHooksOptions {
  redaction?: RedactionConfig;
}

/** Deshace todos los patches. Pensado para tests; en producción no se llama nunca. */
export type Teardown = () => void;

function absoluteUrl(raw: string, win: Window): string {
  try {
    return new URL(raw, win.location.href).toString();
  } catch {
    return raw;
  }
}

function stringifyArg(arg: unknown): string {
  if (typeof arg === "string") return arg;
  if (arg instanceof Error) return arg.message;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function stackOf(arg: unknown): string | undefined {
  return arg instanceof Error ? arg.stack : undefined;
}

/** `console.error`/`console.warn`, `window.onerror`, `unhandledrejection` (§05.1). */
function installConsoleHooks(target: HooksTarget, emit: EmitFn): Teardown {
  const { window: win, document: doc } = target;
  void doc;
  const originalError = console.error.bind(console);
  const originalWarn = console.warn.bind(console);

  function wrap(level: "error" | "warn", original: typeof console.error) {
    return (...args: unknown[]) => {
      original(...args);
      try {
        const text = args.map(stringifyArg).join(" ");
        const stack = args.map(stackOf).find((s): s is string => !!s);
        emit({ t: nowMs(), k: "console", level, text, stack } as Event);
      } catch {
        // nunca tira desde el hook — el console real ya corrió arriba.
      }
    };
  }

  console.error = wrap("error", originalError);
  console.warn = wrap("warn", originalWarn);

  const onError = (e: ErrorEvent) => {
    emit({
      t: nowMs(),
      k: "console",
      level: "error",
      text: e.message || "onerror",
      stack: e.error instanceof Error ? e.error.stack : undefined,
    } as Event);
  };
  const onRejection = (e: PromiseRejectionEvent) => {
    emit({
      t: nowMs(),
      k: "console",
      level: "error",
      text: `unhandledrejection: ${stringifyArg(e.reason)}`,
      stack: stackOf(e.reason),
    } as Event);
  };

  win.addEventListener("error", onError);
  win.addEventListener("unhandledrejection", onRejection);

  return () => {
    console.error = originalError;
    console.warn = originalWarn;
    win.removeEventListener("error", onError);
    win.removeEventListener("unhandledrejection", onRejection);
  };
}

/** Patch de `fetch` — `net_fail` (status ≥ 400 o error de red) y `net_slow` (> 1200 ms). */
function installFetchHook(target: HooksTarget, emit: EmitFn, redaction: RedactionConfig): Teardown {
  const win = target.window;
  const original = win.fetch?.bind(win);
  if (!original) return () => {};

  win.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? (input instanceof Request ? input.method : undefined) ?? "GET").toUpperCase();
    const rawUrl = input instanceof Request ? input.url : String(input);
    const url = redactUrl(absoluteUrl(rawUrl, win), redaction);
    const start = win.performance.now();

    try {
      const response = await original(input, init);
      const duration_ms = Math.round(win.performance.now() - start);
      if (response.status >= 400) {
        emit({ t: nowMs(), k: "net_fail", method, url, status: response.status, duration_ms } as Event);
      } else if (duration_ms > NET_SLOW_MS) {
        emit({ t: nowMs(), k: "net_slow", method, url, status: response.status, duration_ms } as Event);
      }
      return response;
    } catch (err) {
      const duration_ms = Math.round(win.performance.now() - start);
      emit({ t: nowMs(), k: "net_fail", method, url, status: 0, duration_ms } as Event);
      throw err;
    }
  }) as typeof win.fetch;

  return () => {
    win.fetch = original;
  };
}

interface QuaXhrState {
  method: string;
  url: string;
  start: number;
}

const XHR_STATE = new WeakMap<XMLHttpRequest, QuaXhrState>();

/** Patch de `XMLHttpRequest` — misma semántica que el hook de `fetch`. */
function installXhrHook(target: HooksTarget, emit: EmitFn, redaction: RedactionConfig): Teardown {
  const win = target.window;
  const XHR = win.XMLHttpRequest;
  if (!XHR) return () => {};

  const originalOpen = XHR.prototype.open;
  const originalSend = XHR.prototype.send;

  XHR.prototype.open = function patchedOpen(this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
    XHR_STATE.set(this, { method: method.toUpperCase(), url: absoluteUrl(String(url), win), start: 0 });
    return (originalOpen as (...a: unknown[]) => void).call(this, method, url, ...rest);
  };

  XHR.prototype.send = function patchedSend(this: XMLHttpRequest, ...args: unknown[]) {
    const state = XHR_STATE.get(this);
    if (state) state.start = win.performance.now();

    const finish = (networkError: boolean) => {
      const s = XHR_STATE.get(this);
      if (!s) return;
      const duration_ms = Math.round(win.performance.now() - s.start);
      const url = redactUrl(s.url, redaction);
      const status = networkError ? 0 : this.status;
      try {
        if (networkError || status >= 400) {
          emit({ t: nowMs(), k: "net_fail", method: s.method, url, status, duration_ms } as Event);
        } else if (duration_ms > NET_SLOW_MS) {
          emit({ t: nowMs(), k: "net_slow", method: s.method, url, status, duration_ms } as Event);
        }
      } finally {
        XHR_STATE.delete(this);
      }
    };

    this.addEventListener("load", () => finish(false), { once: true });
    this.addEventListener("error", () => finish(true), { once: true });
    this.addEventListener("timeout", () => finish(true), { once: true });

    return (originalSend as (...a: unknown[]) => void).apply(this, args);
  };

  return () => {
    XHR.prototype.open = originalOpen;
    XHR.prototype.send = originalSend;
  };
}

/**
 * Patch de `history.pushState`/`replaceState` + `popstate` → eventos `nav`.
 *
 * La dirección back/forward de `popstate` es heurística: cada `pushState`
 * propio etiqueta el `state` (si es un objeto) con un índice creciente
 * (`__quaNavIdx`); en `popstate` comparamos contra el último índice visto.
 * Si el `state` no es taggeable (primitivo, `null`, o vino de otro código
 * antes de que este hook se instalara) degradamos a `"back"` — es una
 * etiqueta best-effort, no algo de lo que el correlador dependa para anclar.
 */
function installHistoryHooks(target: HooksTarget, emit: EmitFn): Teardown {
  const win = target.window;
  const history = win.history;
  const originalPush = history.pushState.bind(history);
  const originalReplace = history.replaceState.bind(history);

  let idx = 0;
  let lastSeenIdx = 0;

  function tagState(state: unknown): unknown {
    if (state && typeof state === "object" && !Array.isArray(state)) {
      idx += 1;
      lastSeenIdx = idx;
      return { ...(state as Record<string, unknown>), __quaNavIdx: idx };
    }
    idx += 1;
    lastSeenIdx = idx;
    return state;
  }

  function emitSpaNav() {
    emit({ t: nowMs(), k: "nav", url: win.location.href, title: win.document.title, kind: "spa" } as Event);
  }

  history.pushState = function patchedPushState(state: unknown, title: string, url?: string | URL | null) {
    const tagged = tagState(state);
    originalPush(tagged, title, url ?? undefined);
    emitSpaNav();
  };

  history.replaceState = function patchedReplaceState(state: unknown, title: string, url?: string | URL | null) {
    originalReplace(state, title, url ?? undefined);
    emitSpaNav();
  };

  const onPopState = (e: PopStateEvent) => {
    const state = e.state as { __quaNavIdx?: number } | null;
    const stateIdx = state && typeof state.__quaNavIdx === "number" ? state.__quaNavIdx : undefined;
    const kind: "back" | "forward" = stateIdx !== undefined && stateIdx > lastSeenIdx ? "forward" : "back";
    if (stateIdx !== undefined) lastSeenIdx = stateIdx;
    emit({ t: nowMs(), k: "nav", url: win.location.href, title: win.document.title, kind } as Event);
  };
  win.addEventListener("popstate", onPopState);

  return () => {
    history.pushState = originalPush;
    history.replaceState = originalReplace;
    win.removeEventListener("popstate", onPopState);
  };
}

/**
 * Instala todos los hooks de `document_start` (§05.1): fetch, XHR,
 * console.error/warn + onerror + unhandledrejection, y history. Todos
 * preservan el comportamiento original y nunca tiran (criterio de A1).
 */
export function installHooks(target: HooksTarget, emit: EmitFn, opts: InstallHooksOptions = {}): Teardown {
  const redaction = opts.redaction ?? DEFAULT_REDACTION_CONFIG;
  const teardowns = [
    installConsoleHooks(target, emit),
    installFetchHook(target, emit, redaction),
    installXhrHook(target, emit, redaction),
    installHistoryHooks(target, emit),
  ];
  return () => teardowns.forEach((t) => t());
}
