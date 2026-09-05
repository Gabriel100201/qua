//! Tests de los 9 pasos encadenados. Escenarios armados a mano contra §07, sin depender
//! del harness sintético de F1.

use super::testkit::*;
use super::*;
use qua_protocol::{IssueCategory, Severity};

fn cfg() -> CorrelatorConfig {
    CorrelatorConfig::default()
}

/// La escena canónica de §8.1: hover sostenido y click sobre «nuevo turno», con un
/// distractor lejano, y «este botón…» dicho después.
fn escena_pointer() -> Vec<Event> {
    vec![
        nav(0, 42, "/agenda/semana"),
        click(4_000, 42, "button[data-testid=\"exportar\"]"),
        hover(9_900, 42, "button[data-testid=\"nuevo-turno\"]", 2_100),
        click(11_100, 42, "button[data-testid=\"nuevo-turno\"]"),
    ]
}

#[test]
fn ancla_a_elemento_con_deixis_pointer() {
    let c = correlate(
        &escena_pointer(),
        &[utt("u01", 12_000, 13_000, "este botón de nuevo turno es re chico")],
        &cfg(),
    );
    assert_eq!(c.issues.len(), 1);
    let i = &c.issues[0];
    assert_eq!(i.id, "i01");
    assert_eq!(i.utterance_ids, vec!["u01"]);
    assert_eq!(i.t, 12_000);
    assert_eq!(i.anchor.kind, AnchorKind::Element);
    assert_eq!(
        i.anchor.target.as_ref().expect("target").sel,
        "button[data-testid=\"nuevo-turno\"]"
    );
    assert_eq!(i.anchor.tab, Some(42));
    assert_eq!(i.anchor.url.as_deref(), Some("/agenda/semana"));
    assert!(i.anchor.reason.iter().any(|r| r == "deixis:este"));
    assert_eq!(i.category, IssueCategory::Ui);
    assert_eq!(i.severity, Severity::Low);
    assert_eq!(i.exported_to, None);
}

/// Lo que la ventana asimétrica compra: mira 4,5 s hacia atrás y solo 1,5 s hacia
/// adelante. Un hover de hace 4 s es candidato; un click de dentro de 2 s no.
#[test]
fn la_ventana_ve_lejos_hacia_atras_y_cerca_hacia_adelante() {
    let events = vec![
        nav(0, 42, "/agenda/semana"),
        hover(9_000, 42, "el-que-mire", 1_400),
        click(9_100, 42, "el-que-mire"),
        // 1,6 s después de hablar: con una ventana simétrica entraría y ganaría, pero el
        // límite hacia adelante es 1,5 s.
        click(13_600, 42, "lo-siguiente"),
    ];
    let c = correlate(
        &events,
        &[utt("u01", 12_000, 13_000, "este botón es muy chico")],
        &cfg(),
    );
    assert_eq!(
        c.issues[0].anchor.target.as_ref().expect("target").sel,
        "el-que-mire"
    );
}

/// El sesgo está en los límites de la ventana, no en el decay: dentro de W la recency es
/// simétrica, así que un click justo posterior puede ganarle a uno de hace dos segundos.
/// Es la spec (§07 paso 5) y conviene tenerlo pinchado: si alguien decide que el decay
/// también tiene que ser asimétrico, este test es el que se lo dice.
#[test]
fn dentro_de_la_ventana_el_decay_es_simetrico() {
    let events = vec![
        nav(0, 42, "/agenda/semana"),
        click(9_900, 42, "antes"),
        click(12_400, 42, "despues"),
    ];
    let c = correlate(
        &events,
        &[utt("u01", 12_000, 13_000, "este botón es muy chico")],
        &cfg(),
    );
    assert_eq!(
        c.issues[0].anchor.target.as_ref().expect("target").sel,
        "despues",
        "el click 0,4 s posterior le gana al de 2,1 s antes"
    );
}

#[test]
fn screen_ancla_a_route_y_global_a_session() {
    let c = correlate(
        &escena_pointer(),
        &[utt("u01", 12_000, 13_500, "esta pantalla necesita un título más claro")],
        &cfg(),
    );
    assert_eq!(c.issues[0].anchor.kind, AnchorKind::Route);
    assert_eq!(c.issues[0].anchor.target, None);
    assert_eq!(c.issues[0].anchor.url.as_deref(), Some("/agenda/semana"));
    // «un título» no matchea `el título`: la categoría cae al default de §07, `ui`.
    assert_eq!(c.issues[0].category, IssueCategory::Ui);

    let c = correlate(
        &escena_pointer(),
        &[utt("u01", 12_000, 13_500, "en general la app se ve mal")],
        &cfg(),
    );
    assert_eq!(c.issues[0].anchor.kind, AnchorKind::Session);
    assert_eq!(c.issues[0].anchor.target, None);
}

