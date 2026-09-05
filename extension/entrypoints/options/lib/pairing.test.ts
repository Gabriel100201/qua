import { describe, expect, it, vi } from "vitest";
import { isValidPairCode, pair, PAIR_TOKEN_STORAGE_KEY } from "./pairing.js";

const VALID_TOKEN = "a".repeat(64);

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe("isValidPairCode", () => {
  it("acepta exactamente 6 dígitos", () => {
    expect(isValidPairCode("123456")).toBe(true);
  });

  it("rechaza cualquier otra cosa", () => {
    expect(isValidPairCode("12345")).toBe(false);
    expect(isValidPairCode("1234567")).toBe(false);
    expect(isValidPairCode("abcdef")).toBe(false);
    expect(isValidPairCode("")).toBe(false);
  });
});

describe("pair", () => {
  it("rechaza códigos inválidos sin llamar a fetch", async () => {
    const fetchFn = vi.fn();
    const result = await pair("12", { fetchFn });
    expect(result).toEqual({ ok: false, error: "El código tiene que tener 6 dígitos." });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("hace POST a 127.0.0.1:<puerto>/pair con el código, y guarda el token", async () => {
    const response = { token: VALID_TOKEN, daemon_version: "0.1.0" };
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(response));
    const set = vi.fn().mockResolvedValue(undefined);

    const result = await pair("482913", { fetchFn, storage: { set } });

    expect(fetchFn).toHaveBeenCalledWith(
      "http://127.0.0.1:7331/pair",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "482913" }),
      }),
    );
    expect(set).toHaveBeenCalledWith({ [PAIR_TOKEN_STORAGE_KEY]: VALID_TOKEN });
    expect(result).toEqual({ ok: true, response });
  });

  it("respeta un puerto custom", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ token: VALID_TOKEN, daemon_version: "0.1.0" }));
    await pair("111111", { fetchFn, port: 9999, storage: { set: vi.fn() } });
    expect(fetchFn).toHaveBeenCalledWith("http://127.0.0.1:9999/pair", expect.anything());
  });

  it("si el daemon no está corriendo (fetch rechaza), devuelve un error legible", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const result = await pair("123456", { fetchFn });
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toContain("ECONNREFUSED");
  });

  it("si el daemon responde con error HTTP, no guarda nada", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ code: "bad_message", message: "código incorrecto" }, false, 401));
    const set = vi.fn();
    const result = await pair("123456", { fetchFn, storage: { set } });
    expect(result).toEqual({ ok: false, error: "El daemon rechazó el pairing (HTTP 401)." });
    expect(set).not.toHaveBeenCalled();
  });

  it("si la respuesta no cumple PairResponseSchema, falla sin guardar nada", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ token: "no-es-hex" }));
    const set = vi.fn();
    const result = await pair("123456", { fetchFn, storage: { set } });
    expect(result.ok).toBe(false);
    expect(set).not.toHaveBeenCalled();
  });

  it("funciona sin storage inyectado (ej. fuera de una extensión real) sin tirar", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ token: VALID_TOKEN, daemon_version: "0.1.0" }));
    const result = await pair("123456", { fetchFn });
    expect(result.ok).toBe(true);
  });
});
