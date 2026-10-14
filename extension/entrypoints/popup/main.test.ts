import { describe, expect, it, vi } from "vitest";
import { startQuaPopup } from "./main.js";
import { TOKEN_STORAGE_KEY } from "../../shared/storage-keys.js";

/**
 * Integración del popup completo. En el modo local (D-L1-01) no hay daemon ni
 * pairing: con o sin token, el popup abre directo en la UI de grabación.
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
      <div id="qua-error" hidden></div>
      <span id="qua-daemon-status"></span>
      <span id="qua-mic-status"></span>
      <span id="qua-content-script-status"></span>
      <button id="qua-reload-tab" hidden></button>
      <button id="qua-toggle"></button>
      <button id="qua-mark" disabled></button>
      <span id="qua-status"></span>
      <span id="qua-duration"></span>
      <span id="qua-events-count"></span>
      <div id="qua-transcript"></div>
    </div>
  `;
}

describe("startQuaPopup — modo local (D-L1-01)", () => {
  it("sin token va directo a la UI de grabación y nunca le pregunta nada al daemon", async () => {
    buildDom();
    const storage = { get: vi.fn().mockResolvedValue({}), set: vi.fn() };
    const isDaemonRunningFn = vi.fn().mockResolvedValue(false);

    startQuaPopup(document, { connectionDeps: { storage }, isDaemonRunningFn });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(document.getElementById("qua-main")!.hidden).toBe(false);
    expect(document.getElementById("qua-connect")!.hidden).toBe(true);
    expect(isDaemonRunningFn).not.toHaveBeenCalled();
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
