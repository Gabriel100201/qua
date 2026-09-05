import { describe, expect, it, vi } from "vitest";
import {
  startPopupController,
  type DiagnosticsClientLike,
  type PopupElements,
  type StatusClientLike,
} from "./controller.js";
import { IDLE_STATUS, type CommandResult } from "./status-client.js";
import type { PopupStatus } from "./messages.js";
import type { Utterance } from "@qua/protocol";

function buildElements(): PopupElements {
  document.body.innerHTML = `
    <button id="toggle"></button>
    <button id="mark"></button>
    <span id="status"></span>
    <span id="duration"></span>
    <span id="events"></span>
    <div id="transcript"></div>
    <div id="error" hidden></div>
    <span id="daemon-status"></span>
    <span id="mic-status"></span>
    <span id="content-script-status"></span>
    <button id="reload-tab" hidden></button>
  `;
  return {
    toggleButton: document.getElementById("toggle") as HTMLButtonElement,
    markButton: document.getElementById("mark") as HTMLButtonElement,
    statusLabel: document.getElementById("status")!,
    durationLabel: document.getElementById("duration")!,
    eventsCountLabel: document.getElementById("events")!,
    transcript: document.getElementById("transcript")!,
    errorBanner: document.getElementById("error")!,
    daemonStatusLabel: document.getElementById("daemon-status")!,
    micStatusLabel: document.getElementById("mic-status")!,
    contentScriptStatusLabel: document.getElementById("content-script-status")!,
    reloadTabButton: document.getElementById("reload-tab") as HTMLButtonElement,
  };
}

function fakeClient(initial: PopupStatus = IDLE_STATUS): {
  client: StatusClientLike;
  emitStatus: (s: PopupStatus) => void;
  emitTranscript: (u: Utterance) => void;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  mark: ReturnType<typeof vi.fn>;
} {
  let statusCb: ((s: PopupStatus) => void) | null = null;
  let transcriptCb: ((u: Utterance) => void) | null = null;
  const start = vi.fn<() => Promise<CommandResult>>(() => Promise.resolve({ ok: true }));
  const stop = vi.fn<() => Promise<CommandResult>>(() => Promise.resolve({ ok: true }));
  const mark = vi.fn<() => Promise<CommandResult>>(() => Promise.resolve({ ok: true }));
  const client: StatusClientLike = {
    getStatus: () => Promise.resolve(initial),
    start,
    stop,
    mark,
    onStatus: (cb) => {
      statusCb = cb;
      return () => {
        statusCb = null;
      };
    },
    onTranscript: (cb) => {
      transcriptCb = cb;
      return () => {
        transcriptCb = null;
      };
    },
  };
  return {
    client,
    emitStatus: (s) => statusCb?.(s),
    emitTranscript: (u) => transcriptCb?.(u),
    start,
    stop,
    mark,
  };
}

