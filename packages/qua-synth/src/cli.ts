import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { EventSchema, UtteranceSchema } from "@qua/protocol";

// ─────────────────────────────────────────────────────────────────────────────
// Builders — cada uno emite exactamente los campos que exige el schema real de
// @qua/protocol (§03). Nada de "campos que faltan": eso fue el defecto de F1b.
// ─────────────────────────────────────────────────────────────────────────────

type Rect = { x: number; y: number; w: number; h: number };

interface TargetRef {
  sel: string;
  strategy: "testid";
  tag: string;
  text?: string;
  visible?: boolean;
  rect?: Rect;
}

const target = (sel: string, text: string, opts: { tag?: string; visible?: boolean } = {}): TargetRef => ({
  sel,
  strategy: "testid",
  tag: opts.tag ?? "button",
  text,
  visible: opts.visible ?? true,
});

const nav = (t: number, tab: number, url: string, kind: "load" | "spa" | "back" | "forward" = "spa") => ({
  t,
  tab,
  k: "nav",
  url,
  title: "Agendi",
  kind,
});

const tabSwitch = (t: number, tab: number, from: number | null, to: number, url: string) => ({
  t,
  tab,
  k: "tab_switch",
  from,
  to,
  url,
});

const tabClose = (t: number, tab: number) => ({ t, k: "tab_close", tab });

const click = (t: number, tab: number, tgt: TargetRef, button = 0) => ({
  t,
  tab,
  k: "click",
  target: tgt,
  button,
  mods: [] as string[],
});

const hover = (t: number, tab: number, tgt: TargetRef, dwell_ms: number) => ({
  t,
  tab,
  k: "hover",
  target: tgt,
  dwell_ms,
});

const focusChange = (t: number, tab: number, tgt: TargetRef) => ({ t, tab, k: "focus_change", target: tgt });

const inputEvt = (t: number, tab: number, tgt: TargetRef, name: string) => ({
  t,
  tab,
  k: "input",
  target: tgt,
  field: { name, type: "search" },
});

const submit = (t: number, tab: number, tgt: TargetRef) => ({ t, tab, k: "submit", target: tgt });

const scrollSettle = (t: number, tab: number, y: number, pct: number, topTarget?: TargetRef) => ({
  t,
  tab,
  k: "scroll_settle",
  y,
  pct,
  ...(topTarget ? { top_target: topTarget } : {}),
});

const viewport = (t: number, tab: number, w = 1512, h = 857, dpr = 2) => ({ t, tab, k: "viewport", w, h, dpr });

const consoleEvt = (t: number, tab: number, level: "error" | "warn", text: string) => ({
  t,
  tab,
  k: "console",
  level,
  text,
});

const netFail = (t: number, tab: number, method: string, url: string, status: number, duration_ms: number) => ({
  t,
  tab,
  k: "net_fail",
  method,
  url,
  status,
  duration_ms,
});

const netSlow = (t: number, tab: number, method: string, url: string, status: number, duration_ms: number) => ({
  t,
  tab,
  k: "net_slow",
  method,
  url,
  status,
  duration_ms,
});

const longTask = (t: number, tab: number, duration_ms: number) => ({ t, tab, k: "long_task", duration_ms });

const layoutShift = (t: number, tab: number, value: number) => ({ t, tab, k: "layout_shift", value });

const mutationBurst = (t: number, tab: number, count: number, tgt?: TargetRef) => ({
  t,
  tab,
  k: "mutation_burst",
  count,
  ...(tgt ? { target: tgt } : {}),
});

const mark = (t: number, tab: number, source: "hotkey" | "popup" = "hotkey") => ({ t, tab, k: "mark", source });

const audioGap = (t: number, tab: number, duration_ms: number) => ({ t, tab, k: "audio_gap", duration_ms });

/** Ruido ambiente: cubre 7 tipos que no participan del scoring (§07 paso 4), lejos de
 * cualquier ventana de candidatos (paso 4, 4500 ms atrás) o de evidencia (paso 7, 6000 ms
 * atrás), para no interferir con el escenario. */
function background(tab: number, t0: number, route: string): unknown[] {
  return [
    viewport(t0, tab, 1512, 857, 2),
    mutationBurst(t0 + 250, tab, 3),
    inputEvt(t0 + 700, tab, target('input[data-testid="buscador"]', "", { tag: "input" }), "buscador"),
    submit(t0 + 1300, tab, target('form[data-testid="filtros"]', "", { tag: "form" })),
    tabSwitch(t0 + 1700, tab, null, tab, route),
    audioGap(t0 + 2100, tab, 300),
    tabClose(t0 + 2500, tab + 100),
  ];
}

