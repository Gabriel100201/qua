/**
 * EL TEST QUE DEFINE "LISTO" para A1 — criterio de aceptación de §14:
 *
 *   "En una página de prueba emite los 17 tipos de evento [no-`audio_gap`];
 *   el selector reidentifica el mismo nodo tras un re-render; cero
 *   excepciones con los hooks puestos."
 *
 * Corre `startQuaContentScript` completo (hooks + listeners + observers +
 * mark) sobre `test/fixtures/page.html`, dispara cada disparador real, y
 * verifica que las 17 variantes de `Event` que le corresponden al content
 * script salgan por el `emit` validado. `tab_switch`/`tab_close` no los
 * dispara ningún hook de acá (nacen de `chrome.tabs`, ver
 * `docs/DECISIONS.md` D-09) — se construyen con los builders de
 * `lib/tab-events.ts` para probar que el mismo pipeline de validación los
 * acepta.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EVENT_KINDS } from "@qua/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCollectingEmit } from "../lib/emit.js";
import { buildTabCloseEvent, buildTabSwitchEvent } from "../lib/tab-events.js";
import { startQuaContentScript, type Teardown } from "../main.js";

const pageHtml = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../../test/fixtures/page.html"),
  "utf8",
);

interface FakeChrome {
  trigger: (message: unknown) => void;
}

function installFakeChrome(): FakeChrome {
  const listeners: Array<(message: unknown) => void> = [];
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      id: "fake-extension-id",
      sendMessage: vi.fn(),
      onMessage: {
        addListener: (fn: (message: unknown) => void) => listeners.push(fn),
        removeListener: (fn: (message: unknown) => void) => {
          const i = listeners.indexOf(fn);
          if (i >= 0) listeners.splice(i, 1);
        },
      },
    },
  };
  return { trigger: (message: unknown) => listeners.forEach((fn) => fn(message)) };
}

/** Doble de `PerformanceObserver` — ni jsdom ni happy-dom lo implementan. */
class FakePerformanceObserver {
  static byType = new Map<string, (list: { getEntries: () => unknown[] }) => void>();
  constructor(private cb: (list: { getEntries: () => unknown[] }) => void) {}
  observe(options: { type: string }) {
    FakePerformanceObserver.byType.set(options.type, this.cb);
  }
  disconnect() {}
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("content script — página de prueba (§14, criterio de A1)", () => {
  let teardown: Teardown | undefined;
  let clock: number;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    clock = 1_000_000;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    FakePerformanceObserver.byType.clear();

    const parsed = new DOMParser().parseFromString(pageHtml, "text/html");
    document.title = parsed.title;
    document.body.innerHTML = parsed.body.innerHTML;

    fetchMock = vi.fn(async (input: unknown) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/broken")) throw new Error("network down");
      if (url.includes("/slow")) {
        clock += 1500;
        return new Response(null, { status: 200 });
      }
      if (url.includes("/fail")) return new Response(null, { status: 500 });
      return new Response(null, { status: 200 });
    });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    teardown?.();
    teardown = undefined;
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = "";
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
  });

  function advance(ms: number) {
    clock += ms;
    vi.advanceTimersByTime(ms);
  }

  it("emite los 17 tipos de evento (todos salvo audio_gap), sin tirar ninguna excepción", async () => {
    const fakeChrome = installFakeChrome();
    const { emit, events } = createCollectingEmit();

    expect(() => {
      teardown = startQuaContentScript({
        emit,
        PerformanceObserverCtor: FakePerformanceObserver as unknown as typeof PerformanceObserver,
        autoLoadSourceResolver: false,
      });
    }).not.toThrow();

    // nav (load) + viewport ya salieron en el arranque.

    // click
    const nuevoTurno = document.querySelector('[data-testid="nuevo-turno"]')!;
    expect(() => nuevoTurno.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }))).not.toThrow();

    // focus_change
    const nombreInput = document.getElementById("campo-nombre") as HTMLInputElement;
    expect(() => nombreInput.dispatchEvent(new FocusEvent("focusin", { bubbles: true }))).not.toThrow();

    // input (debounce 800 ms)
    nombreInput.value = "Gabriel";
    nombreInput.dispatchEvent(new Event("input", { bubbles: true }));
    advance(800);

    // submit
    const form = document.getElementById("form-paciente") as HTMLFormElement;
    expect(() => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))).not.toThrow();

    // scroll_settle (150 ms sin scroll)
    window.dispatchEvent(new Event("scroll"));
    advance(150);

    // viewport (resize, debounce 300 ms)
    window.dispatchEvent(new Event("resize"));
    advance(300);

    // hover — dwell ≥ 400 ms, sube al <button> (ancestro interactivo)
    const confirmar = document.querySelector(".confirmar")!;
    confirmar.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    clock += 500;
    confirmar.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));

    // console: console.error/warn + onerror + unhandledrejection
    const realWarn = console.warn;
    console.error("algo se rompió");
    realWarn("cuidado");
    window.dispatchEvent(
      new ErrorEvent("error", { message: "boom", error: new Error("boom") }),
    );
    const rejection = new window.Event("unhandledrejection") as globalThis.Event & { reason?: unknown };
    rejection.reason = new Error("promesa rota");
    window.dispatchEvent(rejection);

    // net_fail / net_slow — fetch
    await window.fetch("/api/fail");
    await window.fetch("/api/slow");
    await window.fetch("/api/broken").catch(() => {});

    // long_task / layout_shift — vía el PerformanceObserver inyectado
    const longtaskCb = FakePerformanceObserver.byType.get("longtask");
    longtaskCb?.({ getEntries: () => [{ duration: 250 }] });
    const layoutShiftCb = FakePerformanceObserver.byType.get("layout-shift");
    layoutShiftCb?.({
      getEntries: () => [{ value: 0.3, hadRecentInput: false, sources: [{ node: nuevoTurno }] }],
    });

    // mutation_burst — > 20 mutaciones en la ventana
    const modalRoot = document.getElementById("modal-root")!;
    for (let i = 0; i < 25; i++) {
      modalRoot.appendChild(document.createElement("div"));
    }
    await flushMicrotasks();

    // mark — relay del hotkey/popup vía el service worker
    fakeChrome.trigger({ type: "qua:mark", source: "hotkey" });

    // tab_switch / tab_close — no los dispara el content script (D-09);
    // demostramos que el mismo `emit` validado los acepta igual.
    emit(buildTabSwitchEvent(3, 4, "https://x.test/otra"));
    emit(buildTabCloseEvent(3));

    const kinds = new Set(events.map((e) => e.k));
    const expectedKinds = new Set(EVENT_KINDS.filter((k) => k !== "audio_gap"));
    expect(kinds).toEqual(expectedKinds);
  });

  it("el selector del click original reidentifica el mismo nodo después de un re-render del header", () => {
    const { emit, events } = createCollectingEmit();
    teardown = startQuaContentScript({
      emit,
      PerformanceObserverCtor: FakePerformanceObserver as unknown as typeof PerformanceObserver,
      autoLoadSourceResolver: false,
    });

    const before = document.querySelector('[data-testid="nuevo-turno"]')!;
    before.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));

    const clickEvent = events.find((e) => e.k === "click");
    expect(clickEvent).toBeDefined();
    const found = clickEvent!;
    const sel = found.k === "click" ? found.target.sel : "";

    // Re-render: React destruye el header viejo y monta uno nuevo con el
    // mismo `data-testid` — el nodo es otro, el ancla lógica es la misma.
    const header = document.getElementById("app-header")!;
    header.innerHTML = "";
    const after = document.createElement("button");
    after.setAttribute("data-testid", "nuevo-turno");
    after.textContent = "Nuevo turno";
    header.appendChild(after);

    expect(after).not.toBe(before);
    expect(document.querySelector(sel)).toBe(after);
  });
});
