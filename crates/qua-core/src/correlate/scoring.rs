//! §07 pasos 4 y 5 — ventana asimétrica de candidatos y scoring.

use qua_protocol::{Event, TargetRef};

use super::config::CorrelatorConfig;
use super::deixis::Deixis;

/// Los 4 tipos de evento que pueden ser candidatos a ancla (§07 paso 4).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CandidateKind {
    Click,
    Hover,
    Focus,
    ScrollTop,
}

impl CandidateKind {
    pub fn as_str(self) -> &'static str {
        match self {
            CandidateKind::Click => "click",
            CandidateKind::Hover => "hover",
            CandidateKind::Focus => "focus",
            CandidateKind::ScrollTop => "scroll_top",
        }
    }

    fn base(self, cfg: &CorrelatorConfig) -> f64 {
        match self {
            CandidateKind::Click => cfg.base_click,
            CandidateKind::Hover => cfg.base_hover,
            CandidateKind::Focus => cfg.base_focus,
            CandidateKind::ScrollTop => cfg.base_scroll_top,
        }
    }
}

/// Un evento de la ventana, ya puntuado.
#[derive(Debug, Clone, PartialEq)]
pub struct Candidate {
    pub kind: CandidateKind,
    pub t: i64,
    pub target: TargetRef,
    /// Solo en `hover`. Lo usa el `reason[]`: «hover 2.1s».
    pub dwell_ms: Option<i64>,
    pub score: f64,
}

impl Candidate {
    /// Entrada del `reason[]` de §07 paso 6: `click −0.9s`, `hover 2.1s`.
    ///
    /// El `hover` reporta su permanencia; el resto, el desfasaje contra `t_ref` con signo
    /// (negativo = antes de hablar, que es el caso normal).
    pub fn reason(&self, t_ref: i64) -> String {
        match self.kind {
            CandidateKind::Hover => {
                format!("hover {:.1}s", self.dwell_ms.unwrap_or(0) as f64 / 1000.0)
            }
            _ => {
                let d = (self.t - t_ref) as f64 / 1000.0;
                // U+2212 MINUS SIGN, como en §07 y §8.1.
                let signo = if d < 0.0 { "−" } else { "" };
                format!("{} {}{:.1}s", self.kind.as_str(), signo, d.abs())
            }
        }
    }
}

/// Candidatos fusionados por selector (§07 paso 5, última línea).
#[derive(Debug, Clone, PartialEq)]
pub struct ScoredTarget {
    pub sel: String,
    /// El `TargetRef` del evento más reciente: «se conserva el rect más reciente».
    pub target: TargetRef,
    /// Suma de los scores de los candidatos que resuelven a este `sel`.
    pub score: f64,
    /// De mayor a menor aporte. Alimenta el `reason[]`.
    pub contributions: Vec<Candidate>,
}

/// La ventana `W` de §07 paso 4, con `t_ref`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Window {
    pub t_ref: i64,
    pub from: i64,
    pub to: i64,
}

/// `t_ref = marked ? t_del_mark : t_start_del_grupo`, y la ventana asimétrica.
///
/// Mira mucho más hacia atrás que hacia adelante a propósito: cuando decís «este botón es
/// muy chico», el hover ocurrió antes de que abrieras la boca (§07 paso 4).
pub fn window(t_start: i64, mark_t: Option<i64>, cfg: &CorrelatorConfig) -> Window {
    match mark_t {
        Some(t_ref) => Window {
            t_ref,
            from: t_ref - cfg.marked_window_back_ms,
            to: t_ref + cfg.marked_window_fwd_ms,
        },
        None => Window {
            t_ref: t_start,
            from: t_start - cfg.window_back_ms,
            to: t_start + cfg.window_fwd_ms,
        },
    }
}

