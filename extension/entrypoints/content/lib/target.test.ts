import { describe, expect, it } from "vitest";
import { buildTargetRef } from "./target.js";
import { REDACTED } from "./redact.js";
import type { ComponentSourceResolver } from "./source-resolver.js";

describe("buildTargetRef (§03)", () => {
  it("arma un TargetRef con selector, rol, nombre y clases completas", () => {
    document.body.innerHTML = `
      <button data-testid="nuevo-turno" class="px-3 py-1.5 rounded-md bg-zinc-900 text-zinc-50">
        Nuevo turno
      </button>
    `;
    const button = document.querySelector("button")!;
    const target = buildTargetRef(button);

    expect(target.sel).toBe('[data-testid="nuevo-turno"]');
    expect(target.strategy).toBe("testid");
    expect(target.tag).toBe("button");
    expect(target.text).toBe("Nuevo turno");
    expect(target.role).toBe("button");
    expect(target.classes).toBe("px-3 py-1.5 rounded-md bg-zinc-900 text-zinc-50");
    expect(target.rect).toBeDefined();
  });

  it("redacta el texto y el nombre bajo un subárbol privado, conserva selector y geometría", () => {
    document.body.innerHTML = `<div data-private><button id="btn-privado">Diagnóstico: X</button></div>`;
    const button = document.getElementById("btn-privado")!;
    const target = buildTargetRef(button);

    expect(target.text).toBe(REDACTED);
    expect(target.name).toBe(REDACTED);
    expect(target.sel).toBe("#btn-privado");
    expect(target.rect).toBeDefined();
  });

  it("solo calcula computed style si withComputedStyle está prendido", () => {
    document.body.innerHTML = `<button id="b">x</button>`;
    const button = document.getElementById("b")!;
    expect(buildTargetRef(button).computed).toBeUndefined();
    expect(buildTargetRef(button, { withComputedStyle: true }).computed).toBeDefined();
  });

  it("usa el resolver de fuente inyectado para component/src (§11, vía @qua/source-resolver)", () => {
    document.body.innerHTML = `<button id="b">x</button>`;
    const button = document.getElementById("b")!;
    const resolver: ComponentSourceResolver = {
      resolve: () => ({ component: ["AgendaHeader", "Button"], src: { file: "src/x.tsx", line: 42, tier: 2 } }),
    };
    const target = buildTargetRef(button, { sourceResolver: resolver });
    expect(target.component).toEqual(["AgendaHeader", "Button"]);
    expect(target.src).toEqual({ file: "src/x.tsx", line: 42, tier: 2 });
  });

  it("sin resolver (stub de E1), component/src quedan undefined sin tirar", () => {
    document.body.innerHTML = `<button id="b">x</button>`;
    const button = document.getElementById("b")!;
    const target = buildTargetRef(button);
    expect(target.component).toBeUndefined();
    expect(target.src).toBeUndefined();
  });
});
