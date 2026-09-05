//! El correlador de §07. Acá está el producto.
//!
//! No es un join por timestamp: es un scoring con sesgo hacia atrás, porque uno habla
//! después de ver la cosa. Los 9 pasos, en orden:
//!
//! 1. [`group`] — agrupar utterances en issues candidatos.
//! 2. [`group::noise_reason`] — filtro de ruido.
//! 3. [`deixis`] — clasificación de deixis en español.
//! 4. [`scoring::candidates_in_window`] — ventana asimétrica de candidatos.
//! 5. [`scoring::score_candidates`] — base × recency × bias × visibility.
//! 6. [`anchor::decide`] — decidir el ancla, degradando a `route` ante duda.
//! 7. [`evidence::collect`] — adjuntar evidencia y timings.
//! 8. [`classify`] — categoría y severidad.
//! 9. [`CaptureRequest`] — pedido de screenshot.
//!
//! Ningún umbral vive en el código: todos salen de [`CorrelatorConfig`], que se lee del
//! `[correlator]` de `~/.qua/config.toml`. Es lo que hace que `qua reprocess` sirva para
//! tunear sin recompilar (§6.2, §07 paso 9).

pub mod anchor;
pub mod classify;
pub mod config;
pub mod deixis;
pub mod evidence;
pub mod group;
pub mod ingest;
pub mod scoring;
pub mod text;

#[cfg(test)]
pub(crate) mod testkit;

use qua_protocol::{AnchorKind, Event, Issue, ProtocolVersionTag, ServerMessage, Utterance};

pub use anchor::RouteContext;
pub use config::{ConfigError, CorrelatorConfig};
pub use deixis::{Deixis, DeixisMatch};
pub use group::{NoiseReason, UtteranceGroup};
pub use ingest::{events_from_ndjson, SkipReason, SkippedLine};

/// §07 paso 9 — pedido retroactivo de screenshot al ring de la extensión.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CaptureRequest {
    /// El issue que va a recibir el recorte en `evidence.screenshot`.
    pub issue_id: String,
    pub tab: i64,
    /// `t_ref` del issue: la extensión devuelve el frame del ring más cercano.
    pub t_target: i64,
}

impl CaptureRequest {
    /// El mensaje de §04 que manda el daemon.
    pub fn to_message(&self) -> ServerMessage {
        ServerMessage::CaptureRequest {
            v: ProtocolVersionTag,
            tab: self.tab,
            t_target: self.t_target,
        }
    }
}

/// Un grupo que el paso 2 descartó. Se guarda para poder explicar por qué una utterance no
/// llegó al reporte.
#[derive(Debug, Clone, PartialEq)]
pub struct DiscardedGroup {
    pub utterance_ids: Vec<String>,
    pub text: String,
    pub reason: NoiseReason,
}

/// Todo lo que produce una corrida del correlador.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Correlation {
    /// Ordenados por `t`. Los ids son `i01`, `i02`, … (§03).
    pub issues: Vec<Issue>,
    /// Paso 9: los issues con `kind = "element"` y confianza suficiente.
    pub captures: Vec<CaptureRequest>,
    /// Paso 2: lo que se filtró, con el motivo.
    pub discarded: Vec<DiscardedGroup>,
}

