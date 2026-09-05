//! Constructores mínimos de eventos y utterances para los tests unitarios de §07.
//!
//! Solo `#[cfg(test)]`: no forma parte de la API del crate.

use qua_protocol::{
    ConsoleLevel, Event, MarkSource, NavKind, SelectorStrategy, TargetRef, Utterance,
};

pub fn target(sel: &str, visible: bool) -> TargetRef {
    TargetRef {
        sel: sel.into(),
        strategy: SelectorStrategy::TestId,
        tag: "button".into(),
        text: None,
        role: None,
        name: None,
        rect: None,
        visible: Some(visible),
        classes: None,
        computed: None,
        component: None,
        src: None,
    }
}

pub fn click(t: i64, tab: i64, sel: &str) -> Event {
    Event::Click {
        t,
        tab: Some(tab),
        target: target(sel, true),
        button: 0,
        mods: vec![],
    }
}

pub fn hover(t: i64, tab: i64, sel: &str, dwell_ms: i64) -> Event {
    Event::Hover {
        t,
        tab: Some(tab),
        target: target(sel, true),
        dwell_ms,
    }
}

pub fn focus(t: i64, tab: i64, sel: &str) -> Event {
    Event::FocusChange {
        t,
        tab: Some(tab),
        target: target(sel, true),
    }
}

pub fn scroll_settle(t: i64, tab: i64, top: Option<&str>) -> Event {
    Event::ScrollSettle {
        t,
        tab: Some(tab),
        y: 0.0,
        pct: 0.0,
        top_target: top.map(|s| target(s, true)),
    }
}

pub fn nav(t: i64, tab: i64, url: &str) -> Event {
    Event::Nav {
        t,
        tab: Some(tab),
        url: url.into(),
        title: "Agendi".into(),
        kind: NavKind::Spa,
    }
}

pub fn tab_switch(t: i64, from: i64, to: i64, url: &str) -> Event {
    Event::TabSwitch {
        t,
        tab: Some(to),
        from: Some(from),
        to,
        url: url.into(),
    }
}

pub fn mark(t: i64, tab: i64) -> Event {
    Event::Mark {
        t,
        tab: Some(tab),
        source: MarkSource::Hotkey,
    }
}

pub fn console_error(t: i64, tab: i64, text: &str) -> Event {
    Event::Console {
        t,
        tab: Some(tab),
        level: ConsoleLevel::Error,
        text: text.into(),
        stack: None,
    }
}

pub fn console_warn(t: i64, tab: i64, text: &str) -> Event {
    Event::Console {
        t,
        tab: Some(tab),
        level: ConsoleLevel::Warn,
        text: text.into(),
        stack: None,
    }
}

pub fn net_fail(t: i64, tab: i64, status: i64) -> Event {
    Event::NetFail {
        t,
        tab: Some(tab),
        method: "GET".into(),
        url: "https://api.example/turnos".into(),
        status,
        duration_ms: 120,
    }
}

pub fn net_slow(t: i64, tab: i64, duration_ms: i64) -> Event {
    Event::NetSlow {
        t,
        tab: Some(tab),
        method: "GET".into(),
        url: "https://api.example/turnos".into(),
        status: 200,
        duration_ms,
    }
}

pub fn long_task(t: i64, tab: i64, duration_ms: i64) -> Event {
    Event::LongTask {
        t,
        tab: Some(tab),
        duration_ms,
    }
}

pub fn layout_shift(t: i64, tab: i64, value: f64) -> Event {
    Event::LayoutShift {
        t,
        tab: Some(tab),
        value,
        sources: None,
    }
}

pub fn mutation_burst(t: i64, tab: i64) -> Event {
    Event::MutationBurst {
        t,
        tab: Some(tab),
        target: None,
        count: 42,
    }
}

pub fn utt(id: &str, t_start: i64, t_end: i64, text: &str) -> Utterance {
    Utterance {
        id: id.into(),
        t_start,
        t_end,
        text: text.into(),
        lang: "es".into(),
        words: vec![],
        avg_logprob: -0.12,
        no_speech_prob: 0.03,
        marked: false,
    }
}
