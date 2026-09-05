//! §07 paso 6 — decidir el ancla.
//!
//! > **Regla de oro.** Ante duda, degradar a `route`. Un issue anclado a la ruta correcta
//! > es útil; uno anclado al elemento equivocado manda al agente a editar el archivo
//! > equivocado, que es peor que no anclar.

use qua_protocol::{Anchor, AnchorKind};

use super::config::CorrelatorConfig;
use super::deixis::{Deixis, DeixisMatch};
use super::scoring::ScoredTarget;

/// Contexto de ruta del issue: a qué pestaña y URL pertenece `t_ref`.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct RouteContext {
    pub tab: Option<i64>,
    pub url: Option<String>,
}

/// Por qué se degradó a `route`. Va al `reason[]` para que el reporte lo explique.
fn degrade_note(best: Option<&ScoredTarget>, ratio: Option<f64>, cfg: &CorrelatorConfig) -> String {
    match (best, ratio) {
        (None, _) => "sin candidatos en la ventana".to_string(),
        (Some(b), _) if b.score < cfg.min_score => {
            format!("score {:.2} < min_score {:.2}", b.score, cfg.min_score)
        }
        (Some(_), Some(r)) => format!(
            "ambiguo: best/second {:.2} < {:.2}",
            r, cfg.dominance_ratio
        ),
        (Some(_), None) => "degradado a route".to_string(),
    }
}

/// Aplica el paso 6 completo sobre los targets ya fusionados y ordenados por score.
///
/// `targets` tiene que venir ordenado por score descendente (lo deja así
/// [`super::scoring::merge_by_selector`]).
pub fn decide(
    targets: &[ScoredTarget],
    deixis: &DeixisMatch,
    t_ref: i64,
    route: &RouteContext,
    cfg: &CorrelatorConfig,
) -> Anchor {
    let mut reason: Vec<String> = Vec::new();
    let deixis_reason = deixis.reason();

    // SCREEN y GLOBAL deciden solas: no hay scoring que valga contra «esta pantalla».
    if matches!(deixis.class, Deixis::Screen | Deixis::Global) {
        let kind = if deixis.class == Deixis::Screen {
            AnchorKind::Route
        } else {
            AnchorKind::Session
        };
        if let Some(r) = deixis_reason {
            reason.push(r);
        }
        return Anchor {
            kind,
            target: None,
            tab: route.tab,
            url: route.url.clone(),
            confidence: clamp01(cfg.deictic_confidence),
            reason,
        };
    }

    let best = targets.first();
    let second = targets.get(1);
    let ratio = match (best, second) {
        (Some(b), Some(s)) if s.score > 0.0 => Some(b.score / s.score),
        (Some(_), Some(_)) => None, // second con score 0: no hay competencia real
        _ => None,
    };
    let domina = ratio.is_none_or(|r| r >= cfg.dominance_ratio);

    // La confianza mide el **aporte individual más fuerte**, no el score fusionado: la
    // corroboración de varios eventos ayuda a ganar la comparación, pero no puede inventar
    // evidencia que no existe. Ver `docs/DECISIONS.md`, D-B3-07.
    //
    // Se normaliza contra el máximo alcanzable de la **clase de deixis en juego**, no
    // contra una constante global: `confidence_divisor` (6.0) es el techo de un candidato
    // ACTION perfecto (`click 3.0 × bias 2.0`), pero POINTER solo puede llegar a `3.0 ×
    // 1.5 = 4.5` y sin deixis a `3.0 × 1.0 = 3.0`. Dividir siempre por 6.0 le pone un techo
    // artificial de 0.75 a un match POINTER perfecto. Ver `docs/DECISIONS.md`, D-B6-01.
    let confidence = {
        let max_posible = max_possible_score(deixis.class, cfg);
        let base = best.map_or(0.0, |b| clamp01(b.max_contribution / max_posible));
        if domina {
            base
        } else {
            base * cfg.ambiguity_penalty
        }
    };

    let elegible = best.is_some_and(|b| b.score >= cfg.min_score) && domina;

    if elegible {
        let b = best.expect("elegible implica best");
        // `[más fuerte, deixis, resto]`: reproduce el orden de los dos ejemplos de la spec.
        let mut aportes = b.contributions.iter().map(|c| c.reason(t_ref));
        if let Some(primero) = aportes.next() {
            reason.push(primero);
        }
        if let Some(r) = deixis_reason {
            reason.push(r);
        }
        reason.extend(aportes);
        Anchor {
            kind: AnchorKind::Element,
            target: Some(b.target.clone()),
            tab: route.tab,
            url: route.url.clone(),
            confidence,
            reason,
        }
    } else {
        if let Some(r) = deixis_reason {
            reason.push(r);
        }
        reason.push(degrade_note(best, ratio, cfg));
        Anchor {
            kind: AnchorKind::Route,
            target: None,
            tab: route.tab,
            url: route.url.clone(),
            confidence,
            reason,
        }
    }
}

