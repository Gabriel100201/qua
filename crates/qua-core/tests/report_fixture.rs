//! Criterio de aceptación de B4: "el markdown de §08.1 se reproduce exacto desde una
//! fixture de F0". `fixtures/session-full.json` es esa fixture (la misma sesión
//! "Agendi" que usa §08.1 como ejemplo); `tests/golden/report-session-full.md` es el
//! `report.md` esperado byte a byte.

use std::fs;
use std::path::{Path, PathBuf};

use qua_protocol::Session;

fn repo_root() -> PathBuf {
    // CARGO_MANIFEST_DIR = <repo>/crates/qua-core
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .expect("el crate vive en <repo>/crates/qua-core")
        .to_path_buf()
}

fn load_fixture(rel: &str) -> Session {
    let raw = fs::read_to_string(repo_root().join(rel))
        .unwrap_or_else(|e| panic!("no pude leer {rel}: {e}"));
    serde_json::from_str(&raw).unwrap_or_else(|e| panic!("{rel} no es un Session válido: {e}"))
}

#[test]
fn report_md_reproduce_exacto_el_formato_de_8_1() {
    let session = load_fixture("fixtures/session-full.json");
    let got = qua_core::render::render_report_md(&session);

    let golden_path =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/golden/report-session-full.md");
    let want = fs::read_to_string(&golden_path).expect("golden file");

    assert_eq!(
        got,
        want,
        "report.md de fixtures/session-full.json divergió del golden en {}",
        golden_path.display()
    );
}

#[test]
fn report_md_ordena_por_severidad_y_despues_confianza() {
    let session = load_fixture("fixtures/session-full.json");
    let got = qua_core::render::render_report_md(&session);

    // El único `high` (i02, bug) tiene que salir primero pese a no ser el primero en
    // `session.issues`; entre los `low` restantes, mayor confianza primero.
    let pos = |needle: &str| {
        got.find(needle)
            .unwrap_or_else(|| panic!("falta {needle:?}"))
    };
    let bug_high = pos("## 01 · bug · high");
    let ui_091 = pos("## 02 · ui · low");
    let idea_055 = pos("## 03 · idea · low");
    let ui_040 = pos("## 04 · ui · low");
    assert!(bug_high < ui_091, "high tiene que ir antes que low");
    assert!(
        ui_091 < idea_055 && idea_055 < ui_040,
        "dentro de low, mayor confianza primero"
    );
}

#[test]
fn issues_confidence_menor_a_035_va_a_sin_anclar() {
    let mut session = load_fixture("fixtures/session-full.json");
    // i04 tiene confidence 0.40 en la fixture — bajarla fuerza el camino de "Sin
    // anclar" sin inventar un issue nuevo.
    session.issues[3].anchor.confidence = 0.2;
    let got = qua_core::render::render_report_md(&session);

    assert!(got.contains("## Sin anclar"), "falta la sección: {got}");
    assert!(
        !got.contains("## 04"),
        "un issue con confidence < 0.35 no puede tener bloque numerado propio"
    );
    // Los otros tres siguen anclados normalmente.
    assert!(got.contains("## 01"));
    assert!(got.contains("## 02"));
    assert!(got.contains("## 03"));
    assert!(!got.contains("## 05"));
}

#[test]
fn issues_json_serializa_solo_los_issues_en_orden_original() {
    let session = load_fixture("fixtures/session-full.json");
    let raw = qua_core::render::render_issues_json(&session).expect("serializa");
    let parsed: Vec<qua_protocol::Issue> = serde_json::from_str(&raw).expect("es JSON válido");
    assert_eq!(parsed, session.issues);
}

#[test]
fn transcript_txt_tiene_una_linea_por_utterance_con_timestamp() {
    let session = load_fixture("fixtures/session-full.json");
    let got = qua_core::render::render_transcript(&session);
    let lines: Vec<&str> = got.lines().collect();
    assert_eq!(lines.len(), session.utterances.len());
    assert!(lines[0].starts_with("[00:00:05] "));
    assert!(
        lines[0].contains("este botón de nuevo turno es re chico"),
        "línea: {}",
        lines[0]
    );
    // u03 es la única `marked: true` de la fixture.
    assert!(lines[2].ends_with(" [mark]"), "línea: {}", lines[2]);
    assert!(!lines[0].ends_with(" [mark]"));
}

#[test]
fn render_session_escribe_los_tres_archivos_de_texto() {
    let session = load_fixture("fixtures/session-full.json");
    let dir = tempfile::tempdir().expect("tmp");
    let out = qua_core::render::render_session(&session, dir.path()).expect("render");

    assert!(out.report_path.exists());
    assert!(out.issues_path.exists());
    assert!(out.transcript_path.exists());
    // Sin frames crudos en `raw/frames/`, no hay nada que recortar todavía (D-B4-05).
    assert!(out.screenshots.is_empty());
}

#[test]
fn render_session_es_idempotente_byte_a_byte() {
    let session = load_fixture("fixtures/session-full.json");
    let dir = tempfile::tempdir().expect("tmp");

    qua_core::render::render_session(&session, dir.path()).expect("primera pasada");
    let report_1 = fs::read(dir.path().join("report.md")).unwrap();
    let issues_1 = fs::read(dir.path().join("issues.json")).unwrap();

    qua_core::render::render_session(&session, dir.path()).expect("segunda pasada");
    let report_2 = fs::read(dir.path().join("report.md")).unwrap();
    let issues_2 = fs::read(dir.path().join("issues.json")).unwrap();

    assert_eq!(report_1, report_2, "report.md tiene que ser idéntico");
    assert_eq!(issues_1, issues_2, "issues.json tiene que ser idéntico");
}
