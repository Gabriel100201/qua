import { describe, expect, it, vi } from "vitest";
import { startConnectController, type ConnectElements } from "./connect-controller.js";
import { START_DAEMON_COMMAND } from "./connection.js";

function buildElements(): ConnectElements {
  document.body.innerHTML = `
    <div id="container">
      <p id="title"></p>
      <p id="message"></p>
      <div id="command-row" hidden>
        <code id="command"></code>
        <button id="copy"></button>
      </div>
      <button id="connect"></button>
      <button id="open-options" hidden></button>
    </div>
  `;
  return {
    container: document.getElementById("container")!,
    title: document.getElementById("title")!,
    message: document.getElementById("message")!,
    connectButton: document.getElementById("connect") as HTMLButtonElement,
    commandRow: document.getElementById("command-row")!,
    commandText: document.getElementById("command")!,
    copyButton: document.getElementById("copy") as HTMLButtonElement,
    openOptionsButton: document.getElementById("open-options") as HTMLButtonElement,
  };
}

describe("startConnectController — chequeo inicial", () => {
  it("con el daemon corriendo, muestra 'Sin conectar al daemon' y el botón Conectar", async () => {
    const elements = buildElements();
    const isDaemonRunningFn = vi.fn().mockResolvedValue(true);
    startConnectController({ elements, onConnected: vi.fn(), isDaemonRunningFn });

    await Promise.resolve();
    await Promise.resolve();

    expect(elements.title.textContent).toBe("Sin conectar al daemon");
    expect(elements.connectButton.hidden).toBe(false);
    expect(elements.commandRow.hidden).toBe(true);
  });

  it("con el daemon caído, dice 'El daemon no está corriendo' y muestra el comando copiable", async () => {
    const elements = buildElements();
    const isDaemonRunningFn = vi.fn().mockResolvedValue(false);
    startConnectController({ elements, onConnected: vi.fn(), isDaemonRunningFn });

    await Promise.resolve();
    await Promise.resolve();

    expect(elements.title.textContent).toBe("El daemon no está corriendo");
    expect(elements.commandRow.hidden).toBe(false);
    expect(elements.commandText.textContent).toBe(START_DAEMON_COMMAND);
  });
});

describe("startConnectController — click en Conectar", () => {
  it("con éxito, llama a onConnected", async () => {
    const elements = buildElements();
    const isDaemonRunningFn = vi.fn().mockResolvedValue(true);
    const autoPairFn = vi.fn().mockResolvedValue({ ok: true, response: { token: "t", daemon_version: "0.1.0" } });
    const onConnected = vi.fn();

    startConnectController({ elements, onConnected, isDaemonRunningFn, autoPairFn });
    await Promise.resolve();
    await Promise.resolve();

    elements.connectButton.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(autoPairFn).toHaveBeenCalledTimes(1);
    expect(onConnected).toHaveBeenCalledTimes(1);
  });

  it("si el daemon se cae justo al conectar, muestra el mensaje de daemon caído", async () => {
    const elements = buildElements();
    const isDaemonRunningFn = vi.fn().mockResolvedValue(true);
    const autoPairFn = vi.fn().mockResolvedValue({ ok: false, reason: "daemon_down" });

    startConnectController({ elements, onConnected: vi.fn(), isDaemonRunningFn, autoPairFn });
    await Promise.resolve();
    await Promise.resolve();

    elements.connectButton.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(elements.title.textContent).toBe("El daemon no está corriendo");
    expect(elements.commandRow.hidden).toBe(false);
  });

  it("con 409 (ya emparejado), ofrece abrir las opciones en vez de reintentar", async () => {
    const elements = buildElements();
    const isDaemonRunningFn = vi.fn().mockResolvedValue(true);
    const autoPairFn = vi.fn().mockResolvedValue({ ok: false, reason: "already_paired" });
    const openOptionsPage = vi.fn();

    startConnectController({ elements, onConnected: vi.fn(), isDaemonRunningFn, autoPairFn, openOptionsPage });
    await Promise.resolve();
    await Promise.resolve();

    elements.connectButton.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(elements.connectButton.hidden).toBe(true);
    expect(elements.openOptionsButton.hidden).toBe(false);

    elements.openOptionsButton.click();
    expect(openOptionsPage).toHaveBeenCalledTimes(1);
  });
});

describe("startConnectController — copiar comando", () => {
  it("copia START_DAEMON_COMMAND al portapapeles", async () => {
    const elements = buildElements();
    const isDaemonRunningFn = vi.fn().mockResolvedValue(false);
    const copyToClipboard = vi.fn().mockResolvedValue(undefined);

    startConnectController({ elements, onConnected: vi.fn(), isDaemonRunningFn, copyToClipboard });
    await Promise.resolve();
    await Promise.resolve();

    elements.copyButton.click();
    await Promise.resolve();

    expect(copyToClipboard).toHaveBeenCalledWith(START_DAEMON_COMMAND);
  });
});

describe("startConnectController — teardown", () => {
  it("saca los listeners", async () => {
    const elements = buildElements();
    const isDaemonRunningFn = vi.fn().mockResolvedValue(true);
    const autoPairFn = vi.fn().mockResolvedValue({ ok: true, response: { token: "t", daemon_version: "0.1.0" } });
    const onConnected = vi.fn();

    const teardown = startConnectController({ elements, onConnected, isDaemonRunningFn, autoPairFn });
    await Promise.resolve();
    await Promise.resolve();

    teardown();
    elements.connectButton.click();
    await Promise.resolve();

    expect(autoPairFn).not.toHaveBeenCalled();
  });
});
