import { describe, expect, it, vi } from "vitest";
import {
  checkContentScript,
  getDaemonDiagnosis,
  reloadActiveTab,
  type ActiveTabRef,
} from "./diagnostics.js";
import type { PopupStatus } from "./messages.js";
import { IDLE_STATUS } from "./status-client.js";

function fakeClient(status: PopupStatus) {
  return { getStatus: vi.fn().mockResolvedValue(status) };
}

describe("getDaemonDiagnosis", () => {
  it("sin token guardado: sin_emparejar", async () => {
    const client = fakeClient({ ...IDLE_STATUS, paired: false, wsStatus: "disconnected" });
    expect(await getDaemonDiagnosis(client)).toBe("sin_emparejar");
  });

  it("con token pero el WS no está conectado: no_corre (daemon caído o rechazando)", async () => {
    const client = fakeClient({ ...IDLE_STATUS, paired: true, wsStatus: "connecting" });
    expect(await getDaemonDiagnosis(client)).toBe("no_corre");
  });

  it("con token y WS conectado: conectado", async () => {
    const client = fakeClient({ ...IDLE_STATUS, paired: true, wsStatus: "connected" });
    expect(await getDaemonDiagnosis(client)).toBe("conectado");
  });

  it("si getStatus() trae lastError (no se pudo ni preguntar): no_corre, no sin_emparejar", async () => {
    const client = fakeClient({ ...IDLE_STATUS, lastError: "[qua] el service worker no responde: boom" });
    expect(await getDaemonDiagnosis(client)).toBe("no_corre");
  });

  it("los tres estados posibles son mensajes distintos entre sí", async () => {
    const sinToken = await getDaemonDiagnosis(fakeClient({ ...IDLE_STATUS, paired: false }));
    const noCorre = await getDaemonDiagnosis(fakeClient({ ...IDLE_STATUS, paired: true, wsStatus: "disconnected" }));
    const conectado = await getDaemonDiagnosis(fakeClient({ ...IDLE_STATUS, paired: true, wsStatus: "connected" }));
    expect(new Set([sinToken, noCorre, conectado]).size).toBe(3);
  });
});

describe("checkContentScript", () => {
  it("sin pestaña activa conocida: desconocido", async () => {
    const result = await checkContentScript({ queryActiveTab: () => Promise.resolve(undefined) });
    expect(result).toBe("desconocido");
  });

  it("el content script responde al ping: inyectado", async () => {
    const sendMessageToTab = vi.fn().mockResolvedValue({ type: "qua:pong" });
    const result = await checkContentScript({
      queryActiveTab: () => Promise.resolve({ id: 7 } as ActiveTabRef),
      sendMessageToTab,
    });
    expect(result).toBe("inyectado");
    expect(sendMessageToTab).toHaveBeenCalledWith(7, { type: "qua:ping" });
  });

  it("sin nadie del otro lado (pestaña abierta antes de instalar la extensión): hace_falta_recargar", async () => {
    const sendMessageToTab = vi.fn().mockRejectedValue(new Error("Could not establish connection."));
    const result = await checkContentScript({
      queryActiveTab: () => Promise.resolve({ id: 7 } as ActiveTabRef),
      sendMessageToTab,
    });
    expect(result).toBe("hace_falta_recargar");
  });
});

describe("reloadActiveTab", () => {
  it("recarga la pestaña activa", async () => {
    const reloadTab = vi.fn().mockResolvedValue(undefined);
    await reloadActiveTab({ queryActiveTab: () => Promise.resolve({ id: 42 } as ActiveTabRef), reloadTab });
    expect(reloadTab).toHaveBeenCalledWith(42);
  });

  it("no hace nada si no hay pestaña activa", async () => {
    const reloadTab = vi.fn();
    await reloadActiveTab({ queryActiveTab: () => Promise.resolve(undefined), reloadTab });
    expect(reloadTab).not.toHaveBeenCalled();
  });
});
