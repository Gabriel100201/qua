import { describe, expect, it, vi } from "vitest";
import { startQuaPopup } from "./main.js";
import { TOKEN_STORAGE_KEY } from "../../shared/storage-keys.js";

/**
 * Integración del popup completo (D-U1-01): antes de esto, sin token, el
 * popup mostraba "Grabar" igual y se tragaba el error en silencio al hacer
 * click (ver `docs/DECISIONS.md`, bug de `TOKEN_STORAGE_KEY`). Ahora sin
 * token muestra "Conectar", y si el daemon está caído lo dice con esas
 * palabras.
 */
function buildDom(): void {
  document.body.innerHTML = `
    <div id="qua-connect" hidden>
      <p id="qua-connect-title"></p>
      <p id="qua-connect-message"></p>
      <div id="qua-connect-command-row" hidden>
        <code id="qua-connect-command"></code>
        <button id="qua-connect-copy"></button>
      </div>
      <button id="qua-connect-button"></button>
      <button id="qua-connect-options" hidden></button>
    </div>
    <div id="qua-main" hidden>
      <button id="qua-toggle"></button>
      <button id="qua-mark" disabled></button>
      <span id="qua-status"></span>
      <span id="qua-duration"></span>
      <span id="qua-events-count"></span>
      <div id="qua-transcript"></div>
    </div>
  `;
}

describe("startQuaPopup — sin token", () => {
  it("muestra el estado 'Sin conectar al daemon' con el botón Conectar, y no la UI de grabación", async () => {
    buildDom();
    const storage = { get: vi.fn().mockResolvedValue({}), set: vi.fn() };
    const isDaemonRunningFn = vi.fn().mockResolvedValue(true);

    startQuaPopup(document, { connectionDeps: { storage }, isDaemonRunningFn });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(document.getElementById("qua-connect")!.hidden).toBe(false);
    expect(document.getElementById("qua-main")!.hidden).toBe(true);
    expect(document.getElementById("qua-connect-title")!.textContent).toBe("Sin conectar al daemon");
    expect((document.getElementById("qua-connect-button") as HTMLButtonElement).hidden).toBe(false);
  });

  it("con el daemon caído, dice 'El daemon no está corriendo' con el comando para levantarlo", async () => {
    buildDom();
    const storage = { get: vi.fn().mockResolvedValue({}), set: vi.fn() };
    const isDaemonRunningFn = vi.fn().mockResolvedValue(false);

    startQuaPopup(document, { connectionDeps: { storage }, isDaemonRunningFn });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(document.getElementById("qua-connect-title")!.textContent).toBe("El daemon no está corriendo");
    expect(document.getElementById("qua-connect-command")!.textContent).toBe("./target/release/quad");
    expect((document.getElementById("qua-connect-command-row") as HTMLElement).hidden).toBe(false);
  });

  it("un click en Conectar empareja y pasa a la UI de grabación normal", async () => {
    buildDom();
    const storage = { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) };
    const isDaemonRunningFn = vi.fn().mockResolvedValue(true);
    const autoPairFn = vi.fn().mockResolvedValue({ ok: true, response: { token: "a".repeat(64), daemon_version: "0.1.0" } });

    startQuaPopup(document, { connectionDeps: { storage }, isDaemonRunningFn, autoPairFn });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    (document.getElementById("qua-connect-button") as HTMLButtonElement).click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(document.getElementById("qua-connect")!.hidden).toBe(true);
    expect(document.getElementById("qua-main")!.hidden).toBe(false);
  });
});

describe("startQuaPopup — con token", () => {
  it("muestra directamente la UI de grabación, sin pasar por el estado de conexión", async () => {
    buildDom();
    const storage = { get: vi.fn().mockResolvedValue({ [TOKEN_STORAGE_KEY]: "a".repeat(64) }), set: vi.fn() };
    const isDaemonRunningFn = vi.fn();

    startQuaPopup(document, { connectionDeps: { storage }, isDaemonRunningFn });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(document.getElementById("qua-main")!.hidden).toBe(false);
    expect(document.getElementById("qua-connect")!.hidden).toBe(true);
    expect(isDaemonRunningFn).not.toHaveBeenCalled();
  });
});
