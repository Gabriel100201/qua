import { describe, expect, it } from "vitest";
import { formatDuration } from "./format.js";

describe("formatDuration", () => {
  it("formatea segundos y minutos con padding a 2 dígitos", () => {
    expect(formatDuration(0)).toBe("00:00");
    expect(formatDuration(1000)).toBe("00:01");
    expect(formatDuration(65_000)).toBe("01:05");
    expect(formatDuration(59_000)).toBe("00:59");
    expect(formatDuration(600_000)).toBe("10:00");
  });

  it("agrega horas cuando la duración las supera", () => {
    expect(formatDuration(3_600_000)).toBe("01:00:00");
    expect(formatDuration(3_661_000)).toBe("01:01:01");
  });

  it("nunca es negativo", () => {
    expect(formatDuration(-5000)).toBe("00:00");
  });

  it("trunca milisegundos parciales", () => {
    expect(formatDuration(1999)).toBe("00:01");
  });
});
