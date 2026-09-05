import { afterEach, describe, expect, it, vi } from "vitest";
import {
  startPopupController,
  type DiagnosticsClientLike,
  type PopupElements,
  type StatusClientLike,
  type Teardown,
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
  /** Cambia lo que devuelve la PRÓXIMA `getStatus()` — para simular lo que ve un poll. */
  setPolledStatus: (s: PopupStatus) => void;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  mark: ReturnType<typeof vi.fn>;
} {
  let statusCb: ((s: PopupStatus) => void) | null = null;
  let transcriptCb: ((u: Utterance) => void) | null = null;
  let polled = initial;
  const start = vi.fn<() => Promise<CommandResult>>(() => Promise.resolve({ ok: true }));
  const stop = vi.fn<() => Promise<CommandResult>>(() => Promise.resolve({ ok: true }));
  const mark = vi.fn<() => Promise<CommandResult>>(() => Promise.resolve({ ok: true }));
  const client: StatusClientLike = {
    getStatus: () => Promise.resolve(polled),
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
    setPolledStatus: (s) => {
      polled = s;
    },
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

/** Captura el callback que `startPopupController` le pasa a `setInterval` para el
 * poll de estado (D-U3-01, docs/DECISIONS.md), sin depender de timers reales. */
function fakePollTimer(): { setIntervalFn: typeof setInterval; tick: () => Promise<void> } {
  let fn: (() => void) | null = null;
  const setIntervalFn = vi.fn((cb: () => void) => {
    fn = cb;
    return 1 as unknown as ReturnType<typeof setInterval>;
  }) as unknown as typeof setInterval;
  return {
    setIntervalFn,
    tick: async () => {
      fn?.();
      await flushAsync();
    },
  };
}

const teardowns: Teardown[] = [];
function mount(opts: Parameters<typeof startPopupController>[0]): Teardown {
  const teardown = startPopupController(opts);
  teardowns.push(teardown);
  return teardown;
}

afterEach(() => {
  while (teardowns.length > 0) teardowns.pop()!();
});

describe("startPopupController — estado inicial", () => {
  it("arranca en idle, consulta el status y lo aplica", async () => {
    const elements = buildElements();
    const status: PopupStatus = { state: "recording", startedAtWall: 1000, eventsCount: 4 };
    const { client } = fakeClient(status);

    mount({ client, elements, now: () => 3000 });
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
    mount({ client, elements });

    elements.toggleButton.click();
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("en recording, click en toggle llama a client.stop()", () => {
    const elements = buildElements();
    const { client, emitStatus, stop } = fakeClient(IDLE_STATUS);
    mount({ client, elements });
    emitStatus({ state: "recording", startedAtWall: 0, eventsCount: 0 });

    elements.toggleButton.click();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("deshabilita el toggle en starting/stopping", () => {
    const elements = buildElements();
    const { client, emitStatus } = fakeClient(IDLE_STATUS);
    mount({ client, elements });

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
    mount({ client, elements });

    expect(elements.markButton.disabled).toBe(true);
    emitStatus({ state: "recording", startedAtWall: 0, eventsCount: 0 });
    expect(elements.markButton.disabled).toBe(false);

    elements.markButton.click();
    expect(mark).toHaveBeenCalledTimes(1);
  });
});

describe("startPopupController — duración en vivo", () => {
  it("recalcula la duración en cada tick del poll de estado mientras graba", async () => {
    const elements = buildElements();
    const { client, setPolledStatus } = fakeClient(IDLE_STATUS);
    let currentNow = 0;
    const { setIntervalFn, tick } = fakePollTimer();

    mount({ client, elements, now: () => currentNow, setIntervalFn });
    await flushAsync();

    setPolledStatus({ state: "recording", startedAtWall: 0, eventsCount: 0 });
    currentNow = 3000;
    await tick();

    expect(elements.statusLabel.textContent).toBe("● Grabando");
    expect(elements.durationLabel.textContent).toBe("00:03");
  });

  it("un solo timer para el poll, sin importar cuántos pushes de estado lleguen", () => {
    const elements = buildElements();
    const { client, emitStatus } = fakeClient(IDLE_STATUS);
    const setIntervalFn = vi.fn(() => 1 as unknown as ReturnType<typeof setInterval>);

    mount({
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

/**
 * CRITERIO de esta tarea (docs/DECISIONS.md D-U3-01): apretar Grabar tiene que
 * reflejarse en la UI del popup SIN cerrarlo y volver a abrirlo — antes, `getStatus()`
 * se consultaba una única vez al abrir y el popup se quedaba en "Inactivo" para
 * siempre aunque la sesión arrancara de verdad del otro lado.
 */
describe("startPopupController — la UI se actualiza sin cerrar el popup (D-U3-01)", () => {
  it("Grabar: la etiqueta pasa de Inactivo a ● Grabando y el botón a Detener en el siguiente poll", async () => {
    const elements = buildElements();
    const { client, start, setPolledStatus } = fakeClient(IDLE_STATUS);
    const { setIntervalFn, tick } = fakePollTimer();
    mount({ client, elements, setIntervalFn, diagnostics: fakeDiagnostics() });
    await flushAsync();

    expect(elements.statusLabel.textContent).toBe("Inactivo");
    expect(elements.toggleButton.textContent).toBe("Grabar");

    // El popup nunca se cierra: `start()` ya devolvió {ok:true} pero el único
    // camino por el que el popup se entera de que la FSM llegó a "recording" es
    // el próximo tick del poll — exactamente lo que reprodujo Gabriel.
    elements.toggleButton.click();
    await flushAsync();
    expect(start).toHaveBeenCalledTimes(1);

    setPolledStatus({ state: "recording", startedAtWall: 0, eventsCount: 0 });
    await tick();

    expect(elements.statusLabel.textContent).toBe("● Grabando");
    expect(elements.toggleButton.textContent).toBe("Detener");
  });

  it("Detener: la etiqueta vuelve a Inactivo sin cerrar el popup", async () => {
    const elements = buildElements();
    const recording: PopupStatus = { state: "recording", startedAtWall: 0, eventsCount: 2 };
    const { client, stop, setPolledStatus } = fakeClient(recording);
    const { setIntervalFn, tick } = fakePollTimer();
    mount({ client, elements, setIntervalFn, diagnostics: fakeDiagnostics() });
    await flushAsync();
    expect(elements.statusLabel.textContent).toBe("● Grabando");

    elements.toggleButton.click();
    await flushAsync();
    expect(stop).toHaveBeenCalledTimes(1);

    setPolledStatus({ state: "idle", startedAtWall: null, eventsCount: 0 });
    await tick();

    expect(elements.statusLabel.textContent).toBe("Inactivo");
    expect(elements.toggleButton.textContent).toBe("Grabar");
  });

  it("la franja de diagnóstico (daemon/mic/pestaña) se refresca en el mismo poll", async () => {
    const elements = buildElements();
    const { client } = fakeClient(IDLE_STATUS);
    const getDaemonStatus = vi.fn().mockResolvedValueOnce("no_corre").mockResolvedValue("conectado");
    const { setIntervalFn, tick } = fakePollTimer();
    mount({ client, elements, setIntervalFn, diagnostics: fakeDiagnostics({ getDaemonStatus }) });
    await flushAsync();
    expect(elements.daemonStatusLabel.textContent).toBe("Daemon: no responde");

    await tick();

    expect(elements.daemonStatusLabel.textContent).toBe("Daemon: conectado");
  });

  it("un error real mostrado por un comando no desaparece en el siguiente tick del poll", async () => {
    const elements = buildElements();
    const { client, start, setPolledStatus } = fakeClient(IDLE_STATUS);
    start.mockResolvedValue({ ok: false, error: "[qua] sin token: emparejá primero desde options." });
    const { setIntervalFn, tick } = fakePollTimer();
    mount({ client, elements, setIntervalFn, diagnostics: fakeDiagnostics() });
    await flushAsync();

    elements.toggleButton.click();
    await flushAsync();
    expect(elements.errorBanner.hidden).toBe(false);

    // El poll sigue viendo `idle` (start() nunca llegó a tocar la FSM) — el error
    // tiene que seguir visible hasta que el usuario reintente, no borrarse solo.
    setPolledStatus(IDLE_STATUS);
    await tick();

    expect(elements.errorBanner.hidden).toBe(false);
    expect(elements.errorBanner.textContent).toBe("[qua] sin token: emparejá primero desde options.");
  });
});

describe("startPopupController — transcript en vivo", () => {
  it("agrega cada utterance de transcript.partial al final", () => {
    const elements = buildElements();
    const { client, emitTranscript } = fakeClient(IDLE_STATUS);
    mount({ client, elements });

    emitTranscript({ text: "primera línea" } as Utterance);
    emitTranscript({ text: "segunda línea" } as Utterance);

    const lines = [...elements.transcript.children].map((el) => el.textContent);
    expect(lines).toEqual(["primera línea", "segunda línea"]);
  });

  it("recorta a maxTranscriptLines, descartando lo más viejo", () => {
    const elements = buildElements();
    const { client, emitTranscript } = fakeClient(IDLE_STATUS);
    mount({ client, elements, maxTranscriptLines: 2 });

    emitTranscript({ text: "a" } as Utterance);
    emitTranscript({ text: "b" } as Utterance);
    emitTranscript({ text: "c" } as Utterance);

    const lines = [...elements.transcript.children].map((el) => el.textContent);
    expect(lines).toEqual(["b", "c"]);
  });
});

describe("startPopupController — teardown", () => {
  it("el teardown saca los listeners de click y para el poll", () => {
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
    mount({ client, elements, diagnostics: fakeDiagnostics() });

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
    mount({ client, elements, diagnostics: fakeDiagnostics() });

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
    mount({ client, elements, diagnostics: fakeDiagnostics() });

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
    mount({ client, elements, diagnostics });
    await flushAsync();

    expect(elements.contentScriptStatusLabel.textContent).toBe("Pestaña: recargá para grabar");
    expect(elements.reloadTabButton.hidden).toBe(false);
  });

  it("con content script inyectado: el botón de recargar queda oculto", async () => {
    const elements = buildElements();
    const { client } = fakeClient(IDLE_STATUS);
    mount({ client, elements, diagnostics: fakeDiagnostics() });
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
    mount({ client, elements, diagnostics });
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
    mount({ client, elements, diagnostics });
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
    mount({ client, elements });
    await flushAsync();

    expect(elements.daemonStatusLabel.textContent).toBe("");
  });
});
