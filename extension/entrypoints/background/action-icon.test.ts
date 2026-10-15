import { describe, expect, it } from "vitest";
import { draw, palette, type Ctx2D } from "./action-icon.js";

function fakeCtx() {
  const ops: string[] = [];
  const ctx: Ctx2D = {
    clearRect: () => ops.push("clear"), beginPath: () => undefined, arc: (_x, _y, _r, a0, a1) => ops.push(`arc ${(a1 - a0).toFixed(2)}`),
    stroke: () => ops.push(`stroke ${ctx.strokeStyle}`), fill: () => ops.push(`fill ${ctx.fillStyle}`), setLineDash: () => undefined,
    lineWidth: 1, lineCap: "round", strokeStyle: "", fillStyle: "",
  };
  return { ctx, ops };
}

describe("ícono de la barra", () => {
  it("grabando: punto rojo", () => {
    const { ctx, ops } = fakeCtx();
    draw(ctx, 16, { kind: "recording" });
    expect(ops).toContain("fill #E0352B");
  });
  it("inactivo: anillo y punto grafito; en modo oscuro, claros", () => {
    const a = fakeCtx(); draw(a.ctx, 16, { kind: "idle" });
    expect(a.ops).toContain(`fill ${palette(false).ink}`);
    const b = fakeCtx(); draw(b.ctx, 16, { kind: "idle" }, true);
    expect(b.ops).toContain(`fill ${palette(true).ink}`);
  });
  it("procesando: el arco crece con el avance", () => {
    const a = fakeCtx(); draw(a.ctx, 16, { kind: "processing", progress: 0.25 });
    expect(a.ops).toContain(`arc ${(Math.PI / 2).toFixed(2)}`);
  });
});
