import { checkMicPermission, grantMicPermission, type MicPermissionState } from "./mic-permission.js";
import { pair, type PairingDeps } from "./pairing.js";

export interface OnboardingElements {
  micStatus: HTMLElement;
  micButton: HTMLButtonElement;
  micMessage: HTMLElement;
  pairForm: HTMLFormElement;
  pairInput: HTMLInputElement;
  pairButton: HTMLButtonElement;
  pairMessage: HTMLElement;
}

export interface OnboardingControllerOptions {
  elements: OnboardingElements;
  checkMic?: typeof checkMicPermission;
  grantMic?: typeof grantMicPermission;
  pairFn?: typeof pair;
  pairDeps?: PairingDeps;
}

const MIC_STATUS_LABELS: Record<MicPermissionState, string> = {
  granted: "Concedido ✓",
  denied: "Rechazado — revisalo en la configuración del navegador",
  prompt: "Pendiente",
  unknown: "Desconocido",
};

export type Teardown = () => void;

/**
 * Cablea options.html (§5.4): el paso crítico del grant de micrófono (el
 * offscreen doc no puede pedirlo — bloque "⚠️ CUIDADO" de §5.4) y el pairing
 * de 6 dígitos contra `POST /pair` (§04).
 */
export function startOnboardingController(opts: OnboardingControllerOptions): Teardown {
  const { elements } = opts;
  const checkMic = opts.checkMic ?? checkMicPermission;
  const grantMic = opts.grantMic ?? grantMicPermission;
  const pairFn = opts.pairFn ?? pair;

  function renderMicStatus(state: MicPermissionState): void {
    elements.micStatus.textContent = MIC_STATUS_LABELS[state];
    elements.micButton.disabled = state === "granted";
  }

  async function onMicButtonClick(): Promise<void> {
    elements.micButton.disabled = true;
    elements.micMessage.textContent = "";
    const result = await grantMic();
    if (result.ok) {
      renderMicStatus("granted");
    } else {
      elements.micButton.disabled = false;
      elements.micMessage.textContent = `No se pudo dar el permiso: ${result.message ?? "motivo desconocido"}.`;
    }
  }

  async function onPairSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const code = elements.pairInput.value.trim();
    elements.pairButton.disabled = true;
    elements.pairMessage.textContent = "Conectando…";

    const result = await pairFn(code, opts.pairDeps);
    elements.pairButton.disabled = false;

    if (result.ok) {
      elements.pairMessage.textContent = `Conectado — daemon ${result.response.daemon_version}.`;
      elements.pairInput.value = "";
    } else {
      elements.pairMessage.textContent = result.error;
    }
  }

  const handleMicClick = () => void onMicButtonClick();
  const handlePairSubmit = (event: Event) => void onPairSubmit(event as SubmitEvent);

  elements.micButton.addEventListener("click", handleMicClick);
  elements.pairForm.addEventListener("submit", handlePairSubmit);

  checkMic()
    .then(renderMicStatus)
    .catch(() => renderMicStatus("unknown"));

  return () => {
    elements.micButton.removeEventListener("click", handleMicClick);
    elements.pairForm.removeEventListener("submit", handlePairSubmit);
  };
}
