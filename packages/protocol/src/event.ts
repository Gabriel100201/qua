import { z } from "zod";
import { TargetRefSchema } from "./target.js";

/**
 * Campos comunes a todo evento (§03).
 *
 * `t` es entero en ms desde `t0_wall`; el content script lo emite como
 * `performance.timeOrigin + performance.now()` y el daemon lo normaliza (§02).
 * `tab` es el id de pestaña de Chrome.
 */
const base = {
  t: z.int(),
  tab: z.int().optional(),
};

/** Modificadores de teclado presentes al momento del click. */
export const ModifierSchema = z.enum(["shift", "ctrl", "alt", "meta"]);
export type Modifier = z.infer<typeof ModifierSchema>;

/** Campo de formulario. NUNCA lleva `value` (§12). */
export const FieldRefSchema = z
  .object({
    name: z.string().optional(),
    type: z.string().optional(),
    label: z.string().optional(),
  })
  .meta({ id: "FieldRef" });

export type FieldRef = z.infer<typeof FieldRefSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Las 18 variantes
// ─────────────────────────────────────────────────────────────────────────────

/** Carga o cambio de ruta SPA (patch de `history.pushState` + `popstate`). */
export const NavEventSchema = z
  .object({
    ...base,
    k: z.literal("nav"),
    url: z.string(),
    title: z.string(),
    kind: z.enum(["load", "spa", "back", "forward"]),
  })
  .meta({ id: "NavEvent" });

/** `chrome.tabs.onActivated`. */
export const TabSwitchEventSchema = z
  .object({
    ...base,
    k: z.literal("tab_switch"),
    from: z.int().nullable(),
    to: z.int(),
    url: z.string(),
  })
  .meta({ id: "TabSwitchEvent" });

/** `chrome.tabs.onRemoved`. */
export const TabCloseEventSchema = z
  .object({
    ...base,
    k: z.literal("tab_close"),
    tab: z.int(),
  })
  .meta({ id: "TabCloseEvent" });

/** Captura en fase capture sobre `document`. */
export const ClickEventSchema = z
  .object({
    ...base,
    k: z.literal("click"),
    target: TargetRefSchema,
    /** `MouseEvent.button`: 0 principal, 1 medio, 2 secundario. */
    button: z.int().min(0).max(4),
    mods: z.array(ModifierSchema),
  })
  .meta({ id: "ClickEvent" });

/** Al salir de un elemento con permanencia ≥ 400 ms. */
export const HoverEventSchema = z
  .object({
    ...base,
    k: z.literal("hover"),
    target: TargetRefSchema,
    dwell_ms: z.int().nonnegative(),
  })
  .meta({ id: "HoverEvent" });

/** `focusin`. */
export const FocusChangeEventSchema = z
  .object({
    ...base,
    k: z.literal("focus_change"),
    target: TargetRefSchema,
  })
  .meta({ id: "FocusChangeEvent" });

/** `input` con debounce de 800 ms. Sin `value`, nunca (§12). */
export const InputEventSchema = z
  .object({
    ...base,
    k: z.literal("input"),
    target: TargetRefSchema,
    field: FieldRefSchema,
  })
  .meta({ id: "InputEvent" });

/** `submit`. */
export const SubmitEventSchema = z
  .object({
    ...base,
    k: z.literal("submit"),
    target: TargetRefSchema,
  })
  .meta({ id: "SubmitEvent" });

/** 150 ms sin scroll tras haber scrolleado. */
export const ScrollSettleEventSchema = z
  .object({
    ...base,
    k: z.literal("scroll_settle"),
    y: z.number(),
    /** Porcentaje del documento scrolleado, 0..1. */
    pct: z.number().min(0).max(1),
    top_target: TargetRefSchema.optional(),
  })
  .meta({ id: "ScrollSettleEvent" });

/** Inicio y `resize` con debounce de 300 ms. */
export const ViewportEventSchema = z
  .object({
    ...base,
    k: z.literal("viewport"),
    w: z.int().positive(),
    h: z.int().positive(),
    dpr: z.number().positive(),
  })
  .meta({ id: "ViewportEvent" });

/** Wrap de `console.error`/`warn` + `onerror` + `unhandledrejection`. */
export const ConsoleEventSchema = z
  .object({
    ...base,
    k: z.literal("console"),
    level: z.enum(["error", "warn"]),
    text: z.string(),
    stack: z.string().optional(),
  })
  .meta({ id: "ConsoleEvent" });

