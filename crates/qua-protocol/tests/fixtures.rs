//! EL TEST QUE DEFINE «LISTO» — lado Rust.
//!
//! Parsea TODAS las fixtures doradas y hace round-trip (parse → serializar → comparar).
//! `packages/protocol/test/fixtures.test.ts` hace exactamente lo mismo del lado TS sobre
//! los mismos archivos. Si los dos lenguajes no aceptan lo mismo, uno de los dos falla.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use qua_protocol::{
    AnchorKind, AudioFrame, ClientMessage, Event, HealthResponse, PairRequest, PairResponse,
    ServerMessage, Session, EVENT_KINDS,
};
use serde_json::Value;

/// Qué tipo espeja cada fixture. Espejo de `FIXTURE_MANIFEST` en
/// `packages/protocol/src/fixtures.ts`: las dos listas tienen que cubrir los mismos archivos.
const MANIFEST: &[(&str, Kind)] = &[
    ("fixtures/session-minimal.json", Kind::Session),
    ("fixtures/session-full.json", Kind::Session),
    ("fixtures/messages/client-hello.json", Kind::ClientMessage),
    (
        "fixtures/messages/client-session-start.json",
        Kind::ClientMessage,
    ),
    ("fixtures/messages/client-events.json", Kind::ClientMessage),
    ("fixtures/messages/client-mark.json", Kind::ClientMessage),
    ("fixtures/messages/client-frame.json", Kind::ClientMessage),
    (
        "fixtures/messages/client-session-stop.json",
        Kind::ClientMessage,
    ),
    ("fixtures/messages/client-ping.json", Kind::ClientMessage),
    (
        "fixtures/messages/server-hello-ok.json",
        Kind::ServerMessage,
    ),
    ("fixtures/messages/server-ack.json", Kind::ServerMessage),
    (
        "fixtures/messages/server-transcript-partial.json",
        Kind::ServerMessage,
    ),
    (
        "fixtures/messages/server-capture-request.json",
        Kind::ServerMessage,
    ),
    (
        "fixtures/messages/server-session-done.json",
        Kind::ServerMessage,
    ),
    (
        "fixtures/messages/server-session-control.json",
        Kind::ServerMessage,
    ),
    ("fixtures/messages/server-error.json", Kind::ServerMessage),
    (
        "fixtures/messages/http-pair-request.json",
        Kind::PairRequest,
    ),
    (
        "fixtures/messages/http-pair-response.json",
        Kind::PairResponse,
    ),
    (
        "fixtures/messages/http-health-response.json",
        Kind::HealthResponse,
    ),
];

#[derive(Debug, Clone, Copy)]
enum Kind {
    Session,
    ClientMessage,
    ServerMessage,
    PairRequest,
    PairResponse,
    HealthResponse,
}

fn repo_root() -> PathBuf {
    // CARGO_MANIFEST_DIR = <repo>/crates/qua-protocol
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .expect("el crate vive en <repo>/crates/qua-protocol")
        .to_path_buf()
}

fn read_fixture(rel: &str) -> Value {
    let path = repo_root().join(rel);
    let raw = fs::read_to_string(&path).unwrap_or_else(|e| panic!("no pude leer {rel}: {e}"));
    serde_json::from_str(&raw).unwrap_or_else(|e| panic!("{rel} no es JSON válido: {e}"))
}

/// Round-trip: deserializa al tipo fuerte y vuelve a `Value`.
fn roundtrip(kind: Kind, raw: &Value) -> Value {
    macro_rules! rt {
        ($ty:ty) => {{
            let parsed: $ty = serde_json::from_value(raw.clone())
                .unwrap_or_else(|e| panic!("no parsea como {}: {e}", stringify!($ty)));
            serde_json::to_value(&parsed).expect("serializa")
        }};
    }
    match kind {
        Kind::Session => rt!(Session),
        Kind::ClientMessage => rt!(ClientMessage),
        Kind::ServerMessage => rt!(ServerMessage),
        Kind::PairRequest => rt!(PairRequest),
        Kind::PairResponse => rt!(PairResponse),
        Kind::HealthResponse => rt!(HealthResponse),
    }
}

/// JSON no distingue `2` de `2.0`, y del lado TS todo número es un `f64`. Para comparar
/// con la misma semántica que JavaScript, se normaliza todo flotante de valor entero
/// a entero antes de igualar. Ver `docs/DECISIONS.md` (D-05).
fn normalize(value: &Value) -> Value {
    match value {
        Value::Number(n) => {
            if let Some(f) = n.as_f64() {
                if f.fract() == 0.0 && f.abs() < 9_007_199_254_740_992.0 {
                    return Value::Number(serde_json::Number::from(f as i64));
                }
            }
            value.clone()
        }
        Value::Array(items) => Value::Array(items.iter().map(normalize).collect()),
        Value::Object(map) => {
            Value::Object(map.iter().map(|(k, v)| (k.clone(), normalize(v))).collect())
        }
        _ => value.clone(),
    }
}

#[test]
fn todas_las_fixtures_parsean_y_hacen_round_trip() {
    for (rel, kind) in MANIFEST {
        let raw = read_fixture(rel);
        let back = roundtrip(*kind, &raw);
        assert_eq!(
            normalize(&back),
            normalize(&raw),
            "{rel}: el round-trip perdió o inventó campos"
        );
    }
}

#[test]
fn session_full_cubre_los_18_tipos_de_evento() {
    let session: Session = serde_json::from_value(read_fixture("fixtures/session-full.json"))
        .expect("session-full parsea");
    let seen: BTreeSet<&str> = session.events.iter().map(Event::kind).collect();
    let expected: BTreeSet<&str> = EVENT_KINDS.iter().copied().collect();
    let missing: Vec<_> = expected.difference(&seen).collect();
    assert!(missing.is_empty(), "faltan tipos de evento: {missing:?}");
    assert_eq!(seen.len(), EVENT_KINDS.len());
}

