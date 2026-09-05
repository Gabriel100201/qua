import type { Event, Modifier } from "@qua/protocol";
import type { EmitFn } from "./emit.js";
import { buildTargetRef, type BuildTargetRefOptions } from "./target.js";
import { buildFieldRef } from "./field.js";
import { closestInteractive } from "./dom.js";
import { nowMs } from "./clock.js";
import type { Teardown } from "./hooks.js";

const HOVER_DWELL_MS = 400;
const HOVER_COMPUTED_STYLE_MS = 800;
const INPUT_DEBOUNCE_MS = 800;
const SCROLL_SETTLE_MS = 150;
const VIEWPORT_DEBOUNCE_MS = 300;

export interface ListenersTarget {
  window: Window & typeof globalThis;
  document: Document;
}

export interface InstallListenersOptions {
  targetRefOptions?: BuildTargetRefOptions;
}

const MOD_KEYS: Array<[keyof MouseEvent, Modifier]> = [
  ["shiftKey", "shift"],
  ["ctrlKey", "ctrl"],
  ["altKey", "alt"],
  ["metaKey", "meta"],
];

function modsOf(e: MouseEvent): Modifier[] {
  return MOD_KEYS.filter(([key]) => Boolean(e[key])).map(([, mod]) => mod);
}

function isFormControl(el: Element): el is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
}