const wordize = (text: string, t: number) => text.split(/\s+/).map((w, i) => ({ w, t: t + i * 90, d: 80, p: 0.97 }));

interface UtterOpts {
  marked?: boolean;
  no_speech_prob?: number;
  avg_logprob?: number;
}

const utter = (id: string, text: string, t: number, opts: UtterOpts = {}) => ({
  id,
  t_start: t,
  t_end: t + text.length * 35,
  text,
  lang: "es",
  words: wordize(text, t),
  avg_logprob: opts.avg_logprob ?? -0.12,
  no_speech_prob: opts.no_speech_prob ?? 0.03,
  marked: opts.marked ?? false,
});

// ─────────────────────────────────────────────────────────────────────────────
// Escenarios
// ─────────────────────────────────────────────────────────────────────────────

interface Scenario {
  id: string;
  name: string;
  behavior: string;
  naiveFailure: string;
  events: unknown[];
  utterances: unknown[];
  expected: { issue: string | null; anchor: { kind: "element"; selector: string } | { kind: "route" | "session" } };
}

const scenarios: Scenario[] = [];
let n = 0;
const nextIds = () => {
  n += 1;
  return { s: `s${String(n).padStart(2, "0")}`, i: `i${String(n).padStart(2, "0")}`, u: `u${String(n).padStart(2, "0")}` };
};

const T = 20_000;
const T0 = T - 9_500; // arranque del ruido de fondo, bien afuera de cualquier ventana

// ---- 20 escenarios base: 4 clases de deixis × 5, cada uno con ruta, selectores,
//      distractores y frase propios (§07 pasos 3, 5 y 6) ----

interface PointerSpec {
  route: string;
  tab: number;
  targetSel: string;
  targetText: string;
  distractorSel: string;
  distractorText: string;
  phrase: string;
  /** Offsets relativos a t_ref. */
  targetHover: { dt: number; dwell: number };
  targetClick: { dt: number };
  distractor: Array<{ kind: "hover" | "click" | "focus" | "scroll_top"; dt: number; dwell?: number }>;
}

function pointerScenario(spec: PointerSpec): Scenario {
  const { s, i, u } = nextIds();
  const w = target(spec.targetSel, spec.targetText);
  const o = target(spec.distractorSel, spec.distractorText);

  const distractorEvents = spec.distractor.map((d) => {
    const t = T + d.dt;
    switch (d.kind) {
      case "hover":
        return hover(t, spec.tab, o, d.dwell ?? 500);
      case "click":
        return click(t, spec.tab, o);
      case "focus":
        return focusChange(t, spec.tab, o);
      case "scroll_top":
        return scrollSettle(t, spec.tab, 640, 0.35, o);
    }
  });

  const events: unknown[] = [
    nav(0, spec.tab, spec.route, "load"),
    ...background(spec.tab, T0, spec.route),
    hover(T + spec.targetHover.dt, spec.tab, w, spec.targetHover.dwell),
    click(T + spec.targetClick.dt, spec.tab, w),
    ...distractorEvents,
  ];

  return {
    id: s,
    name: `pointer: ${spec.phrase.slice(0, 42)}`,
    behavior: "POINTER con hover sostenido + click sobre el target; distractor con señales más débiles o más lejanas en el tiempo",
    naiveFailure: "el baseline temporal ignora a qué selector pertenece cada evento y puede tomar el del distractor si cae más cerca de t_start",
    events,
    utterances: [utter(u, spec.phrase, T)],
    expected: { issue: i, anchor: { kind: "element", selector: spec.targetSel } },
  };
}