#[test]
fn session_full_cubre_las_3_clases_de_anchor() {
    let session: Session = serde_json::from_value(read_fixture("fixtures/session-full.json"))
        .expect("session-full parsea");
    let mut seen = BTreeSet::new();
    for issue in &session.issues {
        seen.insert(match issue.anchor.kind {
            AnchorKind::Element => "element",
            AnchorKind::Route => "route",
            AnchorKind::Session => "session",
        });
    }
    assert_eq!(
        seen,
        BTreeSet::from(["element", "route", "session"]),
        "session-full tiene que cubrir las 3 clases de anchor"
    );
}

#[test]
fn los_stats_coinciden_con_el_contenido() {
    for rel in [
        "fixtures/session-minimal.json",
        "fixtures/session-full.json",
    ] {
        let s: Session = serde_json::from_value(read_fixture(rel)).expect("parsea");
        assert_eq!(s.stats.events_kept, s.events.len() as i64, "{rel}: events");
        assert_eq!(
            s.stats.utterances,
            s.utterances.len() as i64,
            "{rel}: utterances"
        );
        assert_eq!(s.stats.issues, s.issues.len() as i64, "{rel}: issues");
    }
}

#[test]
fn solo_los_anchors_element_llevan_target() {
    for rel in [
        "fixtures/session-minimal.json",
        "fixtures/session-full.json",
    ] {
        let s: Session = serde_json::from_value(read_fixture(rel)).expect("parsea");
        for issue in &s.issues {
            match issue.anchor.kind {
                AnchorKind::Element => assert!(
                    issue.anchor.target.is_some(),
                    "{rel}/{}: es element y no tiene target",
                    issue.id
                ),
                _ => assert!(
                    issue.anchor.target.is_none(),
                    "{rel}/{}: no es element y trae target",
                    issue.id
                ),
            }
        }
    }
}

#[test]
fn rechaza_un_evento_con_k_desconocido() {
    let raw = serde_json::json!({
        "v": 1, "type": "events", "seq": 0,
        "items": [{ "t": 0, "k": "telepatia" }]
    });
    assert!(serde_json::from_value::<ClientMessage>(raw).is_err());
}

#[test]
fn rechaza_un_mensaje_con_v_distinto_de_1() {
    let raw = serde_json::json!({ "v": 2, "type": "ping" });
    assert!(serde_json::from_value::<ClientMessage>(raw).is_err());
}

#[test]
fn rechaza_un_schema_de_sesion_desconocido() {
    let mut raw = read_fixture("fixtures/session-minimal.json");
    raw["schema"] = Value::String("qua/session@2".into());
    assert!(serde_json::from_value::<Session>(raw).is_err());
}

#[test]
fn el_frame_dorado_decodifica_igual_que_en_ts() {
    let meta = read_fixture("fixtures/audio-frame.json");
    let bin = fs::read(repo_root().join("fixtures/audio-frame.bin")).expect("audio-frame.bin");

    assert_eq!(bin.len(), 653);
    assert_eq!(bin.len() as u64, meta["total_bytes"].as_u64().unwrap());

    let frame = AudioFrame::decode(&bin).expect("decodifica");
    assert_eq!(u64::from(frame.seq), meta["seq"].as_u64().unwrap());
    assert_eq!(frame.t_ms, meta["t_ms"].as_u64().unwrap());

    let expected: Vec<i16> = meta["samples"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_i64().unwrap() as i16)
        .collect();
    assert_eq!(frame.samples, expected);

    assert_eq!(
        frame.encode().expect("encodea"),
        bin,
        "round-trip byte a byte"
    );
}

#[test]
fn el_frame_rechaza_magic_y_tamano_equivocados() {
    let mut bin = fs::read(repo_root().join("fixtures/audio-frame.bin")).expect("audio-frame.bin");
    assert!(qua_protocol::is_audio_frame(&bin));
    bin[0] = 0x01;
    assert!(!qua_protocol::is_audio_frame(&bin));
    assert!(matches!(
        AudioFrame::decode(&bin),
        Err(qua_protocol::AudioFrameError::BadMagic { .. })
    ));
    assert!(matches!(
        AudioFrame::decode(&bin[..100]),
        Err(qua_protocol::AudioFrameError::BadLength { .. })
    ));
}

/// El manifiesto de Rust y el de TS tienen que listar exactamente los mismos archivos.
/// Si alguien agrega una fixture de un solo lado, esto lo caza.
#[test]
fn el_manifiesto_cubre_todas_las_fixtures_del_repo() {
    let root = repo_root();
    let listed: BTreeSet<String> = MANIFEST.iter().map(|(p, _)| (*p).to_string()).collect();

    let mut on_disk = BTreeSet::new();
    for entry in fs::read_dir(root.join("fixtures")).expect("fixtures/") {
        let entry = entry.expect("entry");
        let name = entry.file_name().to_string_lossy().into_owned();
        // `audio-frame.json` es metadata del .bin, no una fixture del manifiesto.
        if name.ends_with(".json") && name != "audio-frame.json" {
            on_disk.insert(format!("fixtures/{name}"));
        }
    }
    for entry in fs::read_dir(root.join("fixtures/messages")).expect("fixtures/messages/") {
        let entry = entry.expect("entry");
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.ends_with(".json") {
            on_disk.insert(format!("fixtures/messages/{name}"));
        }
    }

    assert_eq!(
        listed, on_disk,
        "el manifiesto y fixtures/ no coinciden — actualizá los DOS manifiestos (TS y Rust)"
    );
}
