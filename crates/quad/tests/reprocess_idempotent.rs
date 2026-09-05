//! Criterio de aceptación de B4: `qua reprocess` tiene que ser idempotente — es lo que
//! permite tunear B3 sobre sesiones ya grabadas sin regrabar. Corre `quad::cli::reprocess`
//! dos veces sobre la misma sesión y compara `session.json`/`report.md`/`issues.json`
//! byte a byte.

use std::path::Path;

use qua_protocol::*;

fn sample_session() -> Session {
    Session {
        schema: SessionSchemaTag,
        id: "2026-09-04T14-32-11Z-a3f9".into(),
        status: SessionStatus::Ready,
        t0_wall: 1_788_012_731_204,
        started_at: "2026-09-04T14:32:11.204Z".into(),
        ended_at: Some("2026-09-04T14:39:03.512Z".into()),
        duration_ms: Some(412_308),
        project: ProjectRef {
            label: "Agendi".into(),
            repo: None,
        },
        git: Some(GitInfo {
            branch: "main".into(),
            sha: "9f21ac3".into(),
            dirty: true,
        }),
        env: EnvInfo {
            ua: "ua".into(),
            chrome: "142.0".into(),
            platform: "macOS 15.1".into(),
            viewport: ViewportInfo {
                w: 1512,
                h: 857,
                dpr: 2.0,
            },
            ext: "1.0.0".into(),
        },
        audio: AudioInfo {
            path: "audio.opus".into(),
            sample_rate: 16000,
            gaps_ms: 0,
        },
        stats: SessionStats {
            events_raw: 3,
            events_kept: 3,
            utterances: 1,
            issues: 1,
        },
        tabs: vec![],
        events: vec![Event::Mark {
            t: 10,
            tab: None,
            source: MarkSource::Hotkey,
        }],
        utterances: vec![Utterance {
            id: "u01".into(),
            t_start: 100,
            t_end: 900,
            text: "este botón es re chico".into(),
            lang: "es".into(),
            words: vec![],
            avg_logprob: -0.2,
            no_speech_prob: 0.01,
            marked: false,
        }],
        issues: vec![Issue {
            id: "i01".into(),
            utterance_ids: vec!["u01".into()],
            t: 100,
            text: "este botón es re chico".into(),
            anchor: Anchor {
                kind: AnchorKind::Element,
                target: Some(TargetRef {
                    sel: "button#x".into(),
                    strategy: SelectorStrategy::Id,
                    tag: "button".into(),
                    text: None,
                    role: None,
                    name: None,
                    rect: Some(Rect {
                        x: 10.0,
                        y: 20.0,
                        w: 88.0,
                        h: 32.0,
                    }),
                    visible: Some(true),
                    classes: Some("px-3 py-1".into()),
                    ancestor_text: None,
                    computed: None,
                    component: None,
                    src: None,
                }),
                tab: Some(1),
                url: Some("http://localhost:3000/x".into()),
                confidence: 0.8,
                reason: vec!["deixis:este".into()],
            },
            evidence: Evidence::default(),
            category: IssueCategory::Ui,
            severity: Severity::Low,
            exported_to: None,
        }],
    }
}

fn write_session_dir(data_dir: &Path, session: &Session) -> std::path::PathBuf {
    let dir = data_dir.join("sessions").join(&session.id);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("session.json"),
        serde_json::to_vec_pretty(session).unwrap(),
    )
    .unwrap();
    dir
}

#[test]
fn reprocess_es_idempotente_byte_a_byte() {
    let tmp = tempfile::tempdir().expect("tmp");
    let data_dir = tmp.path().to_path_buf();
    let session = sample_session();
    let dir = write_session_dir(&data_dir, &session);

    let msg1 = quad::cli::reprocess(&data_dir, &session.id).expect("primera pasada");
    let session_json_1 = std::fs::read(dir.join("session.json")).unwrap();
    let report_1 = std::fs::read(dir.join("report.md")).unwrap();
    let issues_1 = std::fs::read(dir.join("issues.json")).unwrap();
    let transcript_1 = std::fs::read(dir.join("transcript.txt")).unwrap();

    let msg2 = quad::cli::reprocess(&data_dir, &session.id).expect("segunda pasada");
    let session_json_2 = std::fs::read(dir.join("session.json")).unwrap();
    let report_2 = std::fs::read(dir.join("report.md")).unwrap();
    let issues_2 = std::fs::read(dir.join("issues.json")).unwrap();
    let transcript_2 = std::fs::read(dir.join("transcript.txt")).unwrap();

    assert_eq!(
        msg1, msg2,
        "el mensaje de salida también tiene que ser estable"
    );
    assert_eq!(session_json_1, session_json_2, "session.json divergió");
    assert_eq!(report_1, report_2, "report.md divergió");
    assert_eq!(issues_1, issues_2, "issues.json divergió");
    assert_eq!(transcript_1, transcript_2, "transcript.txt divergió");

    // Y una tercera vuelta más, para no dejar pasar un ciclo de período 2.
    quad::cli::reprocess(&data_dir, &session.id).expect("tercera pasada");
    let report_3 = std::fs::read(dir.join("report.md")).unwrap();
    assert_eq!(report_1, report_3);
}

#[test]
fn reprocess_actualiza_el_indice_sqlite() {
    let tmp = tempfile::tempdir().expect("tmp");
    let data_dir = tmp.path().to_path_buf();
    let session = sample_session();
    write_session_dir(&data_dir, &session);

    quad::cli::reprocess(&data_dir, &session.id).expect("reprocess");

    let conn = qua_core::store::open(&data_dir).expect("store");
    let row = qua_core::store::get_session(&conn, &session.id)
        .expect("query")
        .expect("la sesión tiene que quedar indexada");
    assert_eq!(row.issue_count, 1);
    assert_eq!(row.project, "Agendi");
}

#[test]
fn show_default_es_el_report_md_y_export_json_es_issues_json() {
    let tmp = tempfile::tempdir().expect("tmp");
    let data_dir = tmp.path().to_path_buf();
    let session = sample_session();
    write_session_dir(&data_dir, &session);
    quad::cli::reprocess(&data_dir, &session.id).expect("reprocess");

    let shown =
        quad::cli::show(&data_dir, &session.id, quad::cli::ShowFormat::Md).expect("show md");
    assert!(shown.starts_with("# QUA — Agendi"));

    let exported = quad::cli::export(&data_dir, &session.id, quad::cli::ExportFormat::Json)
        .expect("export json");
    let parsed: Vec<Issue> = serde_json::from_str(&exported).expect("issues.json válido");
    assert_eq!(parsed.len(), 1);
    assert_eq!(parsed[0].id, "i01");
}

#[test]
fn sessions_lista_lo_que_reprocess_indexo() {
    let tmp = tempfile::tempdir().expect("tmp");
    let data_dir = tmp.path().to_path_buf();
    let session = sample_session();
    write_session_dir(&data_dir, &session);
    quad::cli::reprocess(&data_dir, &session.id).expect("reprocess");

    let listado = quad::cli::sessions(&data_dir, None, None).expect("sessions");
    assert!(listado.contains(&session.id), "listado: {listado}");
    assert!(listado.contains("Agendi"));
}
