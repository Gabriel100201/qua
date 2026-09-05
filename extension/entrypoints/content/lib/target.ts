import type { ComputedStyle, TargetRef } from "@qua/protocol";
import { computeAccessibleName, computeRole, isVisible } from "./dom.js";
import { DEFAULT_REDACTION_CONFIG, isPrivateSubtree, redactText, type RedactionConfig } from "./redact.js";
import { NULL_SOURCE_RESOLVER, type ComponentSourceResolver } from "./source-resolver.js";
import { buildSelector } from "./selector.js";

export interface BuildTargetRefOptions {
  redaction?: RedactionConfig;
  /** `getComputedStyle` fuerza reflow — solo en click y hover > 800 ms (§03). */
  withComputedStyle?: boolean;
  sourceResolver?: ComponentSourceResolver;
}

/** Subconjunto de `getComputedStyle` que viaja en `TargetRef.computed` (§03). */
function computedStyleSubset(el: Element): ComputedStyle | undefined {
  const win = el.ownerDocument.defaultView;
  if (!win) return undefined;
  const style = win.getComputedStyle(el);
  return {
    fontSize: style.fontSize || undefined,
    fontWeight: style.fontWeight || undefined,
    padding: style.padding || undefined,
    margin: style.margin || undefined,
    color: style.color || undefined,
    backgroundColor: style.backgroundColor || undefined,
    borderRadius: style.borderRadius || undefined,
    display: style.display || undefined,
  };
}

function rawInnerText(el: Element): string | undefined {
  const asHtml = el as HTMLElement;
  if (typeof asHtml.innerText === "string" && asHtml.innerText.trim()) return asHtml.innerText.trim();
  const text = el.textContent?.trim();
  return text || undefined;
}

/** Bug U3/Q1 (docs/DECISIONS.md D-Q1-02): cuántos niveles subir buscando texto —
 * mismo tope que `cssPathSelector` en `selector.ts`, no hay motivo para ir más lejos. */
const MAX_ANCESTOR_TEXT_LEVELS = 5;

/**
 * Cuando `el` cae a `css-path` (§5.2 nivel 4: sin testid/id/rol-nombre) Y no tiene
 * texto propio ni nombre accesible, el selector (`div:nth-of-type(2) > ...`) es lo
 * único que lo identifica — inservible para un reporte o un agente. Sube hasta
 * `MAX_ANCESTOR_TEXT_LEVELS` ancestros buscando el primero con texto propio, para
 * que el reporte pueda decir "dentro de «texto del ancestro»" en vez de nada.
 */
function nearestAncestorText(el: Element, redaction: RedactionConfig): string | undefined {
  let node = el.parentElement;
  let levels = 0;
  while (node && levels < MAX_ANCESTOR_TEXT_LEVELS) {
    const text = redactText(node, rawInnerText(node), redaction);
    if (text) return text;
    node = node.parentElement;
    levels++;
  }
  return undefined;
}

/**
 * Arma el `TargetRef` de §03 para `el`: selector (§5.2), rol/nombre accesible,
 * geometría, clases completas, estilo computado opcional y, si hay resolver,
 * componente + archivo fuente (§11, vía `@qua/source-resolver`). Aplica la
 * redacción de §12 antes de devolver nada.
 */
export function buildTargetRef(el: Element, opts: BuildTargetRefOptions = {}): TargetRef {
  const redaction = opts.redaction ?? DEFAULT_REDACTION_CONFIG;
  const resolver = opts.sourceResolver ?? NULL_SOURCE_RESOLVER;
  const { sel, strategy } = buildSelector(el);

  const rect = el.getBoundingClientRect();
  const private_ = isPrivateSubtree(el, redaction);

  const target: TargetRef = {
    sel,
    strategy,
    tag: el.tagName.toLowerCase(),
    text: redactText(el, rawInnerText(el), redaction),
    role: computeRole(el),
    name: private_ ? "[redactado]" : computeAccessibleName(el),
    rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
    visible: isVisible(el),
    classes: (el as HTMLElement).className || undefined,
  };

  // D-Q1-02: solo vale la pena subir a buscar texto de ancestro cuando el selector
  // ya cayó al último nivel de la cascada (§5.2) y ni `text` ni `name` identifican
  // al elemento — con cualquiera de los dos presentes, el reporte ya tiene con qué.
  if (strategy === "css-path" && !target.text && !target.name) {
    target.ancestorText = nearestAncestorText(el, redaction);
  }

  if (opts.withComputedStyle) {
    target.computed = computedStyleSubset(el);
  }

  const resolved = resolver.resolve(el);
  if (resolved?.component) target.component = resolved.component;
  if (resolved?.src) target.src = resolved.src;

  return target;
}
