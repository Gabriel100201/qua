import type { SelectorStrategy } from "@qua/protocol";

/** ids generados por librerías (React `useId`, Radix, Headless UI) — nunca sirven de ancla. */
const GENERATED_ID_RE = /^(:r|radix-|headlessui-|«)/;

/** Prefijos de utilidades de Tailwind (v4 incluye arbitrarios `w-[12px]` etc). Heurística. */
const TAILWIND_UTILITY_RE =
  /^-?((m|p)[trblxy]?-|w-|h-|min-|max-|size-|text-|bg-|border|rounded|shadow|gap-|space-|items-|justify-|content-|self-|place-|flex|grid|inline|block|hidden|table|absolute|relative|fixed|sticky|static|inset-|top-|right-|bottom-|left-|z-|overflow|opacity-|cursor-|select-|pointer-events|transition|duration-|delay-|ease-|animate-|font-|leading-|tracking-|whitespace-|break-|truncate|underline|line-through|no-underline|uppercase|lowercase|capitalize|normal-case|list-|divide-|ring|outline|from-|via-|to-|object-|aspect-|order-|col-|row-|basis-|grow|shrink|rotate-|scale-|translate-|skew-|origin-|filter|blur-|brightness-|contrast-|grayscale|invert|saturate|sepia|backdrop-|appearance-|caret-|accent-|will-change|isolate)/;

/** `true` para variantes (`hover:`, `dark:`, `sm:`, `focus-visible:`, ...) o utilidades conocidas. */
function looksLikeTailwind(cls: string): boolean {
  if (cls.includes(":")) return true;
  return TAILWIND_UTILITY_RE.test(cls);
}

/** Clases "semánticas" de `el`, filtrando el ruido de utilidades (§5.2 nivel 4). */
function stableClasses(el: Element): string[] {
  return Array.from(el.classList).filter((c) => c.length > 0 && !looksLikeTailwind(c));
}

function escapeIdent(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
}

function attrSelector(name: string, value: string): string {
  return `[${name}="${value.replace(/"/g, '\\"')}"]`;
}

function isUnique(doc: ParentNode, sel: string): boolean {
  try {
    return doc.querySelectorAll(sel).length === 1;
  } catch {
    return false;
  }
}

/** Nivel 1 — `data-testid`, `data-test`, `data-cy`, en ese orden. */
function testIdSelector(el: Element): string | null {
  for (const attr of ["data-testid", "data-test", "data-cy"]) {
    const value = el.getAttribute(attr);
    if (value) return attrSelector(attr, value);
  }
  return null;
}

/** Nivel 2 — `#id`, descartando ids generados. */
function idSelector(el: Element): string | null {
  const id = el.id;
  if (!id || GENERATED_ID_RE.test(id)) return null;
  return `#${escapeIdent(id)}`;
}

/**
 * Nivel 3 — rol + nombre accesible. Simplificado: `aria-label` propio, o el
 * `role` del ancestro interactivo más cercano (diálogos, menús) combinado con
 * el tag, o el `role` propio. No implementa el algoritmo AccName completo de
 * WAI-ARIA — alcanza para lo que el ejemplo de §5.2 pide.
 */
function roleNameSelector(el: Element): string | null {
  const tag = el.tagName.toLowerCase();
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel) return `${tag}${attrSelector("aria-label", ariaLabel)}`;

  const roleAncestor = el.closest("[role]");
  if (roleAncestor && roleAncestor !== el) {
    const role = roleAncestor.getAttribute("role");
    if (role) return `${attrSelector("role", role)} ${tag}`;
  }

  const ownRole = el.getAttribute("role");
  if (ownRole) return attrSelector("role", ownRole);

  return null;
}

function nthOfTypeIndex(el: Element): number {
  let index = 1;
  let sibling = el.previousElementSibling;
  while (sibling) {
    if (sibling.tagName === el.tagName) index++;
    sibling = sibling.previousElementSibling;
  }
  return index;
}

/**
 * Nivel 4 — camino más corto único hasta un ancestro con id estable, máx. 5
 * niveles, con `:nth-of-type`. Si el camino puro no es único, se agregan las
 * clases estables (no-Tailwind) del nodo hoja como último recurso.
 */
function cssPathSelector(doc: ParentNode, el: Element): string | null {
  const MAX_LEVELS = 5;
  const segments: string[] = [];
  let node: Element | null = el;
  let levels = 0;

  while (node && node.nodeType === 1 && levels < MAX_LEVELS) {
    const stableId = node.id && !GENERATED_ID_RE.test(node.id) ? node.id : null;
    if (stableId) {
      segments.unshift(`#${escapeIdent(stableId)}`);
      break;
    }
    segments.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${nthOfTypeIndex(node)})`);
    node = node.parentElement;
    levels++;
  }

  if (segments.length === 0) return null;
  const bare = segments.join(" > ");
  if (isUnique(doc, bare)) return bare;

  const leafClasses = stableClasses(el);
  if (leafClasses.length > 0) {
    const withClasses = [...segments];
    const leafIndex = withClasses.length - 1;
    withClasses[leafIndex] = `${withClasses[leafIndex]}.${leafClasses.map(escapeIdent).join(".")}`;
    const decorated = withClasses.join(" > ");
    if (isUnique(doc, decorated)) return decorated;
  }

  // Último recurso: devolvemos el camino igual, aunque no sea único — no hay
  // más niveles de cascada después de css-path.
  return bare;
}

export interface SelectorResult {
  sel: string;
  strategy: SelectorStrategy;
}

/**
 * Cascada de §5.2: primer match único gana. `doc` es inyectable para testear
 * contra un documento que no sea el global (happy-dom/jsdom en los tests).
 */
export function buildSelector(el: Element, doc: ParentNode = el.ownerDocument ?? document): SelectorResult {
  const testId = testIdSelector(el);
  if (testId && isUnique(doc, testId)) return { sel: testId, strategy: "testid" };

  const id = idSelector(el);
  if (id && isUnique(doc, id)) return { sel: id, strategy: "id" };

  const roleName = roleNameSelector(el);
  if (roleName && isUnique(doc, roleName)) return { sel: roleName, strategy: "role-name" };

  const cssPath = cssPathSelector(doc, el);
  return { sel: cssPath ?? el.tagName.toLowerCase(), strategy: "css-path" };
}