const pointerSpecs: PointerSpec[] = [
  {
    route: "/agenda/semana",
    tab: 1,
    targetSel: 'button[data-testid="nuevo-turno"]',
    targetText: "Nuevo turno",
    distractorSel: 'button[data-testid="exportar-agenda"]',
    distractorText: "Exportar agenda",
    phrase: "este botón de nuevo turno queda muy chico en mobile",
    targetHover: { dt: -900, dwell: 2100 },
    targetClick: { dt: -300 },
    distractor: [
      { kind: "focus", dt: -4000 },
      { kind: "hover", dt: 1200, dwell: 900 },
    ],
  },
  {
    route: "/clientes",
    tab: 2,
    targetSel: 'button[data-testid="agregar-cliente"]',
    targetText: "Agregar cliente",
    distractorSel: 'button[data-testid="descargar-csv"]',
    distractorText: "Descargar CSV",
    phrase: "ese ícono de agregar quedó mal alineado con el buscador",
    targetHover: { dt: -700, dwell: 1800 },
    targetClick: { dt: -200 },
    distractor: [
      { kind: "scroll_top", dt: -4200 },
      { kind: "click", dt: -3600 },
    ],
  },
  {
    route: "/turnos/historial",
    tab: 3,
    targetSel: 'button[data-testid="ver-detalle"]',
    targetText: "Ver detalle",
    distractorSel: 'button[data-testid="repetir-turno"]',
    distractorText: "Repetir turno",
    phrase: "acá falta un espacio antes del texto del botón",
    targetHover: { dt: -800, dwell: 2000 },
    targetClick: { dt: -250 },
    distractor: [
      { kind: "click", dt: 1300 },
      { kind: "hover", dt: -4300, dwell: 1600 },
    ],
  },
  {
    route: "/caja/cierre",
    tab: 1,
    targetSel: 'button[data-testid="cerrar-caja"]',
    targetText: "Cerrar caja",
    distractorSel: 'button[data-testid="reabrir-caja"]',
    distractorText: "Reabrir caja",
    phrase: "este campo pide demasiados datos para poder cerrar la caja",
    targetHover: { dt: -900, dwell: 2100 },
    targetClick: { dt: -300 },
    distractor: [{ kind: "hover", dt: -1000, dwell: 700 }],
  },
  {
    route: "/inventario/stock",
    tab: 2,
    targetSel: 'button[data-testid="ajustar-stock"]',
    targetText: "Ajustar stock",
    distractorSel: 'button[data-testid="ver-historial-stock"]',
    distractorText: "Ver historial",
    phrase: "ahí quedó todo amontonado, ese ícono sobra en el medio",
    targetHover: { dt: -700, dwell: 1800 },
    targetClick: { dt: -200 },
    distractor: [
      { kind: "click", dt: -3800 },
      { kind: "focus", dt: 400 },
    ],
  },
];
for (const spec of pointerSpecs) scenarios.push(pointerScenario(spec));

interface ActionSpec {
  route: string;
  tab: number;
  targetSel: string;
  targetText: string;
  distractorSel: string;
  distractorText: string;
  phrase: string;
  targetClickDt: number;
  distractor: Array<{ kind: "hover" | "click" | "focus" | "scroll_top"; dt: number }>;
  evidence?: (t_ref: number, tab: number) => unknown[];
}

function actionScenario(spec: ActionSpec): Scenario {
  const { s, i, u } = nextIds();
  const w = target(spec.targetSel, spec.targetText);
  const o = target(spec.distractorSel, spec.distractorText);

  const distractorEvents = spec.distractor.map((d) => {
    const t = T + d.dt;
    switch (d.kind) {
      case "hover":
        return hover(t, spec.tab, o, 500);
      case "click":
        return click(t, spec.tab, o);
      case "focus":
        return focusChange(t, spec.tab, o);
      case "scroll_top":
        return scrollSettle(t, spec.tab, 500, 0.3, o);
    }
  });

  const events: unknown[] = [
    nav(0, spec.tab, spec.route, "load"),
    ...background(spec.tab, T0, spec.route),
    click(T + spec.targetClickDt, spec.tab, w),
    mutationBurst(T + spec.targetClickDt + 700, spec.tab, 24, w),
    ...distractorEvents,
    ...(spec.evidence ? spec.evidence(T, spec.tab) : []),
  ];

  return {
    id: s,
    name: `action: ${spec.phrase.slice(0, 42)}`,
    behavior: "ACTION prefiere el click anterior a t_ref (bias ×2); un click del distractor posterior a t_ref no recibe ese sesgo",
    naiveFailure: "el baseline temporal toma el evento más cercano sin importar si el click quedó antes o después de que arrancara a hablar",
    events,
    utterances: [utter(u, spec.phrase, T)],
    expected: { issue: i, anchor: { kind: "element", selector: spec.targetSel } },
  };
}