/// Corre los pasos 1 a 9 sobre una sesión.
///
/// `events` no necesita venir ordenado; se ordena por `t` acá. Para leerlos de
/// `raw/events.ndjson` tolerando líneas rotas, ver [`events_from_ndjson`].
pub fn correlate(
    events: &[Event],
    utterances: &[Utterance],
    cfg: &CorrelatorConfig,
) -> Correlation {
    let mut events: Vec<Event> = events.to_vec();
    events.sort_by_key(|e| e.t());

    let mut out = Correlation::default();

    // Paso 1.
    let groups = group::group_utterances(utterances, &events, cfg);

    for g in groups {
        // Paso 2.
        if let Some(reason) = group::noise_reason(&g, cfg) {
            out.discarded.push(DiscardedGroup {
                utterance_ids: g.utterance_ids.clone(),
                text: g.text.clone(),
                reason,
            });
            continue;
        }

        // Paso 3.
        let deixis = deixis::classify(&g.text);

        // Paso 4.
        let mark_t = if g.marked {
            mark_in(&events, g.t_start, g.t_end)
        } else {
            None
        };
        let w = scoring::window(g.t_start, mark_t, cfg);
        let route = route_context(&events, w.t_ref);
        let mut candidates = scoring::candidates_in_window(&events, w, route.tab, cfg);

        // Paso 5.
        scoring::score_candidates(&mut candidates, w.t_ref, deixis.class, cfg);
        let targets = scoring::merge_by_selector(candidates, cfg);

        // Paso 6.
        let mut anchor = anchor::decide(&targets, &deixis, w.t_ref, &route, cfg);

        // Paso 7.
        let sel = anchor.target.as_ref().map(|t| t.sel.clone());
        let evidence = evidence::collect(&events, w.t_ref, route.tab, sel.as_deref(), cfg);

        // Paso 8.
        let category = classify::category(&g.text, &evidence);
        let severity = classify::severity(&g.text, category, &evidence);

        // El `id` definitivo se asigna abajo, cuando ya sabemos cuántos issues hay.
        let id = format!("i{:02}", out.issues.len() + 1);

        // Paso 9.
        if anchor.kind == AnchorKind::Element && anchor.confidence >= cfg.screenshot_min_confidence
        {
            if let Some(tab) = route.tab {
                out.captures.push(CaptureRequest {
                    issue_id: id.clone(),
                    tab,
                    t_target: w.t_ref,
                });
            }
        }

        anchor.reason.shrink_to_fit();
        out.issues.push(Issue {
            id,
            utterance_ids: g.utterance_ids,
            t: w.t_ref,
            text: g.text,
            anchor,
            evidence,
            category,
            severity,
            exported_to: None,
        });
    }

    out
}

/// El `mark` que cae dentro de `[t_start, t_end]`. Si hay más de uno gana el primero: es
/// el instante en que Gabriel decidió señalar.
fn mark_in(events: &[Event], t_start: i64, t_end: i64) -> Option<i64> {
    events
        .iter()
        .filter(|e| matches!(e, Event::Mark { .. }))
        .map(|e| e.t())
        .filter(|t| *t >= t_start && *t <= t_end)
        .min()
}

/// Pestaña y URL vigentes en `t`.
///
/// La pestaña sale del último evento de navegación o interacción anterior a `t` —no de
/// cualquier evento, porque un `console` o un `net_fail` de una pestaña de fondo no cambia
/// dónde está mirando el usuario—. La URL sale del último `nav` o `tab_switch` de esa
/// pestaña.
pub fn route_context(events: &[Event], t: i64) -> RouteContext {
    let foreground = |e: &Event| {
        matches!(
            e,
            Event::Nav { .. }
                | Event::TabSwitch { .. }
                | Event::Click { .. }
                | Event::Hover { .. }
                | Event::FocusChange { .. }
                | Event::Input { .. }
                | Event::Submit { .. }
                | Event::ScrollSettle { .. }
                | Event::Mark { .. }
        )
    };

    let tab = events
        .iter()
        .filter(|e| e.t() <= t && foreground(e))
        .filter_map(|e| e.tab())
        .next_back()
        // Sesión sin ningún evento anterior a `t`: caemos a la primera pestaña conocida.
        .or_else(|| events.iter().find_map(|e| e.tab()));

    let url = events
        .iter()
        .filter(|e| e.t() <= t)
        .filter(|e| tab.is_none() || e.tab() == tab)
        .filter_map(|e| match e {
            Event::Nav { url, .. } | Event::TabSwitch { url, .. } => Some(url.clone()),
            _ => None,
        })
        .next_back();

    RouteContext { tab, url }
}

#[cfg(test)]
mod tests;
