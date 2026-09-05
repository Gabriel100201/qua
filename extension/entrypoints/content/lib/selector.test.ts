import { describe, expect, it } from "vitest";
import { buildSelector } from "./selector.js";

function el(html: string): Element {
  document.body.innerHTML = html;
  return document.body.firstElementChild as Element;
}

describe("buildSelector — cascada de §5.2", () => {
  it("nivel 1: data-testid gana sobre todo lo demás", () => {
    const node = el(`<button id="btn-1" data-testid="nuevo-turno" aria-label="Nuevo turno">Nuevo turno</button>`);
    const result = buildSelector(node);
    expect(result).toEqual({ sel: '[data-testid="nuevo-turno"]', strategy: "testid" });
  });

  it("acepta data-test y data-cy como sinónimos de testid", () => {
    document.body.innerHTML = `<button data-test="a">a</button><button data-cy="b">b</button>`;
    const [a, b] = Array.from(document.body.children) as Element[];
    expect(buildSelector(a!)).toEqual({ sel: '[data-test="a"]', strategy: "testid" });
    expect(buildSelector(b!)).toEqual({ sel: '[data-cy="b"]', strategy: "testid" });
  });

  it("nivel 2: usa #id cuando no hay testid", () => {
    const node = el(`<div id="panel-estable">contenido</div>`);
    expect(buildSelector(node)).toEqual({ sel: "#panel-estable", strategy: "id" });
  });

  it("descarta ids generados (React useId, Radix, Headless UI)", () => {
    for (const id of [":r3:", "radix-42", "headlessui-menu-1", "«r5»"]) {
      document.body.innerHTML = `<div id="${CSS.escape(id)}" data-marker="x"></div>`;
      const node = document.body.firstElementChild as Element;
      const result = buildSelector(node);
      expect(result.strategy).not.toBe("id");
    }
  });

  it("nivel 3: role-name vía aria-label", () => {
    document.body.innerHTML = `
      <button aria-label="Cerrar">×</button>
      <button aria-label="Cerrar sesión">×</button>
    `;
    const node = document.body.firstElementChild as Element;
    expect(buildSelector(node)).toEqual({ sel: 'button[aria-label="Cerrar"]', strategy: "role-name" });
  });

  it("nivel 3: role-name vía ancestro con role", () => {
    document.body.innerHTML = `<div role="dialog"><button>Confirmar</button></div><button>Confirmar</button>`;
    const inDialog = document.querySelector("[role=dialog] button") as Element;
    const result = buildSelector(inDialog);
    expect(result.strategy).toBe("role-name");
    expect(result.sel).toBe('[role="dialog"] button');
  });

  it("nivel 4: css-path con :nth-of-type cuando no hay nada estable", () => {
    document.body.innerHTML = `
      <ul id="lista">
        <li>uno</li>
        <li>dos</li>
        <li class="marker">tres</li>
      </ul>
    `;
    const third = document.querySelector("li.marker") as Element;
    const result = buildSelector(third);
    expect(result.strategy).toBe("css-path");
    expect(document.querySelectorAll(result.sel)).toHaveLength(1);
    expect(document.querySelector(result.sel)).toBe(third);
  });

  it("css-path omite clases de Tailwind salvo que no haya alternativa", () => {
    document.body.innerHTML = `
      <div>
        <span class="flex items-center gap-2 text-sm">a</span>
        <span class="flex items-center gap-2 text-sm">b</span>
      </div>
    `;
    const spans = document.querySelectorAll("span");
    const result = buildSelector(spans[1]!);
    expect(result.strategy).toBe("css-path");
    // nth-of-type alcanza para desambiguar — no debería inventar clases.
    expect(result.sel).not.toContain(".flex");
  });

  it("reidentifica el mismo nodo lógico después de un re-render (mismo testid, instancia distinta)", () => {
    document.body.innerHTML = `<section><button data-testid="nuevo-turno">Nuevo turno</button></section>`;
    const before = document.querySelector('[data-testid="nuevo-turno"]') as Element;
    const { sel } = buildSelector(before);

    // Simula un re-render de React: el nodo viejo se destruye y aparece una
    // instancia nueva con los mismos atributos estables.
    const section = document.querySelector("section")!;
    section.innerHTML = "";
    const after = document.createElement("button");
    after.setAttribute("data-testid", "nuevo-turno");
    after.textContent = "Nuevo turno";
    section.appendChild(after);

    expect(after).not.toBe(before);
    const reidentified = document.querySelector(sel);
    expect(reidentified).toBe(after);
  });
});