const actionSpecs: ActionSpec[] = [
  {
    route: "/agenda/semana",
    tab: 1,
    targetSel: 'button[data-testid="guardar-cambios"]',
    targetText: "Guardar cambios",
    distractorSel: 'button[data-testid="cancelar-turno"]',
    distractorText: "Cancelar turno",
    phrase: "cuando le doy a guardar tarda un montón en responder",
    targetClickDt: -400,
    distractor: [
      { kind: "click", dt: 900 },
      { kind: "hover", dt: -350 },
    ],
    evidence: (t_ref, tab) => [netSlow(t_ref - 1800, tab, "PATCH", "/api/turnos/42", 200, 2200)],
  },
  {
    route: "/clientes/nuevo",
    tab: 2,
    targetSel: 'button[data-testid="guardar-cliente"]',
    targetText: "Guardar cliente",
    distractorSel: 'button[data-testid="cancelar-alta"]',
    distractorText: "Cancelar alta",
    phrase: "al guardar se cuelga toda la pantalla de carga",
    targetClickDt: -550,
    distractor: [
      { kind: "hover", dt: -4000 },
      { kind: "click", dt: 1500 },
    ],
    evidence: (t_ref, tab) => [longTask(t_ref - 1200, tab, 900)],
  },
  {
    route: "/reportes/mensual",
    tab: 3,
    targetSel: 'button[data-testid="generar-reporte"]',
    targetText: "Generar reporte",
    distractorSel: 'button[data-testid="exportar-pdf"]',
    distractorText: "Exportar PDF",
    phrase: "cuando hago clic en generar no pasa absolutamente nada",
    targetClickDt: -300,
    distractor: [
      { kind: "click", dt: 900 },
      { kind: "focus", dt: -3500 },
    ],
    evidence: (t_ref, tab) => [netFail(t_ref - 1000, tab, "POST", "/api/reportes", 500, 300)],
  },
  {
    route: "/configuracion/notificaciones",
    tab: 1,
    targetSel: 'button[data-testid="guardar-preferencias"]',
    targetText: "Guardar preferencias",
    distractorSel: 'button[data-testid="restablecer-default"]',
    distractorText: "Restablecer valores",
    phrase: "al entrar tarda un montón en cargar las preferencias",
    targetClickDt: -600,
    distractor: [
      { kind: "hover", dt: 300 },
      { kind: "click", dt: 1200 },
    ],
    evidence: (t_ref, tab) => [netSlow(t_ref - 2000, tab, "GET", "/api/preferencias", 200, 1900)],
  },
  {
    route: "/pacientes/ficha",
    tab: 2,
    targetSel: 'button[data-testid="confirmar-turno"]',
    targetText: "Confirmar turno",
    distractorSel: 'button[data-testid="reprogramar-turno"]',
    distractorText: "Reprogramar turno",
    phrase: "cuando aprieto confirmar se rompe el formulario entero",
    targetClickDt: -350,
    distractor: [
      { kind: "scroll_top", dt: -4000 },
      { kind: "click", dt: 1000 },
    ],
    evidence: (t_ref, tab) => [consoleEvt(t_ref - 500, tab, "error", "TypeError: cannot read property 'id' of undefined")],
  },
];
for (const spec of actionSpecs) scenarios.push(actionScenario(spec));

interface ScreenGlobalSpec {
  route: string;
  tab: number;
  phrase: string;
  kind: "route" | "session";
  evidence?: (t_ref: number, tab: number) => unknown[];
}

function screenGlobalScenario(spec: ScreenGlobalSpec): Scenario {
  const { s, i, u } = nextIds();
  const w = target('button[data-testid="alguna-accion"]', "Alguna acción");

  const events: unknown[] = [
    nav(0, spec.tab, spec.route, "load"),
    ...background(spec.tab, T0, spec.route),
    // Candidatos presentes igual, para probar que SCREEN/GLOBAL deciden solos, sin
    // scoring de por medio (§07 paso 6): ni el mejor candidato les hace cambiar de clase.
    hover(T - 900, spec.tab, w, 1800),
    click(T - 300, spec.tab, w),
    ...(spec.evidence ? spec.evidence(T, spec.tab) : []),
  ];

  return {
    id: s,
    name: `${spec.kind === "route" ? "screen" : "global"}: ${spec.phrase.slice(0, 40)}`,
    behavior: spec.kind === "route" ? "SCREEN fuerza anchor.kind=route sin importar el scoring" : "GLOBAL fuerza anchor.kind=session sin importar el scoring",
    naiveFailure: "el baseline temporal ancla a un elemento aunque la deixis sea de pantalla o global, porque no clasifica el texto",
    events,
    utterances: [utter(u, spec.phrase, T)],
    expected: { issue: i, anchor: { kind: spec.kind } },
  };
}

