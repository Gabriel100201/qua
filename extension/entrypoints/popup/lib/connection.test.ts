import { describe, expect, it, vi } from "vitest";
import { autoPair, getStoredToken, isDaemonRunning, START_DAEMON_COMMAND } from "./connection.js";
import { TOKEN_STORAGE_KEY } from "../../../shared/storage-keys.js";

const VALID_TOKEN = "a".repeat(64);

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(body) } as unknown as Response;
}

describe("START_DAEMON_COMMAND", () => {
  it("es el comando real del README para levantar el daemon a mano", () => {
    expect(START_DAEMON_COMMAND).toBe("./target/release/quad");
  });
});

describe("getStoredToken", () => {
  it("devuelve undefined sin storage inyectado y sin chrome real", async () => {
    expect(await getStoredToken()).toBeUndefined();
  });

  it("lee TOKEN_STORAGE_KEY del storage inyectado", async () => {
    const get = vi.fn().mockResolvedValue({ [TOKEN_STORAGE_KEY]: VALID_TOKEN });
    const token = await getStoredToken({ storage: { get, set: vi.fn() } });
    expect(get).toHaveBeenCalledWith(TOKEN_STORAGE_KEY);
    expect(token).toBe(VALID_TOKEN);
  });
});

describe("isDaemonRunning", () => {
  it("true si /health responde ok", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true } as Response);
    expect(await isDaemonRunning({ fetchFn })).toBe(true);
    expect(fetchFn).toHaveBeenCalledWith("http://127.0.0.1:7331/health", { method: "GET" });
  });

  it("false si /health responde con error HTTP", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false } as Response);
    expect(await isDaemonRunning({ fetchFn })).toBe(false);
  });

  it("false si fetch rechaza (daemon no está corriendo)", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    expect(await isDaemonRunning({ fetchFn })).toBe(false);
  });

  it("respeta un puerto custom", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true } as Response);
    await isDaemonRunning({ fetchFn, port: 9999 });
    expect(fetchFn).toHaveBeenCalledWith("http://127.0.0.1:9999/health", { method: "GET" });
  });
});

describe("autoPair", () => {
  it("hace POST a /pair/auto sin código y guarda el token", async () => {
    const response = { token: VALID_TOKEN, daemon_version: "0.1.0" };
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(response));
    const set = vi.fn().mockResolvedValue(undefined);

    const result = await autoPair({ fetchFn, storage: { get: vi.fn(), set } });

    expect(fetchFn).toHaveBeenCalledWith("http://127.0.0.1:7331/pair/auto", { method: "POST" });
    expect(set).toHaveBeenCalledWith({ [TOKEN_STORAGE_KEY]: VALID_TOKEN });
    expect(result).toEqual({ ok: true, response });
  });

  it("si el daemon no está corriendo (fetch rechaza), devuelve reason daemon_down", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const result = await autoPair({ fetchFn });
    expect(result).toEqual({ ok: false, reason: "daemon_down" });
  });

  it("con 409 (ya hay una extensión emparejada), devuelve reason already_paired", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ code: "already_paired", message: "..." }, false, 409));
    const result = await autoPair({ fetchFn });
    expect(result).toEqual({ ok: false, reason: "already_paired" });
  });

  it("con otro error HTTP, devuelve reason other con mensaje", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({}, false, 500));
    const result = await autoPair({ fetchFn });
    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toBe("other");
  });

  it("si la respuesta no cumple PairResponseSchema, falla sin guardar nada", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ token: "no-es-hex" }));
    const set = vi.fn();
    const result = await autoPair({ fetchFn, storage: { get: vi.fn(), set } });
    expect(result.ok).toBe(false);
    expect(set).not.toHaveBeenCalled();
  });

  it("funciona sin storage inyectado sin tirar", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ token: VALID_TOKEN, daemon_version: "0.1.0" }));
    const result = await autoPair({ fetchFn });
    expect(result.ok).toBe(true);
  });
});