/// ACTION: manda el click anterior, y se adjunta el timing.
#[test]
fn action_ancla_al_click_anterior_y_adjunta_timing() {
    let events = vec![
        nav(0, 42, "/agenda/semana"),
        hover(9_000, 42, "hover-fuerte", 3_000),
        click(10_600, 42, "button[data-testid=\"guardar\"]"),
        mutation_burst(12_012, 42),
    ];
    let c = correlate(
        &events,
        &[utt("u01", 12_000, 13_400, "cuando le doy a guardar tarda un montón")],
        &cfg(),
    );
    let i = &c.issues[0];
    assert_eq!(i.anchor.kind, AnchorKind::Element);
    assert_eq!(
        i.anchor.target.as_ref().expect("target").sel,
        "button[data-testid=\"guardar\"]"
    );
    assert_eq!(i.evidence.timings.len(), 1);
    assert_eq!(i.evidence.timings[0].ms, 1_412);
    assert_eq!(i.evidence.timings[0].label, evidence::LABEL_PRIMER_RENDER);
    assert_eq!(i.category, IssueCategory::Perf);
    assert_eq!(i.severity, Severity::Med);
}

/// La regla de oro. Dos elementos con score parecido no anclan a ninguno.
#[test]
fn la_regla_de_oro_degrada_a_route() {
    let events = vec![
        nav(0, 42, "/agenda/semana"),
        click(11_000, 42, "uno"),
        click(11_150, 42, "otro"),
    ];
    let c = correlate(
        &events,
        &[utt("u01", 12_000, 13_000, "este panel se ve raro")],
        &cfg(),
    );
    assert_eq!(c.issues[0].anchor.kind, AnchorKind::Route);
    assert_eq!(c.issues[0].anchor.target, None);
    assert!(c.issues[0].anchor.confidence <= 0.5);
}

/// Criterio de aceptación de B3 en §14: ningún caso ambiguo anclado a elemento con
/// confianza > 0.5.
#[test]
fn ningun_ambiguo_supera_media_confianza_anclado_a_elemento() {
    for delta in [0, 50, 100, 200, 400] {
        let events = vec![
            nav(0, 42, "/agenda/semana"),
            click(11_000, 42, "uno"),
            click(11_000 + delta, 42, "otro"),
        ];
        let c = correlate(
            &events,
            &[utt("u01", 12_000, 13_000, "este botón es muy chico")],
            &cfg(),
        );
        let a = &c.issues[0].anchor;
        assert!(
            a.kind != AnchorKind::Element || a.confidence <= 0.5,
            "delta={delta} kind={:?} conf={}",
            a.kind,
            a.confidence
        );
    }
}

#[test]
fn el_mark_recentra_la_ventana() {
    let events = vec![
        nav(0, 42, "/agenda/semana"),
        // Fuera de la ventana angosta del mark ([12_500, 15_500]), dentro de la ancha.
        click(11_000, 42, "viejo"),
        click(14_600, 42, "el-marcado"),
        mark(15_000, 42),
    ];
    let mut u = utt("u01", 14_800, 15_400, "acá");
    u.marked = true;
    let c = correlate(&events, &[u], &cfg());
    assert_eq!(c.issues.len(), 1, "el mark rescata un grupo de una palabra");
    assert_eq!(c.issues[0].t, 15_000, "t_ref es el t del mark");
    assert_eq!(
        c.issues[0].anchor.target.as_ref().expect("target").sel,
        "el-marcado"
    );
}

#[test]
fn el_ruido_no_produce_issues_pero_queda_registrado() {
    let mut u = utt("u01", 12_000, 13_000, "señal espuria del micrófono");
    u.no_speech_prob = 0.7;
    let c = correlate(&escena_pointer(), &[u], &cfg());
    assert!(c.issues.is_empty());
    assert_eq!(c.discarded.len(), 1);
    assert_eq!(c.discarded[0].reason, NoiseReason::NoSpeech);
    assert_eq!(c.discarded[0].utterance_ids, vec!["u01"]);
}