const screenSpecs: ScreenGlobalSpec[] = [
  { route: "/agenda/semana", tab: 1, phrase: "esta pantalla necesita un título más claro en la cabecera", kind: "route", evidence: (t, tab) => [layoutShift(t - 800, tab, 0.18)] },
  { route: "/clientes", tab: 2, phrase: "el header queda tapado por el buscador flotante", kind: "route" },
  { route: "/turnos/historial", tab: 3, phrase: "esta sección tiene demasiados filtros repetidos", kind: "route" },
  { route: "/caja/cierre", tab: 1, phrase: "el sidebar molesta cuando abro el resumen de caja", kind: "route" },
  { route: "/reportes/mensual", tab: 2, phrase: "esta vista está totalmente desordenada y sin jerarquía", kind: "route" },
];
for (const spec of screenSpecs) scenarios.push(screenGlobalScenario(spec));

const globalSpecs: ScreenGlobalSpec[] = [
  { route: "/agenda/semana", tab: 1, phrase: "en general la app se ve un poco anticuada todavía", kind: "session" },
  { route: "/clientes", tab: 2, phrase: "en toda la app falta contraste en los botones secundarios", kind: "session" },
  { route: "/inventario/stock", tab: 3, phrase: "en todos lados el buscador tarda para filtrar resultados", kind: "session" },
  { route: "/configuracion/notificaciones", tab: 1, phrase: "siempre que cambio una preferencia se pierde el scroll", kind: "session" },
  { route: "/pacientes/ficha", tab: 2, phrase: "en general las fuentes son muy chicas para leer", kind: "session" },
];
for (const spec of globalSpecs) scenarios.push(screenGlobalScenario(spec));

// ---- Escenarios discriminantes: casos límite de §07 que un correlador ingenuo
//      (o un scoring mal calibrado) resuelve mal ----

function discriminante(
  name: string,
  behavior: string,
  naiveFailure: string,
  build: (i: () => { s: string; i: string; u: string }) => Pick<Scenario, "events" | "utterances" | "expected">,
): Scenario {
  const ids = nextIds();
  const { events, utterances, expected } = build(() => ids);
  return { id: ids.s, name, behavior, naiveFailure, events, utterances, expected };
}

// D1 — pointer resiste dos hovers distractores en paralelo (fusión por selector del lado
// del distractor, no solo del target).
scenarios.push(
  discriminante(
    "pointer resiste dos hovers distractores en paralelo",
    "el hover sostenido + click sobre el target sigue ganando aunque el distractor acumule dos hovers separados (paso 5, fusión por selector)",
    "el baseline temporal puede preferir el hover del distractor más cercano a t_start",
    (ids) => {
      const { s: _s, i, u } = ids();
      const tab = 2;
      const route = "/agenda/semana";
      const w = target('button[data-testid="nuevo-turno"]', "Nuevo turno");
      const o = target('button[data-testid="exportar-agenda"]', "Exportar agenda");
      const events: unknown[] = [
        nav(0, tab, route, "load"),
        ...background(tab, T0, route),
        hover(T - 900, tab, w, 2100),
        click(T - 300, tab, w),
        hover(T - 1200, tab, o, 500),
        hover(T + 1400, tab, o, 600),
      ];
      return {
        events,
        utterances: [utter(u, "este botón de nuevo turno tapa el encabezado de la semana", T)],
        expected: { issue: i, anchor: { kind: "element", selector: 'button[data-testid="nuevo-turno"]' } },
      };
    },
  ),
);

// D2 — action ignora el cursor actual: un hover casi encima de t_ref no le gana al click
// anterior bajo deixis ACTION (el bias ×2 es exclusivo de click).
scenarios.push(
  discriminante(
    "action ignora el cursor actual",
    "ACTION prefiere el click anterior aunque el cursor esté sobre otro botón en el instante exacto de hablar; el hover nunca recibe el bias ×2",
    "el baseline temporal toma el hover casi simultáneo con el arranque del habla en vez del click que la frase describe",
    (ids) => {
      const { s: _s, i, u } = ids();
      const tab = 3;
      const route = "/clientes/nuevo";
      const w = target('button[data-testid="guardar-cliente"]', "Guardar cliente");
      const o = target('button[data-testid="cancelar-alta"]', "Cancelar alta");
      const events: unknown[] = [
        nav(0, tab, route, "load"),
        ...background(tab, T0, route),
        click(T - 400, tab, w),
        hover(T - 50, tab, o, 1000),
      ];
      return {
        events,
        utterances: [utter(u, "cuando aprieto guardar el formulario tarda demasiado", T)],
        expected: { issue: i, anchor: { kind: "element", selector: 'button[data-testid="guardar-cliente"]' } },
      };
    },
  ),
);