fn clamp01(v: f64) -> f64 {
    v.clamp(0.0, 1.0)
}

/// El score máximo alcanzable por un solo candidato en la clase de deixis dada:
/// `base_click × bias_de_la_clase × recency(1.0) × visibility(1.0)`.
///
/// `base_click` (el más alto de los cuatro `base`) sale de `confidence_divisor /
/// bias_action`, en vez de estar hardcodeado: `confidence_divisor` sigue siendo el umbral
/// configurable de `[correlator]` que documenta D-B3-01, así que tunearlo desde el toml
/// escala las tres clases a la vez.
fn max_possible_score(deixis: Deixis, cfg: &CorrelatorConfig) -> f64 {
    let base_max = cfg.confidence_divisor / cfg.bias_action;
    match deixis {
        Deixis::Action => base_max * cfg.bias_action,
        Deixis::Pointer => base_max * cfg.bias_pointer,
        // SCREEN/GLOBAL no llegan acá (se resuelven antes); sin deixis, ninguna bias aplica.
        Deixis::None | Deixis::Screen | Deixis::Global => base_max,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::correlate::scoring::{Candidate, CandidateKind};
    use crate::correlate::testkit::target;

    fn cfg() -> CorrelatorConfig {
        CorrelatorConfig::default()
    }

    fn ruta() -> RouteContext {
        RouteContext {
            tab: Some(42),
            url: Some("/agenda/semana".into()),
        }
    }

    /// Un target de un solo aporte: `score` y `max_contribution` coinciden.
    fn st(sel: &str, score: f64) -> ScoredTarget {
        ScoredTarget {
            sel: sel.into(),
            target: target(sel, true),
            score,
            max_contribution: score,
            contributions: vec![Candidate {
                kind: CandidateKind::Click,
                t: 9_100,
                target: target(sel, true),
                dwell_ms: None,
                score,
            }],
        }
    }

    /// Un target que llegó al score `score` acumulando aportes chicos: el más fuerte es
    /// `max`.
    fn st_acumulado(sel: &str, score: f64, max: f64) -> ScoredTarget {
        ScoredTarget {
            max_contribution: max,
            ..st(sel, score)
        }
    }

    fn sin_deixis() -> DeixisMatch {
        crate::correlate::deixis::classify("nada de deixis")
    }

    #[test]
    fn screen_fuerza_route_y_global_fuerza_session() {
        let a = decide(
            &[st("a", 9.0)],
            &crate::correlate::deixis::classify("esta pantalla está desordenada"),
            10_000,
            &ruta(),
            &cfg(),
        );
        assert_eq!(a.kind, AnchorKind::Route);
        assert_eq!(a.target, None);
        assert_eq!(a.reason, vec!["deixis:esta pantalla"]);

        let a = decide(
            &[st("a", 9.0)],
            &crate::correlate::deixis::classify("en general la app se ve mal"),
            10_000,
            &ruta(),
            &cfg(),
        );
        assert_eq!(a.kind, AnchorKind::Session);
        assert_eq!(a.target, None);
    }

    /// Un ganador claro y por encima de `min_score`: ancla a elemento. Sin deixis, `a` con
    /// score 3.0 es exactamente el máximo posible de esa clase (`base_click × 1.0 × 1.0 ×
    /// 1.0`): confianza 1.0.
    #[test]
    fn ancla_a_elemento_cuando_domina() {
        let a = decide(&[st("a", 3.0), st("b", 1.0)], &sin_deixis(), 10_000, &ruta(), &cfg());
        assert_eq!(a.kind, AnchorKind::Element);
        assert_eq!(a.target.expect("target").sel, "a");
        assert!((a.confidence - 1.0).abs() < 1e-12);
    }

    /// La regla de oro: dos scores parecidos → route, no elemento equivocado.
    #[test]
    fn degrada_a_route_por_ambiguedad() {
        let a = decide(&[st("a", 3.0), st("b", 2.6)], &sin_deixis(), 10_000, &ruta(), &cfg());
        assert_eq!(a.kind, AnchorKind::Route);
        assert_eq!(a.target, None);
        // 3.0/3.0 = 1.0, penalizado ×0.7.
        assert!((a.confidence - 0.7).abs() < 1e-12);
        assert!(a.reason.iter().any(|r| r.contains("ambiguo")));
    }

    #[test]
    fn el_ratio_justo_en_el_umbral_ancla() {
        let a = decide(&[st("a", 2.6), st("b", 2.0)], &sin_deixis(), 10_000, &ruta(), &cfg());
        assert_eq!(a.kind, AnchorKind::Element);
    }

    #[test]
    fn degrada_a_route_por_score_bajo() {
        let a = decide(&[st("a", 1.9)], &sin_deixis(), 10_000, &ruta(), &cfg());
        assert_eq!(a.kind, AnchorKind::Route);
        assert!(a.reason.iter().any(|r| r.contains("min_score")));
        assert!((a.confidence - 1.9 / 3.0).abs() < 1e-12);
    }

    #[test]
    fn el_score_justo_en_min_score_ancla() {
        let a = decide(&[st("a", 2.0)], &sin_deixis(), 10_000, &ruta(), &cfg());
        assert_eq!(a.kind, AnchorKind::Element);
    }

    #[test]
    fn sin_candidatos_degrada_a_route_con_confianza_cero() {
        let a = decide(&[], &sin_deixis(), 10_000, &ruta(), &cfg());
        assert_eq!(a.kind, AnchorKind::Route);
        assert_eq!(a.confidence, 0.0);
        assert!(a.reason.iter().any(|r| r.contains("sin candidatos")));
    }

    /// Un caso ambiguo nunca puede quedar anclado a elemento con confianza > 0.5
    /// (criterio de aceptación de B3 en §14).
    #[test]
    fn ningun_ambiguo_queda_anclado_a_elemento() {
        for (a, b) in [(3.0, 2.6), (6.0, 5.0), (12.0, 10.0), (2.0, 1.9)] {
            let anchor = decide(&[st("x", a), st("y", b)], &sin_deixis(), 10_000, &ruta(), &cfg());
            assert_eq!(anchor.kind, AnchorKind::Route, "best={a} second={b}");
        }
    }

    /// La decisión del coordinador sobre D-B3-07: un candidato que gana **por acumulación**
    /// puede ganar la comparación, pero llega con la confianza de su mejor evidencia sola.
    ///
    /// `ruidoso` gana el score fusionado (3.9 contra 3.0, ratio exactamente en el umbral de
    /// dominancia) acumulando aportes chicos: ninguno solo pasa de 1.2. Ver D-B6-01 en
    /// `docs/DECISIONS.md` sobre por qué esto ya no es una garantía general una vez que el
    /// divisor depende de la clase de deixis — acá se elige `max` deliberadamente bajo para
    /// que siga probando el mecanismo.
    #[test]
    fn la_confianza_mide_el_aporte_mas_fuerte_no_el_acumulado() {
        let a = decide(
            &[st_acumulado("ruidoso", 3.9, 1.2), st("real", 3.0)],
            &sin_deixis(),
            10_000,
            &ruta(),
            &cfg(),
        );
        assert_eq!(a.kind, AnchorKind::Element);
        assert_eq!(a.target.expect("target").sel, "ruidoso");
        // 1.2/3.0 = 0.4, no 3.9/3.0 = 1.0.
        assert!((a.confidence - 1.2 / 3.0).abs() < 1e-12, "{}", a.confidence);
        assert!(
            a.confidence < 0.5,
            "un ganador por acumulación no puede pasar el umbral de screenshot"
        );
    }

    /// D-B6-01: el divisor de la confianza depende de la clase de deixis, no es la
    /// constante global 6.0. Un aporte de score `s` da la misma confianza sin importar la
    /// clase si `s` es exactamente el máximo de esa clase (POINTER 4.5, ACTION 6.0, sin
    /// deixis 3.0): siempre 1.0. Con `s` fijo, la confianza es más baja cuanto más grande
    /// es el máximo de la clase.
    #[test]
    fn el_divisor_de_confianza_depende_de_la_clase_de_deixis() {
        let s = 4.5;
        let none = decide(&[st("a", s)], &sin_deixis(), 10_000, &ruta(), &cfg());
        let pointer = decide(
            &[st("a", s)],
            &crate::correlate::deixis::classify("este botón"),
            10_000,
            &ruta(),
            &cfg(),
        );
        let action = decide(
            &[st("a", s)],
            &crate::correlate::deixis::classify("cuando le doy"),
            10_000,
            &ruta(),
            &cfg(),
        );
        // sin deixis, 4.5 ya satura contra el máximo de 3.0.
        assert_eq!(none.confidence, 1.0);
        // POINTER: 4.5 es exactamente su máximo (3.0 × 1.5) → satura justo en 1.0.
        assert_eq!(pointer.confidence, 1.0);
        // ACTION: 4.5 / 6.0 = 0.75, no llega a saturar.
        assert!((action.confidence - 0.75).abs() < 1e-12, "{}", action.confidence);
    }

    #[test]
    fn la_confianza_se_satura_en_uno() {
        let a = decide(&[st("a", 40.0)], &sin_deixis(), 10_000, &ruta(), &cfg());
        assert_eq!(a.confidence, 1.0);
    }

    /// El orden del `reason[]` de los dos ejemplos de la spec: aporte más fuerte, deixis,
    /// resto de los aportes.
    #[test]
    fn el_reason_intercala_la_deixis_despues_del_aporte_mas_fuerte() {
        let mut t = st("a", 5.0);
        t.contributions = vec![
            Candidate {
                kind: CandidateKind::Hover,
                t: 7_900,
                target: target("a", true),
                dwell_ms: Some(2_100),
                score: 3.0,
            },
            Candidate {
                kind: CandidateKind::Click,
                t: 9_100,
                target: target("a", true),
                dwell_ms: None,
                score: 2.0,
            },
        ];
        let a = decide(
            &[t],
            &crate::correlate::deixis::classify("este botón es chico"),
            10_000,
            &ruta(),
            &cfg(),
        );
        assert_eq!(a.reason, vec!["hover 2.1s", "deixis:este", "click −0.9s"]);
    }

    #[test]
    fn el_ancla_siempre_lleva_pestaña_y_url() {
        for targets in [vec![], vec![st("a", 9.0)]] {
            let a = decide(&targets, &sin_deixis(), 10_000, &ruta(), &cfg());
            assert_eq!(a.tab, Some(42));
            assert_eq!(a.url.as_deref(), Some("/agenda/semana"));
        }
    }
}
