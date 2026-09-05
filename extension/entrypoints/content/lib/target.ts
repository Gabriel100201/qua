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

  if (opts.withComputedStyle) {
    target.computed = computedStyleSubset(el);
  }

  const resolved = resolver.resolve(el);
  if (resolved?.component) target.component = resolved.component;
  if (resolved?.src) target.src = resolved.src;

  return target;
}