/// Paso 4: eventos de `W` de tipo click · hover (dwell ≥ 400 ms) · focus_change ·
/// scroll_settle.top_target, restringidos a `tab` si se pasa una.
pub fn candidates_in_window(
    events: &[Event],
    w: Window,
    tab: Option<i64>,
    cfg: &CorrelatorConfig,
) -> Vec<Candidate> {
    events
        .iter()
        .filter(|e| e.t() >= w.from && e.t() <= w.to)
        .filter(|e| match (tab, e.tab()) {
            (Some(want), Some(got)) => want == got,
            // Un evento sin `tab` no se descarta: el contrato lo permite (§03).
            _ => true,
        })
        .filter_map(|e| match e {
            Event::Click { t, target, .. } => Some(Candidate {
                kind: CandidateKind::Click,
                t: *t,
                target: target.clone(),
                dwell_ms: None,
                score: 0.0,
            }),
            Event::Hover {
                t,
                target,
                dwell_ms,
                ..
            } if *dwell_ms >= cfg.min_hover_dwell_ms => Some(Candidate {
                kind: CandidateKind::Hover,
                t: *t,
                target: target.clone(),
                dwell_ms: Some(*dwell_ms),
                score: 0.0,
            }),
            Event::FocusChange { t, target, .. } => Some(Candidate {
                kind: CandidateKind::Focus,
                t: *t,
                target: target.clone(),
                dwell_ms: None,
                score: 0.0,
            }),
            Event::ScrollSettle {
                t,
                top_target: Some(target),
                ..
            } => Some(Candidate {
                kind: CandidateKind::ScrollTop,
                t: *t,
                target: target.clone(),
                dwell_ms: None,
                score: 0.0,
            }),
            _ => None,
        })
        .collect()
}

/// `recency(c) = exp(−|t_ref − c.t| / decay_ms)`.
pub fn recency(t_ref: i64, t: i64, cfg: &CorrelatorConfig) -> f64 {
    (-((t_ref - t).abs() as f64) / cfg.decay_ms).exp()
}

/// `bias(c)`: ×1.5 con POINTER sobre hover/click, ×2 con ACTION sobre el click anterior.
pub fn bias(c: &Candidate, t_ref: i64, deixis: Deixis, cfg: &CorrelatorConfig) -> f64 {
    match deixis {
        Deixis::Pointer if matches!(c.kind, CandidateKind::Hover | CandidateKind::Click) => {
            cfg.bias_pointer
        }
        Deixis::Action if c.kind == CandidateKind::Click && c.t < t_ref => cfg.bias_action,
        _ => 1.0,
    }
}

/// `visibility(c)`: 1.0 si el target es visible y tiene área, si no 0.3.
///
/// Se penaliza solo con **evidencia positiva** de que el elemento no se ve: `visible:
/// false`, o un `rect` con ancho o alto 0. Un `TargetRef` sin `rect` —el contrato los hace
/// opcionales (§03)— no se castiga, porque «no sé» no es «está oculto».
pub fn visibility(target: &TargetRef, cfg: &CorrelatorConfig) -> f64 {
    let oculto = target.visible == Some(false);
    let sin_area = target
        .rect
        .as_ref()
        .is_some_and(|r| r.w <= 0.0 || r.h <= 0.0);
    if oculto || sin_area {
        cfg.visibility_penalty
    } else {
        1.0
    }
}

/// Paso 5: `score(c) = base(c.k) × recency(c) × bias(c) × visibility(c)`.
pub fn score_candidates(
    candidates: &mut [Candidate],
    t_ref: i64,
    deixis: Deixis,
    cfg: &CorrelatorConfig,
) {
    for c in candidates.iter_mut() {
        c.score = c.kind.base(cfg)
            * recency(t_ref, c.t, cfg)
            * bias(c, t_ref, deixis, cfg)
            * visibility(&c.target, cfg);
    }
}

