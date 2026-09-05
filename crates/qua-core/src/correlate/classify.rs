//! §07 paso 8 — categoría y severidad.
//!
//! ```text
//! bug   ← evidence.console ≠ ∅ ∨ net_fail ∨ /error|falla|rompe|no anda|no funciona|bug/
//! perf  ← net_slow ∨ long_task ∨ /lento|tarda|demora|se cuelga|freeza|carga mucho/
//! copy  ← /dice|texto|redacción|typo|falta la tilde|el título|mal escrito/
//! ui    ← /chico|grande|color|espacio|padding|margen|alineado|centrado|se ve mal|feo/
//! idea  ← /estaría bueno|me gustaría|podría|sería bueno|debería|estaría copado/
//! precedencia: bug > perf > copy > ui > idea      default: ui
//! severidad:   high si bug con console.error · med si perf o net_fail o
//!              /no anda|no funciona/ · low resto
//! ```
//!
//! Los patrones se aplican sobre el texto normalizado (minúsculas, sin tildes) y con
//! frontera de palabra: sin frontera `dice` matchea dentro de «índice». Ver
//! `docs/DECISIONS.md`, D-B3-02 y D-B3-03.

use std::sync::LazyLock;

use qua_protocol::{ConsoleLevel, Event, Evidence, IssueCategory, Severity};
use regex::Regex;

use super::text::normalize;

macro_rules! pat {
    ($name:ident, $re:expr) => {
        static $name: LazyLock<Regex> =
            LazyLock::new(|| Regex::new($re).expect("patrón de categoría de §07 inválido"));
    };
}

pat!(BUG, r"\b(error|falla|rompe|no anda|no funciona|bug)\b");
pat!(PERF, r"\b(lento|tarda|demora|se cuelga|freeza|carga mucho)\b");
pat!(
    COPY,
    r"\b(dice|texto|redaccion|typo|falta la tilde|el titulo|mal escrito)\b"
);
pat!(
    UI,
    r"\b(chico|grande|color|espacio|padding|margen|alineado|centrado|se ve mal|feo)\b"
);
pat!(
    IDEA,
    r"\b(estaria bueno|me gustaria|podria|seria bueno|deberia|estaria copado)\b"
);
// El subconjunto de `bug` que además sube la severidad a `med`.
pat!(SEV_MED, r"\b(no anda|no funciona)\b");

fn tiene(evidence: &Evidence, pred: impl Fn(&Event) -> bool) -> bool {
    evidence.net.iter().any(&pred) || evidence.console.iter().any(&pred)
}

/// Paso 8, primera mitad. La precedencia es la de la spec: bug > perf > copy > ui > idea.
pub fn category(text: &str, evidence: &Evidence) -> IssueCategory {
    let n = normalize(text);
    let net_fail = tiene(evidence, |e| matches!(e, Event::NetFail { .. }));
    let net_slow = tiene(evidence, |e| matches!(e, Event::NetSlow { .. }));
    let long_task = tiene(evidence, |e| matches!(e, Event::LongTask { .. }));

    if !evidence.console.is_empty() || net_fail || BUG.is_match(&n) {
        return IssueCategory::Bug;
    }
    if net_slow || long_task || PERF.is_match(&n) {
        return IssueCategory::Perf;
    }
    if COPY.is_match(&n) {
        return IssueCategory::Copy;
    }
    if UI.is_match(&n) {
        return IssueCategory::Ui;
    }
    if IDEA.is_match(&n) {
        return IssueCategory::Idea;
    }
    IssueCategory::Ui
}

