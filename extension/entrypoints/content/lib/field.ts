import type { FieldRef } from "@qua/protocol";
import { isSensitiveField } from "./redact.js";

type FormControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

function labelText(el: FormControl): string | undefined {
  const labels = "labels" in el ? el.labels : null;
  const text = labels && labels.length > 0 ? labels[0]?.textContent?.trim() : undefined;
  if (text) return text;
  const ariaLabel = el.getAttribute("aria-label");
  return ariaLabel?.trim() || undefined;
}

/**
 * `FieldRef` de §03 para un control de formulario. Nunca lleva `value` (§12).
 * Devuelve `null` cuando el campo es sensible — el llamador no debe emitir el
 * evento `input` en absoluto, no solo omitir el valor.
 */
export function buildFieldRef(el: FormControl): FieldRef | null {
  const type = el instanceof HTMLInputElement ? el.type : el.tagName.toLowerCase();
  const name = el.name || undefined;
  const autocomplete = el.getAttribute("autocomplete") ?? undefined;

  if (isSensitiveField({ type, name, autocomplete })) return null;

  return {
    name,
    type,
    label: labelText(el),
  };
}