/** `status >= 400` o error de red (patch de `fetch` + XHR). */
export const NetFailEventSchema = z
  .object({
    ...base,
    k: z.literal("net_fail"),
    method: z.string(),
    url: z.string(),
    /** 0 cuando la request murió sin respuesta. */
    status: z.int().min(0),
    duration_ms: z.int().nonnegative(),
  })
  .meta({ id: "NetFailEvent" });

/** Duración > 1200 ms. */
export const NetSlowEventSchema = z
  .object({
    ...base,
    k: z.literal("net_slow"),
    method: z.string(),
    url: z.string(),
    status: z.int().min(0),
    duration_ms: z.int().nonnegative(),
  })
  .meta({ id: "NetSlowEvent" });

/** `PerformanceObserver('longtask')`, > 200 ms. */
export const LongTaskEventSchema = z
  .object({
    ...base,
    k: z.literal("long_task"),
    duration_ms: z.int().nonnegative(),
  })
  .meta({ id: "LongTaskEvent" });

/** `layout-shift` sin input reciente, `value > 0.05`. */
export const LayoutShiftEventSchema = z
  .object({
    ...base,
    k: z.literal("layout_shift"),
    value: z.number(),
    sources: z.array(TargetRefSchema).optional(),
  })
  .meta({ id: "LayoutShiftEvent" });

/** > 20 mutaciones en 100 ms — proxy de «se abrió un modal». */
export const MutationBurstEventSchema = z
  .object({
    ...base,
    k: z.literal("mutation_burst"),
    target: TargetRefSchema.optional(),
    count: z.int().nonnegative(),
  })
  .meta({ id: "MutationBurstEvent" });

/** El ancla dura de precisión. */
export const MarkEventSchema = z
  .object({
    ...base,
    k: z.literal("mark"),
    source: z.enum(["hotkey", "popup"]),
  })
  .meta({ id: "MarkEvent" });

/** Se perdió audio por desconexión del WS. */
export const AudioGapEventSchema = z
  .object({
    ...base,
    k: z.literal("audio_gap"),
    duration_ms: z.int().nonnegative(),
  })
  .meta({ id: "AudioGapEvent" });

// ─────────────────────────────────────────────────────────────────────────────

/** Unión discriminada por `k`. Los 18 tipos de la tabla de §03. */
export const EventSchema = z
  .discriminatedUnion("k", [
    NavEventSchema,
    TabSwitchEventSchema,
    TabCloseEventSchema,
    ClickEventSchema,
    HoverEventSchema,
    FocusChangeEventSchema,
    InputEventSchema,
    SubmitEventSchema,
    ScrollSettleEventSchema,
    ViewportEventSchema,
    ConsoleEventSchema,
    NetFailEventSchema,
    NetSlowEventSchema,
    LongTaskEventSchema,
    LayoutShiftEventSchema,
    MutationBurstEventSchema,
    MarkEventSchema,
    AudioGapEventSchema,
  ])
  .meta({ id: "Event", title: "Event" });

export type Event = z.infer<typeof EventSchema>;

export type NavEvent = z.infer<typeof NavEventSchema>;
export type TabSwitchEvent = z.infer<typeof TabSwitchEventSchema>;
export type TabCloseEvent = z.infer<typeof TabCloseEventSchema>;
export type ClickEvent = z.infer<typeof ClickEventSchema>;
export type HoverEvent = z.infer<typeof HoverEventSchema>;
export type FocusChangeEvent = z.infer<typeof FocusChangeEventSchema>;
export type InputEvent = z.infer<typeof InputEventSchema>;
export type SubmitEvent = z.infer<typeof SubmitEventSchema>;
export type ScrollSettleEvent = z.infer<typeof ScrollSettleEventSchema>;
export type ViewportEvent = z.infer<typeof ViewportEventSchema>;
export type ConsoleEvent = z.infer<typeof ConsoleEventSchema>;
export type NetFailEvent = z.infer<typeof NetFailEventSchema>;
export type NetSlowEvent = z.infer<typeof NetSlowEventSchema>;
export type LongTaskEvent = z.infer<typeof LongTaskEventSchema>;
export type LayoutShiftEvent = z.infer<typeof LayoutShiftEventSchema>;
export type MutationBurstEvent = z.infer<typeof MutationBurstEventSchema>;
export type MarkEvent = z.infer<typeof MarkEventSchema>;
export type AudioGapEvent = z.infer<typeof AudioGapEventSchema>;

/** Extrae la variante de `Event` cuyo `k` es `K`. */
export type EventOf<K extends Event["k"]> = Extract<Event, { k: K }>;