/// Paso 8, segunda mitad.
pub fn severity(text: &str, category: IssueCategory, evidence: &Evidence) -> Severity {
    let n = normalize(text);
    let console_error = evidence
        .console
        .iter()
        .any(|e| matches!(e, Event::Console { level: ConsoleLevel::Error, .. }));
    let net_fail = tiene(evidence, |e| matches!(e, Event::NetFail { .. }));

    if category == IssueCategory::Bug && console_error {
        return Severity::High;
    }
    if category == IssueCategory::Perf || net_fail || SEV_MED.is_match(&n) {
        return Severity::Med;
    }
    Severity::Low
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::correlate::testkit::{console_error, console_warn, long_task, net_fail, net_slow};

    fn vacia() -> Evidence {
        Evidence::default()
    }

    fn con_net(e: Event) -> Evidence {
        Evidence {
            net: vec![e],
            ..Evidence::default()
        }
    }

    fn con_console(e: Event) -> Evidence {
        Evidence {
            console: vec![e],
            ..Evidence::default()
        }
    }

    #[test]
    fn bug_por_texto() {
        for t in [
            "tira un error feo",
            "esto falla siempre",
            "se rompe al guardar",
            "no anda nada",
            "no funciona el filtro",
            "es un bug viejo",
        ] {
            assert_eq!(category(t, &vacia()), IssueCategory::Bug, "{t}");
        }
    }

    #[test]
    fn bug_por_evidencia_aunque_el_texto_sea_de_ui() {
        assert_eq!(
            category("este botón es muy chico", &con_console(console_warn(1, 1, "ojo"))),
            IssueCategory::Bug
        );
        assert_eq!(
            category("este botón es muy chico", &con_net(net_fail(1, 1, 500))),
            IssueCategory::Bug
        );
    }

    #[test]
    fn perf_por_texto_y_por_evidencia() {
        for t in [
            "carga lento",
            "tarda un montón",
            "demora en abrir",
            "se cuelga al guardar",
            "se freeza todo",
            "carga mucho al entrar",
        ] {
            assert_eq!(category(t, &vacia()), IssueCategory::Perf, "{t}");
        }
        assert_eq!(
            category("no me gusta nada de esto", &con_net(net_slow(1, 1, 2_400))),
            IssueCategory::Perf
        );
        assert_eq!(
            category("no me gusta nada de esto", &con_net(long_task(1, 1, 320))),
            IssueCategory::Perf
        );
    }

    #[test]
    fn copy_ui_e_idea() {
        for t in [
            "acá dice cualquier cosa",
            "el texto no se entiende",
            "la redacción es mala",
            "hay un typo",
            "falta la tilde en el nombre",
            "el título está raro",
            "está mal escrito",
        ] {
            assert_eq!(category(t, &vacia()), IssueCategory::Copy, "{t}");
        }
        for t in [
            "es muy chico",
            "queda grande",
            "ese color no va",
            "falta espacio",
            "sobra padding",
            "el margen es raro",
            "no está alineado",
            "debería estar centrado",
            "se ve mal",
            "es feo",
        ] {
            assert_eq!(category(t, &vacia()), IssueCategory::Ui, "{t}");
        }
        for t in [
            "estaría bueno un atajo",
            "me gustaría filtrar por fecha",
            "podría recordar el filtro",
            "sería bueno exportar",
            "estaría copado un modo oscuro",
        ] {
            assert_eq!(category(t, &vacia()), IssueCategory::Idea, "{t}");
        }
    }

    /// «debería estar centrado» matchea idea **y** ui: gana ui por precedencia.
    #[test]
    fn la_precedencia_es_la_de_la_spec() {
        assert_eq!(category("debería estar centrado", &vacia()), IssueCategory::Ui);
        // copy > ui
        assert_eq!(category("el título es muy chico", &vacia()), IssueCategory::Copy);
        // perf > copy
        assert_eq!(category("el título tarda en aparecer", &vacia()), IssueCategory::Perf);
        // bug > perf
        assert_eq!(category("tarda y después falla", &vacia()), IssueCategory::Bug);
    }

    #[test]
    fn el_default_es_ui() {
        assert_eq!(category("no sé qué pasa con esto", &vacia()), IssueCategory::Ui);
    }

    /// Sin frontera de palabra, «índice» sería copy por contener «dice».
    #[test]
    fn no_matchea_dentro_de_otra_palabra() {
        assert_eq!(category("el índice general", &vacia()), IssueCategory::Ui);
    }

    #[test]
    fn severidad_high_solo_con_bug_y_console_error() {
        let ev = con_console(console_error(1, 1, "boom"));
        assert_eq!(severity("se rompe", IssueCategory::Bug, &ev), Severity::High);
        // Un warn no alcanza para high: sin `net_fail` ni «no anda», queda low.
        let ev = con_console(console_warn(1, 1, "ojo"));
        assert_eq!(severity("se rompe", IssueCategory::Bug, &ev), Severity::Low);
        // …pero «no funciona» sí lo sube a med.
        assert_eq!(severity("no funciona", IssueCategory::Bug, &ev), Severity::Med);
    }

    #[test]
    fn severidad_med() {
        assert_eq!(severity("carga lento", IssueCategory::Perf, &vacia()), Severity::Med);
        assert_eq!(
            severity("es chico", IssueCategory::Ui, &con_net(net_fail(1, 1, 500))),
            Severity::Med
        );
        assert_eq!(severity("no anda", IssueCategory::Bug, &vacia()), Severity::Med);
    }

    #[test]
    fn severidad_low_por_defecto() {
        assert_eq!(severity("es muy chico", IssueCategory::Ui, &vacia()), Severity::Low);
        assert_eq!(
            severity("estaría bueno un atajo", IssueCategory::Idea, &vacia()),
            Severity::Low
        );
    }
}
