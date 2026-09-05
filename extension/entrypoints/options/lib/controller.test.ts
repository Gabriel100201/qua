import { describe, expect, it, vi } from "vitest";
import { startOnboardingController, type OnboardingElements } from "./controller.js";

function buildElements(): OnboardingElements {
  document.body.innerHTML = `
    <span id="mic-status"></span>
    <button id="mic-button"></button>
    <span id="mic-message"></span>
    <form id="pair-form"><input id="pair-input" /><button id="pair-button" type="submit"></button></form>
    <span id="pair-message"></span>
  `;
  return {
    micStatus: document.getElementById("mic-status")!,
    micButton: document.getElementById("mic-button") as HTMLButtonElement,
    micMessage: document.getElementById("mic-message")!,
    pairForm: document.getElementById("pair-form") as HTMLFormElement,
    pairInput: document.getElementById("pair-input") as HTMLInputElement,
    pairButton: document.getElementById("pair-button") as HTMLButtonElement,
    pairMessage: document.getElementById("pair-message")!,
  };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("startOnboardingController — micrófono", () => {
  it("al iniciar, consulta el estado y lo pinta, deshabilitando el botón si ya está concedido", async () => {
    const elements = buildElements();
    const checkMic = vi.fn().mockResolvedValue("granted");
    startOnboardingController({ elements, checkMic });
    await flush();

    expect(elements.micStatus.textContent).toContain("Concedido");
    expect(elements.micButton.disabled).toBe(true);
  });

  it("degrada a 'Desconocido' si checkMic tira", async () => {
    const elements = buildElements();
    const checkMic = vi.fn().mockRejectedValue(new Error("nope"));
    startOnboardingController({ elements, checkMic });
    await flush();
    expect(elements.micStatus.textContent).toContain("Desconocido");
  });

  it("click en el botón dispara el grant real y, si funciona, actualiza el estado", async () => {
    const elements = buildElements();
    const checkMic = vi.fn().mockResolvedValue("prompt");
    const grantMic = vi.fn().mockResolvedValue({ ok: true });
    startOnboardingController({ elements, checkMic, grantMic });
    await flush();

    elements.micButton.click();
    await flush();

    expect(grantMic).toHaveBeenCalledTimes(1);
    expect(elements.micStatus.textContent).toContain("Concedido");
    expect(elements.micButton.disabled).toBe(true);
  });

  it("si el usuario rechaza el permiso, muestra el motivo y reactiva el botón para reintentar", async () => {
    const elements = buildElements();
    const checkMic = vi.fn().mockResolvedValue("prompt");
    const grantMic = vi.fn().mockResolvedValue({ ok: false, message: "Permission denied" });
    startOnboardingController({ elements, checkMic, grantMic });
    await flush();

    elements.micButton.click();
    await flush();

    expect(elements.micMessage.textContent).toContain("Permission denied");
    expect(elements.micButton.disabled).toBe(false);
  });
});

describe("startOnboardingController — pairing", () => {
  it("al mandar el form, llama a pairFn con el código y muestra éxito con la versión del daemon", async () => {
    const elements = buildElements();
    elements.pairInput.value = "482913";
    const pairFn = vi.fn().mockResolvedValue({ ok: true, response: { token: "x", daemon_version: "0.1.0" } });
    startOnboardingController({ elements, checkMic: vi.fn().mockResolvedValue("unknown"), pairFn });

    elements.pairForm.dispatchEvent(new Event("submit", { cancelable: true }));
    await flush();

    expect(pairFn).toHaveBeenCalledWith("482913", undefined);
    expect(elements.pairMessage.textContent).toContain("0.1.0");
    expect(elements.pairInput.value).toBe("");
    expect(elements.pairButton.disabled).toBe(false);
  });

  it("recorta espacios del código antes de mandarlo", async () => {
    const elements = buildElements();
    elements.pairInput.value = "  482913  ";
    const pairFn = vi.fn().mockResolvedValue({ ok: true, response: { token: "x", daemon_version: "0.1.0" } });
    startOnboardingController({ elements, checkMic: vi.fn().mockResolvedValue("unknown"), pairFn });

    elements.pairForm.dispatchEvent(new Event("submit", { cancelable: true }));
    await flush();

    expect(pairFn).toHaveBeenCalledWith("482913", undefined);
  });

  it("si el pairing falla, muestra el error y conserva el código para reintentar", async () => {
    const elements = buildElements();
    elements.pairInput.value = "000000";
    const pairFn = vi.fn().mockResolvedValue({ ok: false, error: "código incorrecto" });
    startOnboardingController({ elements, checkMic: vi.fn().mockResolvedValue("unknown"), pairFn });

    elements.pairForm.dispatchEvent(new Event("submit", { cancelable: true }));
    await flush();

    expect(elements.pairMessage.textContent).toBe("código incorrecto");
    expect(elements.pairInput.value).toBe("000000");
  });

  it("previene el submit por defecto del form (no navega)", async () => {
    const elements = buildElements();
    const pairFn = vi.fn().mockResolvedValue({ ok: true, response: { token: "x", daemon_version: "0.1.0" } });
    startOnboardingController({ elements, checkMic: vi.fn().mockResolvedValue("unknown"), pairFn });

    const event = new Event("submit", { cancelable: true });
    elements.pairForm.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});

describe("startOnboardingController — teardown", () => {
  it("el teardown saca los listeners", async () => {
    const elements = buildElements();
    const grantMic = vi.fn().mockResolvedValue({ ok: true });
    const teardown = startOnboardingController({
      elements,
      checkMic: vi.fn().mockResolvedValue("prompt"),
      grantMic,
    });
    await flush();

    teardown();
    elements.micButton.click();
    await flush();
    expect(grantMic).not.toHaveBeenCalled();
  });
});
