import { z } from "zod";
import { ANCHOR_KINDS } from "./constants.js";
import { ConsoleEventSchema, NetFailEventSchema, NetSlowEventSchema } from "./event.js";
import { TargetRefSchema } from "./target.js";

export const AnchorKindSchema = z.enum(ANCHOR_KINDS).meta({
  id: "AnchorKind",
  description:
    "Las 3 clases de §07 paso 6. Regla de oro: ante duda, degradar a `route`.",
});

export type AnchorKind = z.infer<typeof AnchorKindSchema>;

/** A qué apunta un issue, y con cuánta confianza (§07). */
export const AnchorSchema = z
  .object({
    kind: AnchorKindSchema,
    /** Presente solo cuando `kind === "element"`. */
    target: TargetRefSchema.optional(),
    tab: z.int().optional(),
    url: z.string().optional(),
    /** `clamp(best.score / 6, 0, 1)`, penalizado ×0.7 si el ratio best/second < 1.3. */
    confidence: z.number().min(0).max(1),
    /** Traza legible de por qué se eligió: `["click −0.9s", "deixis:este"]`. */
    reason: z.array(z.string()),
  })
  .meta({ id: "Anchor" });

export type Anchor = z.infer<typeof AnchorSchema>;

/** Medición derivada de un click seguido de `mutation_burst` o `nav` (§07 paso 7). */
export const TimingSchema = z
  .object({
    label: z.string(),
    ms: z.int().nonnegative(),
  })
  .meta({ id: "Timing" });

export type Timing = z.infer<typeof TimingSchema>;

/**
 * Evidencia adjunta en la ventana `E = [t_ref − 6000, t_ref + 4000]`, misma pestaña.
 *
 * `console` y `net` guardan los eventos crudos, no un resumen: el agente quiere el stack.
 */
export const EvidenceSchema = z
  .object({
    /** Eventos `console` (error/warn) de la ventana E. */
    console: z.array(ConsoleEventSchema),
    /** Eventos `net_fail` y `net_slow` de la ventana E. */
    net: z.array(z.discriminatedUnion("k", [NetFailEventSchema, NetSlowEventSchema])),
    timings: z.array(TimingSchema),
    /** Ruta relativa al directorio de la sesión: `assets/i03.png`. */
    screenshot: z.string().optional(),
  })
  .meta({ id: "Evidence" });

export type Evidence = z.infer<typeof EvidenceSchema>;

export const IssueCategorySchema = z.enum(["ui", "bug", "perf", "copy", "idea"]).meta({
  id: "IssueCategory",
  description: "Precedencia de §07 paso 8: bug > perf > copy > ui > idea. Default: ui.",
});

export type IssueCategory = z.infer<typeof IssueCategorySchema>;

export const SeveritySchema = z.enum(["low", "med", "high"]).meta({ id: "Severity" });

export type Severity = z.infer<typeof SeveritySchema>;

/** Lo que produce el correlador y consume el agente (§03, §07). */
export const IssueSchema = z
  .object({
    /** `i` + 2 dígitos: `i03`. */
    id: z.string().regex(/^i\d{2,}$/),
    /** Utterances fusionadas que lo originaron (§07 paso 1). */
    utterance_ids: z.array(z.string().regex(/^u\d{2,}$/)),
    /** `t_ref` del grupo: el `mark` si lo hubo, si no el `t_start`. */
    t: z.int(),
    text: z.string(),
    anchor: AnchorSchema,
    evidence: EvidenceSchema,
    category: IssueCategorySchema,
    severity: SeveritySchema,
    /** URL del ticket, o `null` si todavía no se exportó. Lo escribe `qua_issue_mark_exported`. */
    exported_to: z.string().nullable(),
  })
  .meta({ id: "Issue", title: "Issue" });

export type Issue = z.infer<typeof IssueSchema>;

/** Umbral bajo el cual un issue cae en la sección «Sin anclar» del reporte (§8.1). */
export const UNANCHORED_CONFIDENCE = 0.35;
