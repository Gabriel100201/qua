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

/**
 * CRITERIO de esta tarea (docs/DECISIONS.md D-Q1-02): un selector `css-path` como
 * `div:nth-of-type(2) > main:nth-of-type(1) > section` (pediloapp.com, sin
 * data-testid) no identifica nada legible por sí solo — el `TargetRef` tiene que
 * traer lo que sí lo identifica.
 */
describe("buildTargetRef — ancestorText en el fallback css-path (D-Q1-02)", () => {
  it("elemento sin texto propio ni nombre: sube al ancestro más cercano con texto", () => {
    document.body.innerHTML = `
      <section>
        Verde Bowl Abierto ahora
        <div><span class="lp-belt__track"></span></div>
      </section>
    `;
    const span = document.querySelector("span")!;
    const target = buildTargetRef(span);

    expect(target.strategy).toBe("css-path");
    expect(target.text).toBeUndefined();
    expect(target.ancestorText).toBe("Verde Bowl Abierto ahora");
  });

  it("con texto propio, no hace falta subir — ancestorText queda undefined", () => {
    document.body.innerHTML = `
      <section>Contenedor
        <span>EL PROBLEMA</span>
      </section>
    `;
    const span = document.querySelector("span")!;
    const target = buildTargetRef(span);

    expect(target.strategy).toBe("css-path");
    expect(target.text).toBe("EL PROBLEMA");
    expect(target.ancestorText).toBeUndefined();
  });

  it("con nombre accesible (aria-label) sin selector único, no hace falta ancestorText", () => {
    document.body.innerHTML = `
      <section>Contenedor
        <span aria-label="Cerrar"></span>
        <span aria-label="Cerrar"></span>
      </section>
    `;
    // Dos aria-label iguales: `roleNameSelector` no es único → cae a css-path, pero
    // `name` sigue calculándose igual — no hace falta subir a buscar texto.
    const span = document.querySelectorAll("span")[0]!;
    const target = buildTargetRef(span);

    expect(target.strategy).toBe("css-path");
    expect(target.name).toBe("Cerrar");
    expect(target.ancestorText).toBeUndefined();
  });

  it("con un selector que NO cayó a css-path, no calcula ancestorText aunque no haya texto propio", () => {
    document.body.innerHTML = `
      <section>Verde Bowl
        <span id="track-unico"></span>
      </section>
    `;
    const span = document.getElementById("track-unico")!;
    const target = buildTargetRef(span);

    expect(target.strategy).toBe("id");
    expect(target.ancestorText).toBeUndefined();
  });

  it("bajo un subárbol privado, no calcula ancestorText (name ya viene [redactado])", () => {
    // `name` de un elemento privado ya se fuerza a "[redactado]" (línea de arriba en
    // buildTargetRef) — con `!target.name` en falso, ni se intenta subir a buscar
    // texto del ancestro. No hay forma de que este fallback termine filtrando el
    // texto de un subárbol privado por una puerta lateral.
    document.body.innerHTML = `
      <div data-private>
        Diagnóstico: paciente X
        <span class="icon"></span>
      </div>
    `;
    const span = document.querySelector("span")!;
    const target = buildTargetRef(span);

    expect(target.strategy).toBe("css-path");
    expect(target.name).toBe("[redactado]");
    expect(target.ancestorText).toBeUndefined();
  });
});