#[test]
fn el_marcador_de_tema_parte_en_dos_issues() {
    let events = vec![
        nav(0, 42, "/agenda/semana"),
        hover(11_000, 42, "calendario", 1_400),
        click(11_400, 42, "calendario"),
    ];
    let us = vec![
        utt("u01", 12_000, 12_900, "el calendario carga lento"),
        utt("u02", 13_000, 14_300, "otra cosa, el título está mal escrito"),
    ];
    let c = correlate(&events, &us, &cfg());
    assert_eq!(c.issues.len(), 2);
    assert_eq!(c.issues[0].id, "i01");
    assert_eq!(c.issues[0].category, IssueCategory::Perf);
    assert_eq!(c.issues[1].id, "i02");
    assert_eq!(c.issues[1].category, IssueCategory::Copy);
    assert_eq!(c.issues[1].utterance_ids, vec!["u02"]);
}

#[test]
fn la_evidencia_de_consola_hace_bug_high() {
    let mut events = escena_pointer();
    events.push(console_error(11_500, 42, "TypeError: x is not a function"));
    events.push(net_fail(11_700, 42, 500));
    let c = correlate(
        &events,
        &[utt("u01", 12_000, 13_000, "este botón es muy chico")],
        &cfg(),
    );
    let i = &c.issues[0];
    assert_eq!(i.evidence.console.len(), 1);
    assert_eq!(i.evidence.net.len(), 1);
    assert_eq!(i.category, IssueCategory::Bug);
    assert_eq!(i.severity, Severity::High);
}

#[test]
fn long_task_y_layout_shift_van_a_la_evidencia() {
    let mut events = escena_pointer();
    events.push(long_task(11_500, 42, 320));
    events.push(layout_shift(11_600, 42, 0.21));
    let c = correlate(
        &events,
        &[utt("u01", 12_000, 13_000, "este botón se mueve solo")],
        &cfg(),
    );
    assert_eq!(c.issues[0].evidence.net.len(), 2);
    assert_eq!(c.issues[0].category, IssueCategory::Perf);
}

/// Paso 9: pedido de screenshot solo para `element` con confianza suficiente.
#[test]
fn pide_screenshot_solo_para_elementos_confiables() {
    let c = correlate(
        &escena_pointer(),
        &[utt("u01", 12_000, 13_000, "este botón de nuevo turno es re chico")],
        &cfg(),
    );
    assert_eq!(c.issues[0].anchor.kind, AnchorKind::Element);
    assert!(c.issues[0].anchor.confidence >= 0.5);
    assert_eq!(
        c.captures,
        vec![CaptureRequest {
            issue_id: "i01".into(),
            tab: 42,
            t_target: 12_000
        }]
    );
    assert_eq!(
        c.captures[0].to_message(),
        ServerMessage::CaptureRequest {
            v: ProtocolVersionTag,
            tab: 42,
            t_target: 12_000
        }
    );

    // Un ancla de ruta no pide captura.
    let c = correlate(
        &escena_pointer(),
        &[utt("u01", 12_000, 13_500, "esta pantalla está desordenada")],
        &cfg(),
    );
    assert!(c.captures.is_empty());
}

#[test]
fn no_pide_screenshot_bajo_el_umbral_de_confianza() {
    let mut c = cfg();
    c.screenshot_min_confidence = 0.99;
    let r = correlate(
        &escena_pointer(),
        &[utt("u01", 12_000, 13_000, "este botón de nuevo turno es re chico")],
        &c,
    );
    assert_eq!(r.issues[0].anchor.kind, AnchorKind::Element);
    assert!(r.captures.is_empty());
}

/// Un `tab_switch` entre medio corta el grupo y cambia la pestaña del ancla.
#[test]
fn el_cambio_de_pestaña_separa_y_reubica() {
    let events = vec![
        nav(0, 42, "/agenda/semana"),
        hover(9_800, 42, "en-agenda", 1_400),
        click(9_900, 42, "en-agenda"),
        tab_switch(13_000, 42, 7, "https://supabase.com/dashboard"),
        hover(14_800, 7, "en-supabase", 1_400),
        click(14_900, 7, "en-supabase"),
    ];
    let us = vec![
        utt("u01", 12_000, 12_900, "este botón es muy chico"),
        utt("u02", 13_200, 14_100, "este de acá no se entiende"),
    ];
    // Fuera de banda: la utterance 2 arranca 300 ms después del switch, así que sin la
    // regla de §07 paso 1 se habrían fusionado.
    let c = correlate(&events, &us, &cfg());
    assert_eq!(c.issues.len(), 2);
    assert_eq!(c.issues[0].anchor.tab, Some(42));
    assert_eq!(c.issues[0].anchor.url.as_deref(), Some("/agenda/semana"));
    assert_eq!(c.issues[1].anchor.tab, Some(7));
    assert_eq!(
        c.issues[1].anchor.url.as_deref(),
        Some("https://supabase.com/dashboard")
    );
    // Y el ancla de la segunda no puede ser un elemento de la pestaña que ya no está.
    if let Some(t) = &c.issues[1].anchor.target {
        assert_ne!(t.sel, "en-agenda");
    }
}

