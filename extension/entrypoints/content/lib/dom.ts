/** Selector de los "ancestros interactivos" de §5.1 (tracker de hover). */
const INTERACTIVE_SELECTOR = "button, a, input, select, textarea, [role], [onclick], [tabindex]";

/**
 * Sube desde `el` hasta el ancestro interactivo más cercano (incluyéndose a sí
 * mismo), para no anclar un hover/click a un `<span>` interno. Si nada matchea,
 * devuelve `el` sin modificar.
 */
export function closestInteractive(el: Element): Element {
  return el.closest(INTERACTIVE_SELECTOR) ?? el;
}

/** Roles implícitos de la tabla ARIA-in-HTML para los tags más comunes. */
const IMPLICIT_ROLES: Record<string, string> = {
  button: "button",
  a: "link",
  input: "textbox",
  textarea: "textbox",
  select: "combobox",
  summary: "button",
  option: "option",
  li: "listitem",
  ul: "list",
  ol: "list",
  nav: "navigation",
  main: "main",
  header: "banner",
  footer: "contentinfo",
  form: "form",
  img: "img",
  dialog: "dialog",
};

/** Rol efectivo: explícito (`role="..."`) o implícito por tag. */
export function computeRole(el: Element): string | undefined {
  const explicit = el.getAttribute("role");
  if (explicit) return explicit;
  const tag = el.tagName.toLowerCase();
  if (tag === "input") {
    const type = (el as HTMLInputElement).type;
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    if (type === "button" || type === "submit") return "button";
  }
  return IMPLICIT_ROLES[tag];
}

/**
 * Nombre accesible simplificado: `aria-label`, si no `aria-labelledby`, si no
 * el `<label>` asociado (para campos de formulario), si no `textContent`
 * recortado. No es el algoritmo AccName completo — cubre los casos comunes
 * que el content script necesita para anclar un `TargetRef`.
 */
export function computeAccessibleName(el: Element): string | undefined {
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel) return ariaLabel.trim();

  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const doc = el.ownerDocument;
    const text = labelledBy
      .split(/\s+/)
      .map((id) => doc.getElementById(id)?.textContent?.trim())
      .filter(Boolean)
      .join(" ");
    if (text) return text;
  }

  if (el instanceof HTMLElement && "labels" in el) {
    const labels = (el as HTMLInputElement).labels;
    if (labels && labels.length > 0) {
      const text = labels[0]?.textContent?.trim();
      if (text) return text;
    }
  }

  const text = el.textContent?.trim();
  return text ? text.slice(0, 80) : undefined;
}

/** `true` si `el` tiene tamaño en el layout y no está oculto por CSS. */
export function isVisible(el: Element): boolean {
  if (typeof (el as { checkVisibility?: () => boolean }).checkVisibility === "function") {
    try {
      return (el as unknown as { checkVisibility: () => boolean }).checkVisibility();
    } catch {
      // sigue al fallback
    }
  }
  const win = el.ownerDocument.defaultView;
  if (!win) return true;
  const style = win.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}