/// Paso 5, última línea: «los candidatos que resuelven al mismo `sel` se fusionan: se
/// suman los scores y se conserva el rect más reciente».
///
/// `cfg.merge_extra_weight` pesa los aportes que no son el más fuerte: `1.0` —el default—
/// es la suma literal de la spec.
///
/// Devuelve los targets ordenados por score descendente; a igual score, el de evento más
/// reciente primero, para que el orden sea determinístico.
pub fn merge_by_selector(candidates: Vec<Candidate>, cfg: &CorrelatorConfig) -> Vec<ScoredTarget> {
    let mut out: Vec<ScoredTarget> = Vec::new();
    for c in candidates {
        match out.iter_mut().find(|s| s.sel == c.target.sel) {
            Some(s) => {
                s.score += c.score;
                if c.t >= s.contributions.iter().map(|x| x.t).max().unwrap_or(i64::MIN) {
                    s.target = c.target.clone();
                }
                s.contributions.push(c);
            }
            None => out.push(ScoredTarget {
                sel: c.target.sel.clone(),
                target: c.target.clone(),
                score: c.score,
                contributions: vec![c],
            }),
        }
    }
    for s in &mut out {
        s.contributions
            .sort_by(|a, b| b.score.total_cmp(&a.score).then(b.t.cmp(&a.t)));
        let fuerte = s.contributions.first().map_or(0.0, |c| c.score);
        s.score = fuerte + cfg.merge_extra_weight * (s.score - fuerte);
    }
    out.sort_by(|a, b| {
        b.score.total_cmp(&a.score).then_with(|| {
            let ta = a.contributions.iter().map(|c| c.t).max().unwrap_or(0);
            let tb = b.contributions.iter().map(|c| c.t).max().unwrap_or(0);
            tb.cmp(&ta)
        })
    });
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::correlate::testkit::{click, focus, hover, scroll_settle, target};

    fn cfg() -> CorrelatorConfig {
        CorrelatorConfig::default()
    }

    #[test]
    fn la_ventana_sin_mark_es_asimetrica() {
        let w = window(10_000, None, &cfg());
        assert_eq!((w.t_ref, w.from, w.to), (10_000, 5_500, 11_500));
    }

    #[test]
    fn la_ventana_con_mark_se_centra_en_el_mark_y_se_angosta() {
        let w = window(10_000, Some(12_000), &cfg());
        assert_eq!((w.t_ref, w.from, w.to), (12_000, 9_500, 12_500));
    }

    #[test]
    fn recoge_los_cuatro_tipos_y_nada_mas() {
        let evs = vec![
            click(9_000, 1, "a"),
            hover(9_200, 1, "b", 500),
            focus(9_400, 1, "c"),
            scroll_settle(9_600, 1, Some("d")),
            // No candidatos:
            scroll_settle(9_700, 1, None),
            crate::correlate::testkit::nav(9_800, 1, "/x"),
            crate::correlate::testkit::console_error(9_900, 1, "boom"),
        ];
        let w = window(10_000, None, &cfg());
        let cs = candidates_in_window(&evs, w, Some(1), &cfg());
        assert_eq!(cs.len(), 4);
        assert_eq!(
            cs.iter().map(|c| c.kind).collect::<Vec<_>>(),
            vec![
                CandidateKind::Click,
                CandidateKind::Hover,
                CandidateKind::Focus,
                CandidateKind::ScrollTop
            ]
        );
    }

    #[test]
    fn el_hover_corto_no_es_candidato() {
        let evs = vec![hover(9_000, 1, "a", 399), hover(9_100, 1, "b", 400)];
        let w = window(10_000, None, &cfg());
        let cs = candidates_in_window(&evs, w, Some(1), &cfg());
        assert_eq!(cs.len(), 1);
        assert_eq!(cs[0].target.sel, "b");
    }

    #[test]
    fn la_ventana_recorta_por_los_dos_lados() {
        let evs = vec![
            click(5_499, 1, "muy-viejo"),
            click(5_500, 1, "justo-atras"),
            click(11_500, 1, "justo-adelante"),
            click(11_501, 1, "muy-nuevo"),
        ];
        let w = window(10_000, None, &cfg());
        let sels: Vec<_> = candidates_in_window(&evs, w, Some(1), &cfg())
            .into_iter()
            .map(|c| c.target.sel)
            .collect();
        assert_eq!(sels, vec!["justo-atras", "justo-adelante"]);
    }

    #[test]
    fn filtra_por_pestaña() {
        let evs = vec![click(9_000, 1, "aca"), click(9_100, 7, "otra-pestaña")];
        let w = window(10_000, None, &cfg());
        let cs = candidates_in_window(&evs, w, Some(1), &cfg());
        assert_eq!(cs.len(), 1);
        assert_eq!(cs[0].target.sel, "aca");
    }

    #[test]
    fn recency_decae_como_la_exponencial_de_la_spec() {
        let c = cfg();
        assert!((recency(10_000, 10_000, &c) - 1.0).abs() < 1e-12);
        // exp(−1) a exactamente decay_ms de distancia, para los dos lados.
        assert!((recency(10_000, 7_500, &c) - std::f64::consts::E.recip()).abs() < 1e-12);
        assert!((recency(10_000, 12_500, &c) - std::f64::consts::E.recip()).abs() < 1e-12);
    }

    #[test]
    fn el_bias_pointer_toca_hover_y_click_pero_no_focus() {
        let c = cfg();
        let mk = |k: CandidateKind, t: i64| Candidate {
            kind: k,
            t,
            target: target("x", true),
            dwell_ms: None,
            score: 0.0,
        };
        assert_eq!(
            bias(&mk(CandidateKind::Click, 9_000), 10_000, Deixis::Pointer, &c),
            1.5
        );
        assert_eq!(
            bias(&mk(CandidateKind::Hover, 9_000), 10_000, Deixis::Pointer, &c),
            1.5
        );
        assert_eq!(
            bias(&mk(CandidateKind::Focus, 9_000), 10_000, Deixis::Pointer, &c),
            1.0
        );
    }

    /// ACTION habla del click **anterior**: uno posterior a `t_ref` no lleva el ×2.
    #[test]
    fn el_bias_action_solo_mira_hacia_atras() {
        let c = cfg();
        let mk = |t: i64| Candidate {
            kind: CandidateKind::Click,
            t,
            target: target("x", true),
            dwell_ms: None,
            score: 0.0,
        };
        assert_eq!(bias(&mk(9_000), 10_000, Deixis::Action, &c), 2.0);
        assert_eq!(bias(&mk(10_000), 10_000, Deixis::Action, &c), 1.0);
        assert_eq!(bias(&mk(10_500), 10_000, Deixis::Action, &c), 1.0);
        assert_eq!(
            bias(
                &Candidate {
                    kind: CandidateKind::Hover,
                    t: 9_000,
                    target: target("x", true),
                    dwell_ms: Some(900),
                    score: 0.0
                },
                10_000,
                Deixis::Action,
                &c
            ),
            1.0
        );
    }

    #[test]
    fn visibilidad_penaliza_lo_oculto_y_lo_de_area_cero() {
        let c = cfg();
        assert_eq!(visibility(&target("x", true), &c), 1.0);
        assert_eq!(visibility(&target("x", false), &c), 0.3);

        let mut t = target("x", true);
        t.rect = Some(qua_protocol::Rect {
            x: 0.0,
            y: 0.0,
            w: 0.0,
            h: 32.0,
        });
        assert_eq!(visibility(&t, &c), 0.3);

        // Sin `rect` no se sabe: no se castiga.
        let mut t = target("x", true);
        t.visible = None;
        t.rect = None;
        assert_eq!(visibility(&t, &c), 1.0);
    }

    #[test]
    fn el_score_es_el_producto_de_los_cuatro_factores() {
        let c = cfg();
        let mut cs = vec![Candidate {
            kind: CandidateKind::Click,
            t: 9_100,
            target: target("x", true),
            dwell_ms: None,
            score: 0.0,
        }];
        score_candidates(&mut cs, 10_000, Deixis::Pointer, &c);
        let esperado = 3.0 * (-900.0f64 / 2500.0).exp() * 1.5 * 1.0;
        assert!((cs[0].score - esperado).abs() < 1e-12, "{}", cs[0].score);
    }

    #[test]
    fn fusiona_por_selector_sumando_y_ordena_por_score() {
        let c = cfg();
        let mut cs = vec![
            Candidate {
                kind: CandidateKind::Hover,
                t: 9_000,
                target: target("a", true),
                dwell_ms: Some(1_400),
                score: 0.0,
            },
            Candidate {
                kind: CandidateKind::Click,
                t: 9_500,
                target: target("a", true),
                dwell_ms: None,
                score: 0.0,
            },
            Candidate {
                kind: CandidateKind::Focus,
                t: 9_800,
                target: target("b", true),
                dwell_ms: None,
                score: 0.0,
            },
        ];
        score_candidates(&mut cs, 10_000, Deixis::None, &c);
        let suma_a = cs[0].score + cs[1].score;
        let merged = merge_by_selector(cs, &c);
        assert_eq!(merged.len(), 2);
        assert_eq!(merged[0].sel, "a");
        assert!((merged[0].score - suma_a).abs() < 1e-12);
        assert_eq!(merged[0].contributions.len(), 2);
    }

    /// «se conserva el rect más reciente».
    #[test]
    fn la_fusion_conserva_el_rect_mas_reciente() {
        let mut viejo = target("a", true);
        viejo.rect = Some(qua_protocol::Rect {
            x: 0.0,
            y: 0.0,
            w: 10.0,
            h: 10.0,
        });
        let mut nuevo = target("a", true);
        nuevo.rect = Some(qua_protocol::Rect {
            x: 100.0,
            y: 200.0,
            w: 88.0,
            h: 32.0,
        });
        let merged = merge_by_selector(vec![
            Candidate {
                kind: CandidateKind::Click,
                t: 9_900,
                target: nuevo.clone(),
                dwell_ms: None,
                score: 2.0,
            },
            Candidate {
                kind: CandidateKind::Hover,
                t: 9_000,
                target: viejo,
                dwell_ms: Some(500),
                score: 1.0,
            },
        ], &cfg());
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].target.rect, nuevo.rect);
    }

    /// `merge_extra_weight = 0` deja el score del aporte más fuerte, sin sumar el resto.
    #[test]
    fn el_peso_de_fusion_es_configurable() {
        let cs = || {
            vec![
                Candidate {
                    kind: CandidateKind::Click,
                    t: 9_500,
                    target: target("a", true),
                    dwell_ms: None,
                    score: 3.0,
                },
                Candidate {
                    kind: CandidateKind::Focus,
                    t: 9_000,
                    target: target("a", true),
                    dwell_ms: None,
                    score: 1.0,
                },
            ]
        };
        assert_eq!(merge_by_selector(cs(), &cfg())[0].score, 4.0);

        let mut c = cfg();
        c.merge_extra_weight = 0.0;
        assert_eq!(merge_by_selector(cs(), &c)[0].score, 3.0);

        c.merge_extra_weight = 0.5;
        assert_eq!(merge_by_selector(cs(), &c)[0].score, 3.5);
    }

    #[test]
    fn el_reason_usa_el_formato_de_la_spec() {
        let click = Candidate {
            kind: CandidateKind::Click,
            t: 9_100,
            target: target("x", true),
            dwell_ms: None,
            score: 0.0,
        };
        assert_eq!(click.reason(10_000), "click −0.9s");
        let hover = Candidate {
            kind: CandidateKind::Hover,
            t: 9_000,
            target: target("x", true),
            dwell_ms: Some(2_100),
            score: 0.0,
        };
        assert_eq!(hover.reason(10_000), "hover 2.1s");
    }
}
