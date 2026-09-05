//! §07 pasos 1 y 2 — agrupación de utterances y filtro de ruido.

use std::sync::LazyLock;

use qua_protocol::{Event, Utterance};
use regex::Regex;

use super::config::CorrelatorConfig;
use super::text::{normalize, word_count};

/// `^\s*(otra cosa|después|además|ah,? y|bueno|otro tema|y acá|volviendo|aparte)` de §07
/// paso 1, sobre el texto normalizado.
static TOPIC_MARKER: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^\s*(otra cosa|despues|ademas|ah,? y|bueno|otro tema|y aca|volviendo|aparte)\b")
        .expect("patrón de corte de tema de §07 inválido")
});

/// `^[\s,.]*(eh+|mm+|ah+|ok|bueno|a ver|dale|listo)[\s,.]*$` de §07 paso 2.
static FILLER_ONLY: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^[\s,.]*(eh+|mm+|ah+|ok|bueno|a ver|dale|listo)[\s,.]*$")
        .expect("patrón de muletillas de §07 inválido")
});

/// Un issue candidato: una o más utterances consecutivas fusionadas (§07 paso 1).
#[derive(Debug, Clone, PartialEq)]
pub struct UtteranceGroup {
    pub utterance_ids: Vec<String>,
    pub t_start: i64,
    pub t_end: i64,
    /// Textos de los miembros unidos con un espacio.
    pub text: String,
    /// Media ponderada por duración de los miembros.
    pub avg_logprob: f64,
    /// Media ponderada por duración de los miembros.
    pub no_speech_prob: f64,
    /// Verdadero si **algún** miembro tiene `mark` adentro.
    pub marked: bool,
}

/// Por qué se descartó un grupo. Se guarda para poder explicar un transcript vacío.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NoiseReason {
    NoSpeech,
    LowLogprob,
    FillerOnly,
    TooShort,
}

impl NoiseReason {
    pub fn as_str(self) -> &'static str {
        match self {
            NoiseReason::NoSpeech => "no_speech_prob",
            NoiseReason::LowLogprob => "avg_logprob",
            NoiseReason::FillerOnly => "muletillas",
            NoiseReason::TooShort => "menos de 3 palabras",
        }
    }
}

/// ¿El texto arranca con un marcador de cambio de tema? Fuerza corte (§07 paso 1).
pub fn starts_new_topic(text: &str) -> bool {
    TOPIC_MARKER.is_match(&normalize(text))
}

/// Paso 1: fusiona utterances consecutivas.
///
/// Se fusionan si `gap < merge_gap_ms`, no hay `nav` ni `tab_switch` entre medio, y la
/// duración combinada queda bajo `max_group_ms`. Un marcador de tema corta siempre.
///
/// `events` tiene que venir ordenado por `t`.
pub fn group_utterances(
    utterances: &[Utterance],
    events: &[Event],
    cfg: &CorrelatorConfig,
) -> Vec<UtteranceGroup> {
    let mut ordered: Vec<&Utterance> = utterances.iter().collect();
    ordered.sort_by_key(|u| (u.t_start, u.t_end));

    let mut groups: Vec<Vec<&Utterance>> = Vec::new();
    for u in ordered {
        let fits = match groups.last() {
            None => false,
            Some(current) => {
                let prev = current.last().expect("grupo nunca vacío");
                let first = current.first().expect("grupo nunca vacío");
                let gap = u.t_start - prev.t_end;
                gap < cfg.merge_gap_ms
                    && !starts_new_topic(&u.text)
                    && !has_boundary_between(events, prev.t_end, u.t_start)
                    && (u.t_end - first.t_start) < cfg.max_group_ms
            }
        };
        if fits {
            groups.last_mut().expect("hay grupo").push(u);
        } else {
            groups.push(vec![u]);
        }
    }

    groups.into_iter().map(merge).collect()
}

/// ¿Hay un `nav` o un `tab_switch` en `(from, to)`? Corta la fusión (§07 paso 1).
fn has_boundary_between(events: &[Event], from: i64, to: i64) -> bool {
    let (lo, hi) = if from <= to { (from, to) } else { (to, from) };
    events.iter().any(|e| {
        matches!(e, Event::Nav { .. } | Event::TabSwitch { .. }) && e.t() >= lo && e.t() <= hi
    })
}

