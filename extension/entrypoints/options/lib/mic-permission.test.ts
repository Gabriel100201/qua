import { describe, expect, it, vi } from "vitest";
import { checkMicPermission, grantMicPermission } from "./mic-permission.js";
import { MIC_CONSTRAINTS } from "../../offscreen/lib/audio-capture.js";

describe("grantMicPermission", () => {
  it("pide getUserMedia con las constraints exactas de §5.4 y suelta el track al confirmar", async () => {
    const stop = vi.fn();
    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] } as unknown as MediaStream);

    const result = await grantMicPermission({ getUserMedia });

    expect(getUserMedia).toHaveBeenCalledWith(MIC_CONSTRAINTS);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true });
  });

  it("suelta todos los tracks si hay más de uno", async () => {
    const stopA = vi.fn();
    const stopB = vi.fn();
    const getUserMedia = vi
      .fn()
      .mockResolvedValue({ getTracks: () => [{ stop: stopA }, { stop: stopB }] } as unknown as MediaStream);

    await grantMicPermission({ getUserMedia });

    expect(stopA).toHaveBeenCalledTimes(1);
    expect(stopB).toHaveBeenCalledTimes(1);
  });

  it("si el usuario rechaza el permiso, devuelve ok:false con el motivo", async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new Error("Permission denied"));
    const result = await grantMicPermission({ getUserMedia });
    expect(result).toEqual({ ok: false, message: "Permission denied" });
  });
});

describe("checkMicPermission", () => {
  it("devuelve el estado que reporta el navegador", async () => {
    const queryPermission = vi.fn().mockResolvedValue({ state: "granted" });
    expect(await checkMicPermission({ queryPermission })).toBe("granted");
    expect(queryPermission).toHaveBeenCalledWith("microphone");
  });

  it("degrada a unknown si el navegador no soporta la consulta", async () => {
    const queryPermission = vi.fn().mockRejectedValue(new Error("not supported"));
    expect(await checkMicPermission({ queryPermission })).toBe("unknown");
  });
});