function fakeDiagnostics(overrides: Partial<DiagnosticsClientLike> = {}): DiagnosticsClientLike {
  return {
    getDaemonStatus: vi.fn().mockResolvedValue("conectado"),
    getMicStatus: vi.fn().mockResolvedValue("granted"),
    getContentScriptStatus: vi.fn().mockResolvedValue("inyectado"),
    reloadActiveTab: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

/** Flushea las promesas encadenadas de un click (start/stop/mark → applyCommandResult → refreshDiagnostics). */
async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("startPopupController — estado inicial", () => {
  it("arranca en idle, consulta el status y lo aplica", async () => {
    const elements = buildElements();
    const status: PopupStatus = { state: "recording", startedAtWall: 1000, eventsCount: 4 };
    const { client } = fakeClient(status);

    startPopupController({ client, elements, now: () => 3000 });
    await Promise.resolve();
    await Promise.resolve();

    expect(elements.statusLabel.textContent).toBe("● Grabando");
    expect(elements.eventsCountLabel.textContent).toBe("4");
    expect(elements.toggleButton.textContent).toBe("Detener");
    expect(elements.durationLabel.textContent).toBe("00:02");
  });
});

describe("startPopupController — botón toggle", () => {
  it("en idle, click en toggle llama a client.start()", () => {
    const elements = buildElements();
    const { client, start } = fakeClient(IDLE_STATUS);
    startPopupController({ client, elements });

    elements.toggleButton.click();
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("en recording, click en toggle llama a client.stop()", () => {
    const elements = buildElements();
    const { client, emitStatus, stop } = fakeClient(IDLE_STATUS);
    startPopupController({ client, elements });
    emitStatus({ state: "recording", startedAtWall: 0, eventsCount: 0 });

    elements.toggleButton.click();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("deshabilita el toggle en starting/stopping", () => {
    const elements = buildElements();
    const { client, emitStatus } = fakeClient(IDLE_STATUS);
    startPopupController({ client, elements });

    emitStatus({ state: "starting", startedAtWall: null, eventsCount: 0 });
    expect(elements.toggleButton.disabled).toBe(true);

    emitStatus({ state: "recording", startedAtWall: 0, eventsCount: 0 });
    expect(elements.toggleButton.disabled).toBe(false);

    emitStatus({ state: "stopping", startedAtWall: 0, eventsCount: 0 });
    expect(elements.toggleButton.disabled).toBe(true);
  });
});

describe("startPopupController — marca", () => {
  it("el botón de marca solo está habilitado grabando", () => {
    const elements = buildElements();
    const { client, emitStatus, mark } = fakeClient(IDLE_STATUS);
    startPopupController({ client, elements });

    expect(elements.markButton.disabled).toBe(true);
    emitStatus({ state: "recording", startedAtWall: 0, eventsCount: 0 });
    expect(elements.markButton.disabled).toBe(false);

    elements.markButton.click();
    expect(mark).toHaveBeenCalledTimes(1);
  });
});

describe("startPopupController — duración en vivo", () => {
  it("tickea la duración cada segundo mientras graba y para al dejar de grabar", () => {
    const elements = buildElements();
    const { client, emitStatus } = fakeClient(IDLE_STATUS);
    let currentNow = 0;
    const tickRef: { current: (() => void) | null } = { current: null };
    const setIntervalFn = vi.fn((fn: () => void) => {
      tickRef.current = fn;
      return 1 as unknown as ReturnType<typeof setInterval>;
    });
    const clearIntervalFn = vi.fn();

    startPopupController({
      client,
      elements,
      now: () => currentNow,
      setIntervalFn: setIntervalFn as unknown as typeof setInterval,
      clearIntervalFn: clearIntervalFn as unknown as typeof clearInterval,
    });

    emitStatus({ state: "recording", startedAtWall: 0, eventsCount: 0 });
    expect(setIntervalFn).toHaveBeenCalledTimes(1);

    currentNow = 3000;
    tickRef.current?.();
    expect(elements.durationLabel.textContent).toBe("00:03");

    emitStatus({ state: "stopping", startedAtWall: 0, eventsCount: 0 });
    expect(clearIntervalFn).toHaveBeenCalledTimes(1);
  });

  it("no arranca el timer dos veces si llegan varios pushes en recording", () => {
    const elements = buildElements();
    const { client, emitStatus } = fakeClient(IDLE_STATUS);
    const setIntervalFn = vi.fn(() => 1 as unknown as ReturnType<typeof setInterval>);

    startPopupController({
      client,
      elements,
      setIntervalFn: setIntervalFn as unknown as typeof setInterval,
      clearIntervalFn: vi.fn() as unknown as typeof clearInterval,
    });

    emitStatus({ state: "recording", startedAtWall: 0, eventsCount: 1 });
    emitStatus({ state: "recording", startedAtWall: 0, eventsCount: 2 });
    expect(setIntervalFn).toHaveBeenCalledTimes(1);
  });
});

describe("startPopupController — transcript en vivo", () => {
  it("agrega cada utterance de transcript.partial al final", () => {
    const elements = buildElements();
    const { client, emitTranscript } = fakeClient(IDLE_STATUS);
    startPopupController({ client, elements });

    emitTranscript({ text: "primera línea" } as Utterance);
    emitTranscript({ text: "segunda línea" } as Utterance);

    const lines = [...elements.transcript.children].map((el) => el.textContent);
    expect(lines).toEqual(["primera línea", "segunda línea"]);
  });

  it("recorta a maxTranscriptLines, descartando lo más viejo", () => {
    const elements = buildElements();
    const { client, emitTranscript } = fakeClient(IDLE_STATUS);
    startPopupController({ client, elements, maxTranscriptLines: 2 });

    emitTranscript({ text: "a" } as Utterance);
    emitTranscript({ text: "b" } as Utterance);
    emitTranscript({ text: "c" } as Utterance);

    const lines = [...elements.transcript.children].map((el) => el.textContent);
    expect(lines).toEqual(["b", "c"]);
  });
});

describe("startPopupController — teardown", () => {
  it("el teardown saca los listeners de click y para el timer", () => {
    const elements = buildElements();
    const { client, emitStatus, start } = fakeClient(IDLE_STATUS);
    const clearIntervalFn = vi.fn();
    const teardown = startPopupController({
      client,
      elements,
      setIntervalFn: (() => 1) as unknown as typeof setInterval,
      clearIntervalFn: clearIntervalFn as unknown as typeof clearInterval,
    });

    emitStatus({ state: "recording", startedAtWall: 0, eventsCount: 0 });
    teardown();

    elements.toggleButton.click();
    expect(start).not.toHaveBeenCalled();
    expect(clearIntervalFn).toHaveBeenCalledTimes(1);
  });
});

/**
 * CRITERIO de esta tarea (docs/DECISIONS.md D-U2-01): un fallo en cada capa —
 * sin token, daemon caído, sin content script — tiene que producir un mensaje
 * DISTINTO y correcto en el popup. Antes, los tres terminaban en el mismo síntoma
 * mudo: un contador en cero.
 */
describe("startPopupController — errores reales, no silenciosos (D-U2-01)", () => {
  it("start() falla por falta de token: el banner de error muestra ese mensaje exacto", async () => {
    const elements = buildElements();
    const { client, start } = fakeClient(IDLE_STATUS);
    start.mockResolvedValue({ ok: false, error: "[qua] sin token: emparejá primero desde options." });
    startPopupController({ client, elements, diagnostics: fakeDiagnostics() });

    elements.toggleButton.click();
    await flushAsync();

    expect(elements.errorBanner.hidden).toBe(false);
    expect(elements.errorBanner.textContent).toBe("[qua] sin token: emparejá primero desde options.");
  });

  it("start() falla porque el daemon no responde: mensaje distinto al de 'sin token'", async () => {
    const elements = buildElements();
    const { client, start } = fakeClient(IDLE_STATUS);
    start.mockResolvedValue({
      ok: false,
      error: "[qua] el daemon no responde en 127.0.0.1:7331 — revisá que quad esté corriendo.",
    });
    startPopupController({ client, elements, diagnostics: fakeDiagnostics() });

    elements.toggleButton.click();
    await flushAsync();

    expect(elements.errorBanner.textContent).toBe(
      "[qua] el daemon no responde en 127.0.0.1:7331 — revisá que quad esté corriendo.",
    );
    expect(elements.errorBanner.textContent).not.toBe("[qua] sin token: emparejá primero desde options.");
  });

  it("un start() exitoso limpia un error previo del banner", async () => {
    const elements = buildElements();
    const { client, start } = fakeClient(IDLE_STATUS);
    start.mockResolvedValueOnce({ ok: false, error: "[qua] sin token: emparejá primero desde options." });
    start.mockResolvedValueOnce({ ok: true });
    startPopupController({ client, elements, diagnostics: fakeDiagnostics() });

    elements.toggleButton.click();
    await flushAsync();
    expect(elements.errorBanner.hidden).toBe(false);

    elements.toggleButton.click();
    await flushAsync();
    expect(elements.errorBanner.hidden).toBe(true);
    expect(elements.errorBanner.textContent).toBe("");
  });

  it("sin content script en la pestaña activa: label distinto + botón de recargar visible", async () => {
    const elements = buildElements();
    const { client } = fakeClient(IDLE_STATUS);
    const diagnostics = fakeDiagnostics({ getContentScriptStatus: vi.fn().mockResolvedValue("hace_falta_recargar") });
    startPopupController({ client, elements, diagnostics });
    await flushAsync();

    expect(elements.contentScriptStatusLabel.textContent).toBe("Pestaña: recargá para grabar");
    expect(elements.reloadTabButton.hidden).toBe(false);
  });

  it("con content script inyectado: el botón de recargar queda oculto", async () => {
    const elements = buildElements();
    const { client } = fakeClient(IDLE_STATUS);
    startPopupController({ client, elements, diagnostics: fakeDiagnostics() });
    await flushAsync();

    expect(elements.contentScriptStatusLabel.textContent).toBe("Pestaña: lista");
    expect(elements.reloadTabButton.hidden).toBe(true);
  });

  it("los tres mensajes de la franja (daemon/mic/content script) son todos distintos entre sí", async () => {
    const elements = buildElements();
    const { client } = fakeClient(IDLE_STATUS);
    const diagnostics = fakeDiagnostics({
      getDaemonStatus: vi.fn().mockResolvedValue("sin_emparejar"),
      getMicStatus: vi.fn().mockResolvedValue("prompt"),
      getContentScriptStatus: vi.fn().mockResolvedValue("hace_falta_recargar"),
    });
    startPopupController({ client, elements, diagnostics });
    await flushAsync();

    const labels = [
      elements.daemonStatusLabel.textContent,
      elements.micStatusLabel.textContent,
      elements.contentScriptStatusLabel.textContent,
    ];
    expect(new Set(labels).size).toBe(3);
  });

  it("click en 'Recargar la pestaña' llama a diagnostics.reloadActiveTab() y refresca la franja", async () => {
    const elements = buildElements();
    const { client } = fakeClient(IDLE_STATUS);
    const getContentScriptStatus = vi.fn().mockResolvedValueOnce("hace_falta_recargar").mockResolvedValue("inyectado");
    const diagnostics = fakeDiagnostics({ getContentScriptStatus });
    startPopupController({ client, elements, diagnostics });
    await flushAsync();
    expect(elements.reloadTabButton.hidden).toBe(false);

    elements.reloadTabButton.click();
    await flushAsync();

    expect(diagnostics.reloadActiveTab).toHaveBeenCalledTimes(1);
    expect(elements.contentScriptStatusLabel.textContent).toBe("Pestaña: lista");
    expect(elements.reloadTabButton.hidden).toBe(true);
  });

  it("sin diagnostics inyectado, no rompe y deja la franja como venía en el HTML", async () => {
    const elements = buildElements();
    const { client } = fakeClient(IDLE_STATUS);
    startPopupController({ client, elements });
    await flushAsync();

    expect(elements.daemonStatusLabel.textContent).toBe("");
  });
});
