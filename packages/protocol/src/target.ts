import { z } from "zod";
import { SELECTOR_STRATEGIES } from "./constants.js";

/** Rectángulo en coordenadas de viewport, en píxeles CSS. */
export const RectSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    w: z.number().nonnegative(),
    h: z.number().nonnegative(),
  })
  .meta({ id: "Rect", title: "Rect" });

export type Rect = z.infer<typeof RectSchema>;

export const SelectorStrategySchema = z.enum(SELECTOR_STRATEGIES).meta({
  id: "SelectorStrategy",
  description: "Cascada de §5.2: primer match único gana.",
});

export type SelectorStrategy = z.infer<typeof SelectorStrategySchema>;

/**
 * Subconjunto de `getComputedStyle` que el content script adjunta.
 *
 * Solo se calcula en `click` y en `hover` con dwell > 800 ms, porque
 * `getComputedStyle` fuerza reflow (§03).
 */
export const ComputedStyleSchema = z
  .object({
    fontSize: z.string().optional(),
    fontWeight: z.string().optional(),
    padding: z.string().optional(),
    margin: z.string().optional(),
    color: z.string().optional(),
    backgroundColor: z.string().optional(),
    borderRadius: z.string().optional(),
    display: z.string().optional(),
  })
  .meta({ id: "ComputedStyle" });

export type ComputedStyle = z.infer<typeof ComputedStyleSchema>;

/** Tier de la cascada de source mapping de §11. 1 = plugin de build, 4 = solo selector. */
export const SourceTierSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);

export type SourceTier = z.infer<typeof SourceTierSchema>;

/** Referencia a archivo fuente resuelta por `@qua/source-resolver` (§11). */
export const SourceRefSchema = z
  .object({
    /** Ruta relativa al repo del proyecto, normalizada por el daemon. */
    file: z.string().min(1),
    line: z.int().positive(),
    col: z.int().positive().optional(),
    tier: SourceTierSchema,
  })
  .meta({ id: "SourceRef" });

export type SourceRef = z.infer<typeof SourceRefSchema>;

/**
 * Referencia a un elemento del DOM (§03).
 *
 * `sel` es el único campo garantizado como reidentificador; el resto es contexto
 * para el reporte y respaldo para cuando el selector se pudre.
 */
export const TargetRefSchema = z
  .object({
    /** Selector CSS validado como único al momento de emitir. */
    sel: z.string().min(1),
    strategy: SelectorStrategySchema,
    tag: z.string().min(1),
    /** innerText recortado a 80 chars. `"[redactado]"` bajo subárbol privado (§12). */
    text: z.string().optional(),
    role: z.string().optional(),
    /** Nombre accesible. */
    name: z.string().optional(),
    rect: RectSchema.optional(),
    visible: z.boolean().optional(),
    /** Cadena de clases COMPLETA, sin truncar: con Tailwind v4 la clase es el estilo (§03). */
    classes: z.string().optional(),
    computed: ComputedStyleSchema.optional(),
    /** Cadena de `_debugOwner`, de afuera hacia adentro. Tier 3 de §11. */
    component: z.array(z.string()).optional(),
    src: SourceRefSchema.optional(),
  })
  .meta({ id: "TargetRef", title: "TargetRef" });

export type TargetRef = z.infer<typeof TargetRefSchema>;

/** Texto con el que se reemplaza el contenido de un subárbol redactado (§12). */
export const REDACTED = "[redactado]" as const;