/// Los umbrales mandan: subir `min_score` degrada un ancla que antes era de elemento.
#[test]
fn la_config_cambia_el_resultado_sin_tocar_el_codigo() {
    let us = [utt("u01", 12_000, 13_000, "este botón de nuevo turno es re chico")];
    let base = correlate(&escena_pointer(), &us, &cfg());
    assert_eq!(base.issues[0].anchor.kind, AnchorKind::Element);

    let mut c = cfg();
    c.min_score = 50.0;
    let tuneado = correlate(&escena_pointer(), &us, &c);
    assert_eq!(tuneado.issues[0].anchor.kind, AnchorKind::Route);

    // Y achicar la ventana deja al issue sin candidatos.
    let mut c = cfg();
    c.window_back_ms = 100;
    c.window_fwd_ms = 0;
    let sin_ventana = correlate(&escena_pointer(), &us, &c);
    assert_eq!(sin_ventana.issues[0].anchor.kind, AnchorKind::Route);
    assert_eq!(sin_ventana.issues[0].anchor.confidence, 0.0);
}

#[test]
fn una_sesion_sin_eventos_no_rompe() {
    let c = correlate(
        &[],
        &[utt("u01", 12_000, 13_000, "este botón es muy chico")],
        &cfg(),
    );
    assert_eq!(c.issues.len(), 1);
    assert_eq!(c.issues[0].anchor.kind, AnchorKind::Route);
    assert_eq!(c.issues[0].anchor.confidence, 0.0);
    assert_eq!(c.issues[0].anchor.tab, None);
}

#[test]
fn una_sesion_sin_utterances_no_produce_nada() {
    let c = correlate(&escena_pointer(), &[], &cfg());
    assert!(c.issues.is_empty());
    assert!(c.discarded.is_empty());
    assert!(c.captures.is_empty());
}

#[test]
fn los_ids_son_correlativos_con_dos_digitos() {
    let mut us = Vec::new();
    for n in 0..12 {
        let t = 20_000 + n * 5_000;
        us.push(utt(
            &format!("u{n:02}"),
            t,
            t + 1_000,
            "este botón es muy chico",
        ));
    }
    let c = correlate(&escena_pointer(), &us, &cfg());
    assert_eq!(c.issues.len(), 12);
    assert_eq!(c.issues[0].id, "i01");
    assert_eq!(c.issues[11].id, "i12");
}

/// El issue serializa contra el contrato de §03 sin perder nada.
#[test]
fn el_issue_serializa_como_manda_el_contrato() {
    let c = correlate(
        &escena_pointer(),
        &[utt("u01", 12_000, 13_000, "este botón de nuevo turno es re chico")],
        &cfg(),
    );
    let v = serde_json::to_value(&c.issues[0]).expect("serializa");
    assert_eq!(v["id"], "i01");
    assert_eq!(v["anchor"]["kind"], "element");
    assert_eq!(v["category"], "ui");
    assert_eq!(v["severity"], "low");
    assert!(v["exported_to"].is_null(), "exported_to es null explícito");
    let ida_y_vuelta: qua_protocol::Issue = serde_json::from_value(v).expect("parsea");
    assert_eq!(ida_y_vuelta, c.issues[0]);
}

/// Un `k` que no existe en el contrato se ignora, no rompe la correlación.
#[test]
fn un_evento_desconocido_en_el_ndjson_no_rompe_nada() {
    let ndjson = r#"
{"t":5000,"tab":42,"k":"scroll","url":"/agenda/semana"}
{"t":9900,"tab":42,"k":"hover","target":{"sel":"nuevo-turno","strategy":"testid","tag":"button","visible":true},"dwell_ms":2100}
{"t":11100,"tab":42,"k":"click","target":{"sel":"nuevo-turno","strategy":"testid","tag":"button","visible":true},"button":0,"mods":[]}
"#;
    let (events, skipped) = events_from_ndjson(ndjson);
    assert_eq!(skipped.len(), 1);
    let c = correlate(
        &events,
        &[utt("u01", 12_000, 13_000, "este botón es muy chico")],
        &cfg(),
    );
    assert_eq!(c.issues[0].anchor.kind, AnchorKind::Element);
    assert_eq!(
        c.issues[0].anchor.target.as_ref().expect("target").sel,
        "nuevo-turno"
    );
}
