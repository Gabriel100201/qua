/** Lo mínimo para armar vistas sin framework: buscar, mostrar y reemplazar contenido. */
export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document): T => {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`[qua] falta ${sel}`);
  return el;
};

export function show(el: HTMLElement, visible: boolean): void {
  el.hidden = !visible;
}

/** Inserta HTML propio (SVG del anillo, íconos). Nunca texto del usuario: para eso, `text()`. */
export function setHtml(el: Element, html: string): void {
  if (el.innerHTML !== html) el.innerHTML = html;
}

export function text(el: Element, value: string): void {
  if (el.textContent !== value) el.textContent = value;
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, txt?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt !== undefined) e.textContent = txt;
  return e;
}
