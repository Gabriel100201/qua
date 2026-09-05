import { describe, expect, it, vi } from "vitest";
import { createCollectingEmit, createEmit } from "./emit.js";

describe("createEmit", () => {
  it("deja pasar un evento válido al sink", () => {
    const { emit, events } = createCollectingEmit();
    emit({ t: 1, k: "mark", source: "hotkey" });
    expect(events).toEqual([{ t: 1, k: "mark", source: "hotkey" }]);
  });

  it("descarta un evento inválido sin tirar", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { emit, events } = createCollectingEmit();
    // @ts-expect-error — evento deliberadamente mal formado para el test
    expect(() => emit({ t: 1, k: "no-existe" })).not.toThrow();
    expect(events).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("un sink que tira nunca propaga la excepción", () => {
    const emit = createEmit(() => {
      throw new Error("boom");
    });
    expect(() => emit({ t: 1, k: "mark", source: "popup" })).not.toThrow();
  });
});
