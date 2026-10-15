import { describe, expect, it } from "vitest";
import { processingLabel, processingProgress } from "./overlay-protocol.js";

describe("pastilla: procesando", () => {
  it("texto por etapa", () => {
    expect(processingLabel({ stage: "transcripcion", done: 12, total: 34 })).toBe("Transcribiendo 12 de 34");
    expect(processingLabel({ stage: "modelo", done: 1, total: 4 })).toBe("Bajando el modelo 25 %");
  });
  it("avance total: voz, texto y reporte son tercios, como el anillo", () => {
    expect(processingProgress({ stage: "voz", done: 1, total: 1 })).toBeCloseTo(1 / 3);
    expect(processingProgress({ stage: "transcripcion", done: 17, total: 34 })).toBeCloseTo(0.5);
    expect(processingProgress({ stage: "reporte", done: 1, total: 1 })).toBeCloseTo(1);
  });
});
