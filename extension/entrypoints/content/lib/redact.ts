/**
 * Redacción de §12. Se aplica siempre en el content script, antes de que un
 * `TargetRef` o un `input` salgan hacia el service worker — nunca en el daemon,
 * que ya no tiene el DOM para saber qué taparía.
 */

/** Umbrales configurables (§13 los pone en `config.toml`; acá van los defaults). */
export interface RedactionConfig {
  /** Selectores extra de `capture.redact_selectors`, además de `[data-private]`. */
  redactSelectors: string[];
  /** Query params que sí viajan enteros; el resto se reemplaza por `…`. */
  queryAllowlist: string[];
}

export const DEFAULT_REDACTION_CONFIG: RedactionConfig = {
  redactSelectors: [],
  queryAllowlist: [],
};

/** Campos de formulario que nunca se emiten enteros (§12). */
const SENSITIVE_FIELD_RE = /pass|card|cvv|token|secret|ssn|dni|cbu/i;

/** `autocomplete` de tarjeta: `cc-number`, `cc-csc`, `cc-exp`, `cc-name`, ... */
const CARD_AUTOCOMPLETE_RE = /^cc-/i;

function matchesAny(el: Element, selectors: readonly string[]): boolean {
  for (const sel of selectors) {
    try {
      if (el.closest(sel)) return true;
    } catch {
      // Selector inválido (config de usuario) — se ignora, nunca tira.
    }
  }
  return false;
}

/** `true` si `el` cuelga de `[data-private]` o de un selector de `redactSelectors`. */
export function isPrivateSubtree(el: Element, config: RedactionConfig = DEFAULT_REDACTION_CONFIG): boolean {
  return matchesAny(el, ["[data-private]", ...config.redactSelectors]);
}

/** Texto con el que se reemplaza el contenido de un subárbol redactado (§03/§12). */
export const REDACTED = "[redactado]" as const;

/** Recorta a 80 chars y redacta si `el` está bajo un subárbol privado. */
export function redactText(
  el: Element,
  rawText: string | undefined,
  config: RedactionConfig = DEFAULT_REDACTION_CONFIG,
): string | undefined {
  if (rawText === undefined) return undefined;
  if (isPrivateSubtree(el, config)) return REDACTED;
  return rawText.slice(0, 80);
}

/** Info mínima de un `<input>`/`<select>`/`<textarea>` para decidir si es sensible. */
export interface SensitiveFieldInput {
  type?: string;
  name?: string;
  autocomplete?: string;
}

/**
 * `true` si el campo nunca debe emitirse (ni `value`, que ya no se manda nunca,
 * ni el propio evento `input`): `type="password"`, autocomplete de tarjeta, o
 * cualquier `name`/`type`/`autocomplete` que matchee la lista de §12.
 */
export function isSensitiveField(field: SensitiveFieldInput): boolean {
  if (field.type === "password") return true;
  if (field.autocomplete && CARD_AUTOCOMPLETE_RE.test(field.autocomplete)) return true;
  return [field.type, field.name, field.autocomplete].some((v) => v !== undefined && SENSITIVE_FIELD_RE.test(v));
}

/**
 * Recorta la query string de `rawUrl` a `config.queryAllowlist`. Lo que no está
 * en la allowlist se colapsa a un único `…` (§12). Nunca tira: una URL rota
 * vuelve tal cual.
 */
export function redactUrl(rawUrl: string, config: RedactionConfig = DEFAULT_REDACTION_CONFIG): string {
  let url: URL;
  try {
    url = new URL(rawUrl, typeof location !== "undefined" ? location.href : undefined);
  } catch {
    return rawUrl;
  }
  if (![...url.searchParams.keys()].length) return rawUrl;

  const kept = new URLSearchParams();
  let dropped = false;
  for (const [key, value] of url.searchParams) {
    if (config.queryAllowlist.includes(key)) kept.append(key, value);
    else dropped = true;
  }

  let search = kept.toString();
  if (dropped) search += search ? "&…" : "…";
  url.search = search;
  // El setter de `.search` percent-encodea "…" al parsear la query — lo
  // dejamos legible a mano, es el único carácter no-ASCII que inyectamos.
  return url.toString().replace(/%E2%80%A6/gi, "…");
}
