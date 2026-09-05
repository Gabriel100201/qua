//! §07 paso 7 — evidencia.
//!
//! Ventana `E = [t_ref − 6000, t_ref + 4000]`, misma pestaña. Se adjuntan los eventos
//! `console` (error/warn), `net_fail`, `net_slow`, `long_task` y `layout_shift`; y si hay
//! un click seguido de `mutation_burst` o `nav`, el timing `click → primer render`.
//!
//! `Evidence` (§03) tiene dos baldes de eventos, `console` y `net`, pero §07 manda a
//! adjuntar cinco tipos. `long_task` y `layout_shift` van a `net`, que queda como el balde
//! de evidencia no-console; cada evento se distingue por su `k`. Ver `docs/DECISIONS.md`,
//! D-B3-06.

use qua_protocol::{Event, Evidence, Timing};

use super::config::CorrelatorConfig;

/// La etiqueta exacta del timing de §07 paso 7.
pub const LABEL_PRIMER_RENDER: &str = "click → primer render";

/// Recolecta la evidencia de la ventana E para un `t_ref` y una pestaña.
///
/// `anchor_sel` es el selector del ancla, si se ancló a elemento: se usa para elegir el
/// click del timing cuando hay varios en la ventana.
pub fn collect(
    events: &[Event],
    t_ref: i64,
    tab: Option<i64>,
    anchor_sel: Option<&str>,
    cfg: &CorrelatorConfig,
) -> Evidence {
    let from = t_ref - cfg.evidence_back_ms;
    let to = t_ref + cfg.evidence_fwd_ms;

    let en_ventana: Vec<&Event> = events
        .iter()
        .filter(|e| e.t() >= from && e.t() <= to)
        .filter(|e| match (tab, e.tab()) {
            (Some(want), Some(got)) => want == got,
            _ => true,
        })
        .collect();

    let console: Vec<Event> = en_ventana
        .iter()
        .filter(|e| matches!(e, Event::Console { .. }))
        .map(|e| (*e).clone())
        .collect();

    let net: Vec<Event> = en_ventana
        .iter()
        .filter(|e| {
            matches!(
                e,
                Event::NetFail { .. }
                    | Event::NetSlow { .. }
                    | Event::LongTask { .. }
                    | Event::LayoutShift { .. }
            )
        })
        .map(|e| (*e).clone())
        .collect();

    Evidence {
        console,
        net,
        timings: timings(&en_ventana, anchor_sel),
        screenshot: None,
    }
}

/// `click → primer render`: Δ entre un click y el primer `mutation_burst` o `nav`
/// posterior dentro de E.
///
/// Se emite **uno solo**: el del click del ancla si lo hay, si no el del click más
/// reciente que tenga cierre. Varios timings por issue serían ruido, no evidencia.
fn timings(en_ventana: &[&Event], anchor_sel: Option<&str>) -> Vec<Timing> {
    let cierre_de = |t_click: i64| -> Option<i64> {
        en_ventana
            .iter()
            .filter(|e| matches!(e, Event::MutationBurst { .. } | Event::Nav { .. }))
            .map(|e| e.t())
            .filter(|t| *t > t_click)
            .min()
    };

    let clicks: Vec<(i64, Option<&str>)> = en_ventana
        .iter()
        .filter_map(|e| match e {
            Event::Click { t, target, .. } => Some((*t, Some(target.sel.as_str()))),
            _ => None,
        })
        .collect();

    let elegido = anchor_sel
        .and_then(|sel| {
            clicks
                .iter()
                .filter(|(_, s)| *s == Some(sel))
                .filter_map(|(t, _)| cierre_de(*t).map(|c| (*t, c)))
                .max_by_key(|(t, _)| *t)
        })
        .or_else(|| {
            clicks
                .iter()
                .filter_map(|(t, _)| cierre_de(*t).map(|c| (*t, c)))
                .max_by_key(|(t, _)| *t)
        });

    match elegido {
        Some((t_click, t_cierre)) => vec![Timing {
            label: LABEL_PRIMER_RENDER.to_string(),
            ms: t_cierre - t_click,
        }],
        None => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::correlate::testkit::{
        click, console_error, console_warn, layout_shift, long_task, mutation_burst, nav, net_fail,
        net_slow,
    };

    fn cfg() -> CorrelatorConfig {
        CorrelatorConfig::default()
    }

    #[test]
    fn junta_los_cinco_tipos_de_la_spec() {
        let evs = vec![
            console_error(9_000, 1, "boom"),
            console_warn(9_100, 1, "ojo"),
            net_fail(9_200, 1, 500),
            net_slow(9_300, 1, 2_400),
            long_task(9_400, 1, 320),
            layout_shift(9_500, 1, 0.2),
            click(9_600, 1, "a"),
        ];
        let e = collect(&evs, 10_000, Some(1), None, &cfg());
        assert_eq!(e.console.len(), 2);
        assert_eq!(e.net.len(), 4, "net_fail + net_slow + long_task + layout_shift");
    }

    #[test]
    fn la_ventana_e_es_mas_ancha_que_la_de_candidatos() {
        let evs = vec![
            console_error(3_999, 1, "afuera"),
            console_error(4_000, 1, "adentro"),
            console_error(14_000, 1, "adentro"),
            console_error(14_001, 1, "afuera"),
        ];
        let e = collect(&evs, 10_000, Some(1), None, &cfg());
        assert_eq!(e.console.len(), 2);
    }

    #[test]
    fn filtra_por_pestaña() {
        let evs = vec![console_error(9_000, 1, "mia"), console_error(9_100, 7, "otra")];
        let e = collect(&evs, 10_000, Some(1), None, &cfg());
        assert_eq!(e.console.len(), 1);
    }

    #[test]
    fn el_timing_mide_click_a_mutation_burst() {
        let evs = vec![click(9_000, 1, "a"), mutation_burst(10_412, 1)];
        let e = collect(&evs, 10_000, Some(1), None, &cfg());
        assert_eq!(
            e.timings,
            vec![Timing {
                label: LABEL_PRIMER_RENDER.into(),
                ms: 1_412
            }]
        );
    }

    #[test]
    fn el_timing_tambien_cierra_con_nav() {
        let evs = vec![click(9_000, 1, "a"), nav(9_800, 1, "/otra")];
        let e = collect(&evs, 10_000, Some(1), None, &cfg());
        assert_eq!(e.timings[0].ms, 800);
    }

    #[test]
    fn sin_cierre_no_hay_timing() {
        let evs = vec![click(9_000, 1, "a")];
        assert!(collect(&evs, 10_000, Some(1), None, &cfg()).timings.is_empty());
    }

    /// Con varios clicks, gana el del ancla.
    #[test]
    fn el_timing_prefiere_el_click_del_ancla() {
        let evs = vec![
            click(8_000, 1, "guardar"),
            mutation_burst(8_500, 1),
            click(9_000, 1, "otro"),
            mutation_burst(9_100, 1),
        ];
        let e = collect(&evs, 10_000, Some(1), Some("guardar"), &cfg());
        assert_eq!(e.timings[0].ms, 500);
        // Sin ancla, gana el click más reciente con cierre.
        let e = collect(&evs, 10_000, Some(1), None, &cfg());
        assert_eq!(e.timings[0].ms, 100);
    }

    #[test]
    fn emite_un_solo_timing() {
        let evs = vec![
            click(7_000, 1, "a"),
            mutation_burst(7_200, 1),
            click(8_000, 1, "b"),
            mutation_burst(8_300, 1),
        ];
        assert_eq!(collect(&evs, 10_000, Some(1), None, &cfg()).timings.len(), 1);
    }
}