fn merge(members: Vec<&Utterance>) -> UtteranceGroup {
    let t_start = members.first().expect("no vacío").t_start;
    let t_end = members.iter().map(|u| u.t_end).max().expect("no vacío");

    // Media ponderada por duración: en el caso de una sola utterance —el habitual—
    // devuelve su propio valor sin tocarlo. Ver `docs/DECISIONS.md`, D-B3-05.
    let total: f64 = members
        .iter()
        .map(|u| (u.t_end - u.t_start).max(1) as f64)
        .sum();
    let weighted = |f: &dyn Fn(&Utterance) -> f64| -> f64 {
        members
            .iter()
            .map(|u| f(u) * ((u.t_end - u.t_start).max(1) as f64))
            .sum::<f64>()
            / total
    };

    UtteranceGroup {
        utterance_ids: members.iter().map(|u| u.id.clone()).collect(),
        t_start,
        t_end,
        text: members
            .iter()
            .map(|u| u.text.trim())
            .collect::<Vec<_>>()
            .join(" "),
        avg_logprob: weighted(&|u| u.avg_logprob),
        no_speech_prob: weighted(&|u| u.no_speech_prob),
        marked: members.iter().any(|u| u.marked),
    }
}

/// Paso 2: `None` si el grupo pasa, `Some(razón)` si es ruido.
pub fn noise_reason(g: &UtteranceGroup, cfg: &CorrelatorConfig) -> Option<NoiseReason> {
    if g.no_speech_prob > cfg.max_no_speech_prob {
        return Some(NoiseReason::NoSpeech);
    }
    if g.avg_logprob < cfg.min_avg_logprob {
        return Some(NoiseReason::LowLogprob);
    }
    if FILLER_ONLY.is_match(&normalize(&g.text)) {
        return Some(NoiseReason::FillerOnly);
    }
    if word_count(&g.text) < cfg.min_words && !g.marked {
        return Some(NoiseReason::TooShort);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::correlate::testkit::{nav, utt};

    fn cfg() -> CorrelatorConfig {
        CorrelatorConfig::default()
    }

    #[test]
    fn fusiona_con_gap_corto() {
        let us = vec![
            utt("u1", 1_000, 2_000, "este botón es chico"),
            utt("u2", 2_800, 3_500, "y no se entiende"),
        ];
        let g = group_utterances(&us, &[], &cfg());
        assert_eq!(g.len(), 1);
        assert_eq!(g[0].utterance_ids, vec!["u1", "u2"]);
        assert_eq!(g[0].text, "este botón es chico y no se entiende");
        assert_eq!((g[0].t_start, g[0].t_end), (1_000, 3_500));
    }

    #[test]
    fn no_fusiona_con_gap_largo() {
        let us = vec![
            utt("u1", 1_000, 2_000, "este botón es chico"),
            utt("u2", 3_600, 4_200, "y no se entiende"),
        ];
        assert_eq!(group_utterances(&us, &[], &cfg()).len(), 2);
    }

    #[test]
    fn un_nav_entre_medio_corta_aunque_el_gap_sea_corto() {
        let us = vec![
            utt("u1", 1_000, 2_000, "este botón es chico"),
            utt("u2", 2_800, 3_500, "y no se entiende"),
        ];
        let evs = vec![nav(2_400, 1, "/agenda/semana")];
        assert_eq!(group_utterances(&us, &evs, &cfg()).len(), 2);
    }

    #[test]
    fn el_marcador_de_tema_corta_aunque_el_gap_sea_corto() {
        let us = vec![
            utt("u1", 1_000, 2_000, "el calendario carga lento"),
            utt("u2", 2_100, 3_500, "otra cosa, el título está mal escrito"),
        ];
        let g = group_utterances(&us, &[], &cfg());
        assert_eq!(g.len(), 2);
        assert_eq!(g[1].utterance_ids, vec!["u2"]);
    }

    #[test]
    fn todos_los_marcadores_de_la_spec_cortan() {
        for m in [
            "otra cosa, x",
            "después vemos x",
            "además x",
            "ah y x",
            "ah, y x",
            "bueno x",
            "otro tema x",
            "y acá x",
            "volviendo x",
            "aparte x",
        ] {
            assert!(starts_new_topic(m), "{m}");
        }
        assert!(!starts_new_topic("este botón es chico"));
        // El marcador tiene que estar al principio, no en el medio.
        assert!(!starts_new_topic("el botón, además, es chico"));
    }

    #[test]
    fn la_duracion_combinada_topea_el_grupo() {
        let mut c = cfg();
        c.max_group_ms = 2_000;
        let us = vec![
            utt("u1", 0, 1_500, "este botón es chico"),
            utt("u2", 1_800, 3_000, "y no se entiende"),
        ];
        assert_eq!(group_utterances(&us, &[], &c).len(), 2);
    }

    #[test]
    fn descarta_por_no_speech_prob() {
        let mut u = utt("u1", 0, 1_000, "señal espuria del micrófono");
        u.no_speech_prob = 0.7;
        let g = group_utterances(&[u], &[], &cfg());
        assert_eq!(noise_reason(&g[0], &cfg()), Some(NoiseReason::NoSpeech));
    }

    #[test]
    fn descarta_por_avg_logprob() {
        let mut u = utt("u1", 0, 1_000, "algo bastante inentendible acá");
        u.avg_logprob = -1.4;
        let g = group_utterances(&[u], &[], &cfg());
        assert_eq!(noise_reason(&g[0], &cfg()), Some(NoiseReason::LowLogprob));
    }

    #[test]
    fn descarta_muletillas_puras() {
        for t in ["eh", "ehh", "mmm", "ahh", "ok", "bueno", "a ver", "dale", "listo", " eh, ", "Mm."]
        {
            let g = group_utterances(&[utt("u1", 0, 900, t)], &[], &cfg());
            assert_eq!(
                noise_reason(&g[0], &cfg()),
                Some(NoiseReason::FillerOnly),
                "{t}"
            );
        }
    }

    #[test]
    fn descarta_menos_de_tres_palabras_sin_mark() {
        let g = group_utterances(&[utt("u1", 0, 900, "qué feo")], &[], &cfg());
        assert_eq!(noise_reason(&g[0], &cfg()), Some(NoiseReason::TooShort));
    }

    /// El `mark` es una señal deliberada: rescata un grupo corto.
    #[test]
    fn el_mark_rescata_un_grupo_corto() {
        let mut u = utt("u1", 0, 900, "qué feo");
        u.marked = true;
        let g = group_utterances(&[u], &[], &cfg());
        assert_eq!(noise_reason(&g[0], &cfg()), None);
    }

    #[test]
    fn un_grupo_normal_pasa() {
        let g = group_utterances(&[utt("u1", 0, 900, "este botón es muy chico")], &[], &cfg());
        assert_eq!(noise_reason(&g[0], &cfg()), None);
    }

    /// «bueno» es a la vez marcador de tema y muletilla: siempre corta, y se descarta solo
    /// si queda solo.
    #[test]
    fn bueno_corta_y_se_descarta_si_queda_solo() {
        let us = vec![
            utt("u1", 0, 900, "este botón es chico"),
            utt("u2", 1_000, 1_400, "bueno"),
            utt("u3", 3_200, 4_300, "el header es muy alto"),
        ];
        let g = group_utterances(&us, &[], &cfg());
        assert_eq!(g.len(), 3);
        assert_eq!(noise_reason(&g[0], &cfg()), None);
        assert_eq!(noise_reason(&g[1], &cfg()), Some(NoiseReason::FillerOnly));
        assert_eq!(noise_reason(&g[2], &cfg()), None);
    }

    /// Pero si lo que sigue viene pegado, «bueno» abre el grupo nuevo en vez de morir:
    /// el corte es antes de la muletilla, no después.
    #[test]
    fn bueno_abre_el_grupo_siguiente_si_viene_pegado() {
        let us = vec![
            utt("u1", 0, 900, "este botón es chico"),
            utt("u2", 1_000, 1_400, "bueno"),
            utt("u3", 1_500, 2_600, "el header es muy alto"),
        ];
        let g = group_utterances(&us, &[], &cfg());
        assert_eq!(g.len(), 2);
        assert_eq!(g[1].utterance_ids, vec!["u2", "u3"]);
        assert_eq!(noise_reason(&g[1], &cfg()), None);
    }
}
