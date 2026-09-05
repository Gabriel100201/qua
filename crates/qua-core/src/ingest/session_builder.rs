//! Arma una `Session` (§03) a partir de metadata + eventos crudos.
//!
//! Un único punto de construcción, usado tanto por el `session.stop` en vivo (eventos
//! en memoria) como por [`super::recover::recover_session`] (eventos releídos de
//! `raw/events.ndjson`) — así los dos caminos producen exactamente la misma forma.

use std::collections::BTreeMap;

use qua_protocol::{
    AudioInfo, Event, ProjectRef, Session, SessionStats, SessionStatus, TabInfo, AUDIO_SAMPLE_RATE,
};

use super::recover::SessionMeta;

pub fn build_session(
    meta: &SessionMeta,
    events: Vec<Event>,
    status: SessionStatus,
    ended_at: Option<String>,
    duration_ms: Option<i64>,
    project: ProjectRef,
    audio_path: String,
) -> Session {
    // G1: `packages/protocol` (§02, comentario de `Event.t`) es explícito — "el
    // content script lo emite como `performance.timeOrigin + performance.now()` y el
    // daemon lo normaliza" — pero ningún código lo hacía. `duration_ms` viaja por el
    // mismo reloj (`SessionManager.stop()` manda `this.now()`, el mismo `Date.now()`
    // absoluto que arma `t0Wall`), así que se normaliza igual. Encontrado con una
    // sesión real de punta a punta (G1): sin esto, `session.json` quedaba con
    // timestamps en epoch-ms crudo y una duración de cientos de miles de horas.
    let duration_ms = duration_ms.map(|d| d - meta.t0_wall);
    let events: Vec<Event> = events
        .into_iter()
        .map(|e| normalize_t(e, meta.t0_wall))
        .collect();

    let gaps_ms: i64 = events
        .iter()
        .filter_map(|e| match e {
            Event::AudioGap { duration_ms, .. } => Some(*duration_ms),
            _ => None,
        })
        .sum();
    let tabs = derive_tabs(&events);
    let events_raw = events.len() as i64;

    Session {
        schema: Default::default(),
        id: meta.id.clone(),
        status,
        t0_wall: meta.t0_wall,
        started_at: meta.started_at.clone(),
        ended_at,
        duration_ms,
        project,
        // La atribución de git (§03 `GitInfo`) requiere resolver el repo del proyecto
        // y correr `git2` sobre él — queda fuera del alcance de B1 (servidor + store).
        git: None,
        env: meta.env.clone(),
        audio: AudioInfo {
            path: audio_path,
            sample_rate: AUDIO_SAMPLE_RATE,
            gaps_ms,
        },
        stats: SessionStats {
            events_raw,
            // B1 no filtra: todo lo que el content script mandó llega a `session.json`.
            // Si algún filtrado adicional hace falta, es de B3/B4 sobre este mismo array.
            events_kept: events_raw,
            utterances: 0,
            issues: 0,
        },
        tabs,
        events,
        utterances: Vec::new(),
        issues: Vec::new(),
    }
}

/// `t` llega en epoch-ms absoluto (§02); esto lo deja en ms desde `t0_wall`, como
/// pide el contrato de `Event.t`. Reconstruye cada variante entera porque `Event` no
/// expone un setter de `t` (y no hace falta uno en `qua-protocol` solo para esto).
fn normalize_t(event: Event, t0_wall: i64) -> Event {
    match event {
        Event::Nav { t, tab, url, title, kind } => Event::Nav { t: t - t0_wall, tab, url, title, kind },
        Event::TabSwitch { t, tab, from, to, url } => {
            Event::TabSwitch { t: t - t0_wall, tab, from, to, url }
        }
        Event::TabClose { t, tab } => Event::TabClose { t: t - t0_wall, tab },
        Event::Click { t, tab, target, button, mods } => {
            Event::Click { t: t - t0_wall, tab, target, button, mods }
        }
        Event::Hover { t, tab, target, dwell_ms } => {
            Event::Hover { t: t - t0_wall, tab, target, dwell_ms }
        }
        Event::FocusChange { t, tab, target } => Event::FocusChange { t: t - t0_wall, tab, target },
        Event::Input { t, tab, target, field } => Event::Input { t: t - t0_wall, tab, target, field },
        Event::Submit { t, tab, target } => Event::Submit { t: t - t0_wall, tab, target },
        Event::ScrollSettle { t, tab, y, pct, top_target } => {
            Event::ScrollSettle { t: t - t0_wall, tab, y, pct, top_target }
        }
        Event::Viewport { t, tab, w, h, dpr } => Event::Viewport { t: t - t0_wall, tab, w, h, dpr },
        Event::Console { t, tab, level, text, stack } => {
            Event::Console { t: t - t0_wall, tab, level, text, stack }
        }
        Event::NetFail { t, tab, method, url, status, duration_ms } => {
            Event::NetFail { t: t - t0_wall, tab, method, url, status, duration_ms }
        }
        Event::NetSlow { t, tab, method, url, status, duration_ms } => {
            Event::NetSlow { t: t - t0_wall, tab, method, url, status, duration_ms }
        }
        Event::LongTask { t, tab, duration_ms } => {
            Event::LongTask { t: t - t0_wall, tab, duration_ms }
        }
        Event::LayoutShift { t, tab, value, sources } => {
            Event::LayoutShift { t: t - t0_wall, tab, value, sources }
        }
        Event::MutationBurst { t, tab, target, count } => {
            Event::MutationBurst { t: t - t0_wall, tab, target, count }
        }
        Event::Mark { t, tab, source } => Event::Mark { t: t - t0_wall, tab, source },
        Event::AudioGap { t, tab, duration_ms } => {
            Event::AudioGap { t: t - t0_wall, tab, duration_ms }
        }
    }
}