// D3 — ambigüedad real: ratio best/second < 1.3. La regla de oro manda degradar a route:
// esto NO contradice §07, es el comportamiento correcto ante scores parecidos.
scenarios.push(
  discriminante(
    "ambigüedad real entre dos paneles",
    "best/second queda por debajo de dominance_ratio (1.3): la regla de oro del paso 6 manda degradar a route en vez de adivinar cuál de los dos paneles es",
    "el baseline temporal siempre elige un candidato arbitrario; nunca degrada aunque los dos estén empatados",
    (ids) => {
      const { s: _s, i, u } = ids();
      const tab = 1;
      const route = "/reportes/mensual";
      const a = target('div[data-testid="panel-resumen"]', "Panel resumen", { tag: "div" });
      const b = target('div[data-testid="panel-detalle"]', "Panel detalle", { tag: "div" });
      const events: unknown[] = [
        nav(0, tab, route, "load"),
        ...background(tab, T0, route),
        click(T - 700, tab, a),
        hover(T - 750, tab, b, 900),
      ];
      return {
        events,
        utterances: [utter(u, "este panel se ve raro comparado con el anterior", T)],
        expected: { issue: i, anchor: { kind: "route" } },
      };
    },
  ),
);

// D4 — visibilidad penaliza al candidato oculto: corregido. El ground truth de F1b
// esperaba que ganara el candidato con visible:false, que es exactamente lo que el
// factor 0.3 del paso 5 existe para evitar. Acá gana el visible.
scenarios.push(
  discriminante(
    "visibilidad penaliza candidato oculto",
    "visibility=false aplica el factor 0.3 del paso 5: aunque el candidato oculto sea más reciente, el visible gana la comparación",
    "el baseline temporal no sabe nada de visibilidad y toma el evento más cercano sin importar si el elemento estaba tapado",
    (ids) => {
      const { s: _s, i, u } = ids();
      const tab = 2;
      const route = "/agenda/semana";
      const visible = target('button[data-testid="nuevo-turno"]', "Nuevo turno", { visible: true });
      const oculto = target('button[data-testid="nuevo-turno-mobile"]', "Nuevo turno", { visible: false });
      const events: unknown[] = [
        nav(0, tab, route, "load"),
        ...background(tab, T0, route),
        click(T - 500, tab, visible),
        click(T - 450, tab, oculto),
      ];
      return {
        events,
        utterances: [utter(u, "este botón no se ve bien, parece que quedó tapado", T)],
        expected: { issue: i, anchor: { kind: "element", selector: 'button[data-testid="nuevo-turno"]' } },
      };
    },
  ),
);

// D5 — corte por marcador de tema: dos utterances que fusionarían por gap corto, pero el
// segundo arranca con "otra cosa" y fuerza un grupo nuevo (§07 paso 1). Solo el primer
// issue se compara (harness_sintetico.rs mide `issues.first()`), así que el segundo grupo
// puede quedar sin anclar sin afectar el resultado.
scenarios.push(
  discriminante(
    "corte por marcador de tema entre dos quejas distintas",
    "el marcador de tema al arranque de la segunda utterance corta la fusión aunque el gap sea corto (paso 1); cada grupo arma su propia ventana de candidatos",
    "el baseline temporal fusiona todo en una sola utterance sin mirar marcadores de tema",
    (ids) => {
      const { s: _s, i, u } = ids();
      const tab = 3;
      const route = "/caja/cierre";
      const w = target('button[data-testid="cerrar-caja"]', "Cerrar caja");
      const o = target('button[data-testid="reabrir-caja"]', "Reabrir caja");
      const u1 = utter(u, "cuando le doy a cerrar la caja tarda un montón en confirmar", T);
      const u2 = utter(`u${String(n + 100).padStart(2, "0")}`, "otra cosa, el título de la sección de caja está mal escrito", u1.t_end + 800);
      const events: unknown[] = [
        nav(0, tab, route, "load"),
        ...background(tab, T0, route),
        click(T - 400, tab, w),
        click(T + 900, tab, o),
      ];
      return {
        events,
        utterances: [u1, u2],
        expected: { issue: i, anchor: { kind: "element", selector: 'button[data-testid="cerrar-caja"]' } },
      };
    },
  ),
);