/** Listeners en fase capture sobre `document` + tracker de hover (§05.1). */
export function installListeners(target: ListenersTarget, emit: EmitFn, opts: InstallListenersOptions = {}): Teardown {
  const { window: win, document: doc } = target;
  const trOpts = opts.targetRefOptions ?? {};

  // ── click ──────────────────────────────────────────────────────────────
  const onClick = (e: MouseEvent) => {
    const el = e.target instanceof Element ? closestInteractive(e.target) : null;
    if (!el) return;
    emit({
      t: nowMs(),
      k: "click",
      target: buildTargetRef(el, { ...trOpts, withComputedStyle: true }),
      button: e.button,
      mods: modsOf(e),
    } as Event);
  };
  doc.addEventListener("click", onClick, { capture: true });

  // ── focusin ────────────────────────────────────────────────────────────
  const onFocusIn = (e: FocusEvent) => {
    if (!(e.target instanceof Element)) return;
    emit({ t: nowMs(), k: "focus_change", target: buildTargetRef(e.target, trOpts) } as Event);
  };
  doc.addEventListener("focusin", onFocusIn, { capture: true });

  // ── input (debounce 800 ms por elemento) ──────────────────────────────
  const inputTimers = new WeakMap<Element, ReturnType<Window["setTimeout"]>>();
  const onInput = (e: Event2) => {
    const el = e.target;
    if (!(el instanceof Element) || !isFormControl(el)) return;
    const field = buildFieldRef(el);
    if (!field) return; // campo sensible (§12) — el evento no se emite en absoluto

    const pending = inputTimers.get(el);
    if (pending) win.clearTimeout(pending);
    inputTimers.set(
      el,
      win.setTimeout(() => {
        inputTimers.delete(el);
        emit({ t: nowMs(), k: "input", target: buildTargetRef(el, trOpts), field } as Event);
      }, INPUT_DEBOUNCE_MS),
    );
  };
  doc.addEventListener("input", onInput as EventListener, { capture: true });

  // ── submit ─────────────────────────────────────────────────────────────
  const onSubmit = (e: Event2) => {
    if (!(e.target instanceof Element)) return;
    emit({ t: nowMs(), k: "submit", target: buildTargetRef(e.target, trOpts) } as Event);
  };
  doc.addEventListener("submit", onSubmit as EventListener, { capture: true });

  // ── scroll_settle (150 ms sin scroll) ─────────────────────────────────
  let scrollTimer: ReturnType<Window["setTimeout"]> | undefined;
  let hasScrolled = false;
  const onScroll = () => {
    hasScrolled = true;
    if (scrollTimer) win.clearTimeout(scrollTimer);
    scrollTimer = win.setTimeout(() => {
      scrollTimer = undefined;
      if (!hasScrolled) return;
      hasScrolled = false;
      const doc_ = win.document.documentElement;
      const y = win.scrollY;
      const maxScroll = Math.max(doc_.scrollHeight - win.innerHeight, 0);
      const pct = maxScroll > 0 ? Math.min(Math.max(y / maxScroll, 0), 1) : 0;
      let topTarget;
      try {
        const el = win.document.elementFromPoint(Math.floor(win.innerWidth / 2), 0);
        if (el instanceof Element) topTarget = buildTargetRef(el, trOpts);
      } catch {
        // elementFromPoint puede no estar implementado (jsdom) — se omite top_target.
      }
      emit({ t: nowMs(), k: "scroll_settle", y, pct, top_target: topTarget } as Event);
    }, SCROLL_SETTLE_MS);
  };
  win.addEventListener("scroll", onScroll, { capture: true, passive: true });

  // ── viewport (resize, debounce 300 ms) ────────────────────────────────
  let resizeTimer: ReturnType<Window["setTimeout"]> | undefined;
  const emitViewport = () => {
    emit({
      t: nowMs(),
      k: "viewport",
      w: win.innerWidth,
      h: win.innerHeight,
      dpr: win.devicePixelRatio || 1,
    } as Event);
  };
  const onResize = () => {
    if (resizeTimer) win.clearTimeout(resizeTimer);
    resizeTimer = win.setTimeout(emitViewport, VIEWPORT_DEBOUNCE_MS);
  };
  win.addEventListener("resize", onResize, { capture: true });

  // ── hover tracker (dwell ≥ 400 ms, sube al ancestro interactivo) ──────
  let hoverEl: Element | null = null;
  let hoverStart = 0;

  const finalizeHover = () => {
    if (!hoverEl) return;
    const dwell = win.performance.now() - hoverStart;
    if (dwell >= HOVER_DWELL_MS) {
      emit({
        t: nowMs(),
        k: "hover",
        target: buildTargetRef(hoverEl, { ...trOpts, withComputedStyle: dwell > HOVER_COMPUTED_STYLE_MS }),
        dwell_ms: Math.round(dwell),
      } as Event);
    }
    hoverEl = null;
  };

  const onMouseOver = (e: MouseEvent) => {
    if (!(e.target instanceof Element)) return;
    const interactive = closestInteractive(e.target);
    if (interactive === hoverEl) return;
    finalizeHover();
    hoverEl = interactive;
    hoverStart = win.performance.now();
  };
  const onMouseOut = (e: MouseEvent) => {
    if (!hoverEl) return;
    const related = e.relatedTarget instanceof Element ? e.relatedTarget : null;
    if (related && hoverEl.contains(related)) return;
    finalizeHover();
  };
  doc.addEventListener("mouseover", onMouseOver, { capture: true });
  doc.addEventListener("mouseout", onMouseOut, { capture: true });

  return () => {
    doc.removeEventListener("click", onClick, { capture: true });
    doc.removeEventListener("focusin", onFocusIn, { capture: true });
    doc.removeEventListener("input", onInput as EventListener, { capture: true });
    doc.removeEventListener("submit", onSubmit as EventListener, { capture: true });
    win.removeEventListener("scroll", onScroll, { capture: true });
    win.removeEventListener("resize", onResize, { capture: true });
    doc.removeEventListener("mouseover", onMouseOver, { capture: true });
    doc.removeEventListener("mouseout", onMouseOut, { capture: true });
    if (scrollTimer) win.clearTimeout(scrollTimer);
    if (resizeTimer) win.clearTimeout(resizeTimer);
  };
}

// Alias local: evita chocar con el tipo `Event` importado de `@qua/protocol`.
type Event2 = globalThis.Event;