/// Reconstrucción best-effort de `tabs[]` a partir de `nav` / `tab_switch` y el resto
/// de eventos con `tab`. No es el análisis final — B4 puede refinarlo al renderizar.
fn derive_tabs(events: &[Event]) -> Vec<TabInfo> {
    let mut map: BTreeMap<i64, TabInfo> = BTreeMap::new();

    let touch = |map: &mut BTreeMap<i64, TabInfo>, tab: i64, t: i64| {
        let entry = map.entry(tab).or_insert_with(|| TabInfo {
            tab,
            url: String::new(),
            title: String::new(),
            first_ms: t,
            last_ms: t,
        });
        entry.first_ms = entry.first_ms.min(t);
        entry.last_ms = entry.last_ms.max(t);
    };

    for event in events {
        let t = event.t();
        match event {
            Event::Nav {
                tab: Some(tab),
                url,
                title,
                ..
            } => {
                touch(&mut map, *tab, t);
                if let Some(entry) = map.get_mut(tab) {
                    entry.url = url.clone();
                    entry.title = title.clone();
                }
            }
            Event::TabSwitch { to, url, .. } => {
                touch(&mut map, *to, t);
                if let Some(entry) = map.get_mut(to) {
                    if entry.url.is_empty() {
                        entry.url = url.clone();
                    }
                }
            }
            _ => {
                if let Some(tab) = event.tab() {
                    touch(&mut map, tab, t);
                }
            }
        }
    }

    map.into_values().collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use qua_protocol::{EnvInfo, MarkSource, NavKind, ViewportInfo};

    fn meta() -> SessionMeta {
        SessionMeta {
            id: "s1".into(),
            t0_wall: 0,
            started_at: "2026-01-01T00:00:00.000Z".into(),
            base_url: "http://localhost:3000/".into(),
            env: EnvInfo {
                ua: "ua".into(),
                chrome: "142.0".into(),
                platform: "macOS".into(),
                viewport: ViewportInfo {
                    w: 100,
                    h: 100,
                    dpr: 1.0,
                },
                ext: "1.0.0".into(),
            },
        }
    }

    #[test]
    fn calcula_gaps_y_tabs() {
        let events = vec![
            Event::Nav {
                t: 0,
                tab: Some(1),
                url: "http://localhost:3000/".into(),
                title: "Home".into(),
                kind: NavKind::Load,
            },
            Event::Mark {
                t: 500,
                tab: Some(1),
                source: MarkSource::Hotkey,
            },
            Event::AudioGap {
                t: 900,
                tab: None,
                duration_ms: 300,
            },
            Event::AudioGap {
                t: 1200,
                tab: None,
                duration_ms: 150,
            },
        ];
        let session = build_session(
            &meta(),
            events,
            SessionStatus::Processing,
            Some("2026-01-01T00:00:02.000Z".into()),
            Some(2000),
            ProjectRef {
                label: "unknown".into(),
                repo: None,
            },
            "raw/audio.pcm".into(),
        );

        assert_eq!(session.audio.gaps_ms, 450);
        assert_eq!(session.stats.events_raw, 4);
        assert_eq!(session.stats.events_kept, 4);
        assert_eq!(session.tabs.len(), 1);
        assert_eq!(session.tabs[0].tab, 1);
        assert_eq!(session.tabs[0].first_ms, 0);
        assert_eq!(session.tabs[0].last_ms, 500);
    }
}