// D6 — ruido ASR descartable: no_speech_prob alto tira el grupo entero (§07 paso 2). No
// hay que anclar nada porque no hay que crear el issue.
scenarios.push(
  discriminante(
    "ruido asr sin señal de habla",
    "no_speech_prob > 0.6 descarta el grupo entero en el paso 2: no debe generarse ningún issue",
    "el baseline temporal no filtra ruido: crea un ancla desde una utterance que en realidad es silencio o ruido de micrófono",
    (ids) => {
      const { s: _s, i: _i, u } = ids();
      const tab = 1;
      const route = "/inventario/stock";
      const events: unknown[] = [nav(0, tab, route, "load"), ...background(tab, T0, route)];
      return {
        events,
        utterances: [utter(u, "señal espuria captada por el micrófono abierto", T, { no_speech_prob: 0.7 })],
        expected: { issue: null, anchor: { kind: "route" } },
      };
    },
  ),
);

// M1 — ancla dura por `mark`: ventana angosta y centrada en el evento mark (§07 paso 4),
// no en t_start del grupo. Cubre el tipo `mark` y la ventana marcada, que nada más ejercita.
scenarios.push(
  discriminante(
    "marca precisa con hotkey durante hover sostenido",
    "con marked=true y un evento mark dentro de [t_start, t_end], t_ref pasa a ser el instante del mark y la ventana se angosta a [-2500, +500] (paso 4)",
    "el baseline temporal ni sabe qué es un mark: sigue usando t_start del habla, no el instante señalado",
    (ids) => {
      const { s: _s, i, u } = ids();
      const tab = 2;
      const route = "/pacientes/ficha";
      const w = target('button[data-testid="confirmar-turno"]', "Confirmar turno");
      const o = target('button[data-testid="reprogramar-turno"]', "Reprogramar turno");
      const tMark = T;
      const tStart = tMark - 400;
      const events: unknown[] = [
        nav(0, tab, route, "load"),
        ...background(tab, T0, route),
        mark(tMark, tab, "hotkey"),
        hover(tMark - 300, tab, w, 900),
        click(tMark + 100, tab, w),
        hover(tMark - 2200, tab, o, 500),
      ];
      return {
        events,
        utterances: [utter(u, "este botón de confirmar quedó tapado por el modal", tStart, { marked: true })],
        expected: { issue: i, anchor: { kind: "element", selector: 'button[data-testid="confirmar-turno"]' } },
      };
    },
  ),
);

// ─────────────────────────────────────────────────────────────────────────────
// Generación, baseline ingenuo y validación de schema
// ─────────────────────────────────────────────────────────────────────────────

export async function generate(out = join(process.cwd(), "expected")): Promise<void> {
  await mkdir(out, { recursive: true });
  for (const sc of scenarios) {
    await writeFile(join(out, `${sc.id}.events.ndjson`), sc.events.map((e) => JSON.stringify(e)).join("\n") + "\n");
    await writeFile(join(out, `${sc.id}.utterances.json`), JSON.stringify(sc.utterances, null, 2) + "\n");
    await writeFile(join(out, `${sc.id}.expected.json`), JSON.stringify(sc.expected, null, 2) + "\n");
  }
  await writeFile(
    join(out, "manifest.json"),
    JSON.stringify(
      {
        version: 3,
        count: scenarios.length,
        scenarios: scenarios.map(({ id, name, behavior, naiveFailure }) => ({ id, name, behavior, naiveFailure })),
      },
      null,
      2,
    ) + "\n",
  );
}

/** Baseline temporal ingenuo: toma el candidato (de los 4 tipos anclables) más cercano en
 * el tiempo a t_start de la primera utterance, sin mirar selector, deixis ni scoring. */
function naive(sc: Scenario): string | undefined {
  const u = sc.utterances[0] as { t_start: number };
  const candidateKinds = new Set(["click", "hover", "focus_change", "scroll_settle"]);
  const cands = sc.events.filter((e): e is { t: number; k: string; target?: { sel: string }; top_target?: { sel: string } } => {
    const ev = e as { k?: string };
    return typeof ev.k === "string" && candidateKinds.has(ev.k);
  });
  let best: (typeof cands)[number] | undefined;
  let bestDt = Infinity;
  for (const c of cands) {
    const dt = Math.abs(c.t - u.t_start);
    if (dt < bestDt) {
      bestDt = dt;
      best = c;
    }
  }
  return best?.target?.sel ?? best?.top_target?.sel;
}

/** Relee cada .events.ndjson y .utterances.json ya escritos en disco y valida cada línea
 * contra el schema real de @qua/protocol. Es la garantía de que un tipo inventado (como el
 * `scroll` de F1b) o un campo faltante no vuelvan a colarse en el harness. */
async function validateSchema(dir: string): Promise<{ totalEvents: number; invalidEvents: string[]; totalUtterances: number; invalidUtterances: string[] }> {
  const files = await readdir(dir);
  const invalidEvents: string[] = [];
  const invalidUtterances: string[] = [];
  let totalEvents = 0;
  let totalUtterances = 0;

  for (const f of files.filter((x) => x.endsWith(".events.ndjson"))) {
    const content = await readFile(join(dir, f), "utf8");
    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    lines.forEach((line, idx) => {
      totalEvents++;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch (e) {
        invalidEvents.push(`${f}:${idx + 1}: JSON inválido — ${(e as Error).message}`);
        return;
      }
      const result = EventSchema.safeParse(parsed);
      if (!result.success) {
        invalidEvents.push(`${f}:${idx + 1}: ${result.error.issues.map((iss) => `${iss.path.join(".")}: ${iss.message}`).join("; ")}`);
      }
    });
  }

  for (const f of files.filter((x) => x.endsWith(".utterances.json"))) {
    const content = await readFile(join(dir, f), "utf8");
    const parsed = JSON.parse(content) as unknown[];
    parsed.forEach((u, idx) => {
      totalUtterances++;
      const result = UtteranceSchema.safeParse(u);
      if (!result.success) {
        invalidUtterances.push(`${f}[${idx}]: ${result.error.issues.map((iss) => `${iss.path.join(".")}: ${iss.message}`).join("; ")}`);
      }
    });
  }

  return { totalEvents, invalidEvents, totalUtterances, invalidUtterances };
}

export async function check(dir = join(process.cwd(), "expected")): Promise<boolean> {
  let good = 0;
  for (const sc of scenarios) {
    const expected = JSON.parse(await readFile(join(dir, `${sc.id}.expected.json`), "utf8"));
    if (JSON.stringify(expected) === JSON.stringify(sc.expected)) good++;
  }

  let ng = 0;
  for (const sc of scenarios) {
    const selector = "selector" in sc.expected.anchor ? sc.expected.anchor.selector : undefined;
    if (selector && naive(sc) === selector) ng++;
  }
  const naivePct = (ng / scenarios.length) * 100;

  const { totalEvents, invalidEvents, totalUtterances, invalidUtterances } = await validateSchema(dir);

  console.log(
    `qua-synth: ${good}/${scenarios.length} ground truth ok (${((good / scenarios.length) * 100).toFixed(1)}%); ` +
      `naive temporal: ${ng}/${scenarios.length} (${naivePct.toFixed(1)}%)`,
  );
  console.log(
    `qua-synth: validación de schema — eventos ${totalEvents - invalidEvents.length}/${totalEvents} válidos, ` +
      `utterances ${totalUtterances - invalidUtterances.length}/${totalUtterances} válidas`,
  );
  if (invalidEvents.length > 0) {
    console.error(`${invalidEvents.length} línea(s) de evento inválidas contra EventSchema:`);
    for (const msg of invalidEvents.slice(0, 30)) console.error(`  ${msg}`);
    if (invalidEvents.length > 30) console.error(`  … y ${invalidEvents.length - 30} más`);
  }
  if (invalidUtterances.length > 0) {
    console.error(`${invalidUtterances.length} utterance(s) inválidas contra UtteranceSchema:`);
    for (const msg of invalidUtterances.slice(0, 30)) console.error(`  ${msg}`);
  }

  return good === scenarios.length && naivePct < 60 && invalidEvents.length === 0 && invalidUtterances.length === 0;
}

if (process.argv.includes("--check")) {
  await generate();
  process.exit((await check()) ? 0 : 1);
} else {
  await generate();
  console.log(`generated ${scenarios.length} scenarios in expected/`);
}
