//! `qua recover <id>`: reconstruye una `Session` desde `raw/` (§04 Resiliencia).
//!
//! Cubre dos casos con el mismo código: el `session.stop` normal (el servidor ya tiene
//! `meta` en memoria) y la recuperación post-`kill -9` (un proceso nuevo que solo tiene
//! el directorio en disco). Por eso [`read_meta`] y [`recover_session`] están separados:
//! el servidor evita releer su propio `meta.json`.

use std::io;
use std::path::Path;

use qua_protocol::{EnvInfo, ProjectRef, Session, SessionStatus};
use serde::{Deserialize, Serialize};

use super::raw_log::read_events_ndjson;
use super::session_builder::build_session;

/// `raw/meta.json`: lo que hace falta para reconstruir una sesión que solo tiene
/// eventos crudos. Se escribe una vez, al recibir `session.start` (§04) — es el punto
/// en el que la sesión "existe" de verdad (antes de eso, `hello` ya creó el directorio
/// pero no hay `t0_wall` ni `env` todavía).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionMeta {
    pub id: String,
    pub t0_wall: i64,
    pub started_at: String,
    pub base_url: String,
    pub env: EnvInfo,
}

/// `raw/stop.json`: marca que `session.stop` llegó a procesarse. Sin este archivo,
/// `qua recover` no puede distinguir "sigue grabando" de "se cortó justo al parar" —
/// y por D-02, una sesión sin esto se recupera con `status: recording`, que es lo
/// correcto: no sabemos que terminó.
#[derive(Debug, Serialize, Deserialize)]
pub struct StopMarker {
    pub t: i64,
    pub ended_at: String,
}

#[derive(Debug, thiserror::Error)]
pub enum RecoverError {
    #[error("no se encontró raw/meta.json en {0}: la sesión nunca recibió session.start")]
    NoMeta(std::path::PathBuf),
    #[error("IO: {0}")]
    Io(#[from] io::Error),
    #[error("meta.json corrupto: {0}")]
    Json(#[from] serde_json::Error),
}

/// Lee `raw/meta.json`. Falla si nunca se escribió (la sesión murió entre `hello` y
/// `session.start`, así que no hay nada recuperable más allá de un directorio vacío).
pub fn read_meta(session_dir: &Path) -> Result<SessionMeta, RecoverError> {
    let path = session_dir.join("raw").join("meta.json");
    let raw = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            return Err(RecoverError::NoMeta(path));
        }
        Err(e) => return Err(e.into()),
    };
    Ok(serde_json::from_str(&raw)?)
}

/// Reconstruye la `Session` completa a partir de `raw/events.ndjson` (+ el marcador de
/// stop si llegó a escribirse). No corre ASR ni correlador — `utterances` e `issues`
/// quedan vacíos; eso lo completan B2/B3/B4 sobre el `session.json` que esto produce.
pub fn recover_session(
    session_dir: &Path,
    meta: &SessionMeta,
    project: ProjectRef,
) -> Result<Session, RecoverError> {
    let events = read_events_ndjson(&session_dir.join("raw").join("events.ndjson"))?;

    let stop_marker: Option<StopMarker> =
        match std::fs::read_to_string(session_dir.join("raw").join("stop.json")) {
            Ok(raw) => serde_json::from_str(&raw).ok(),
            Err(_) => None,
        };

    let (status, ended_at, duration_ms) = match &stop_marker {
        Some(marker) => (
            SessionStatus::Processing,
            Some(marker.ended_at.clone()),
            Some(marker.t),
        ),
        None => (SessionStatus::Recording, None, None),
    };

    let audio_path = if session_dir.join("audio.opus").exists() {
        "audio.opus".to_string()
    } else {
        "raw/audio.pcm".to_string()
    };

    Ok(build_session(
        meta,
        events,
        status,
        ended_at,
        duration_ms,
        project,
        audio_path,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use qua_protocol::{Event, MarkSource, ViewportInfo};

    fn sample_meta() -> SessionMeta {
        SessionMeta {
            id: "2026-09-04T14-32-11Z-a3f9".into(),
            t0_wall: 1_788_012_731_204,
            started_at: "2026-09-04T14:32:11.204Z".into(),
            base_url: "http://localhost:3000/agenda/semana".into(),
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
        }
    }

    #[test]
    fn sin_stop_marker_queda_recording() {
        let dir = tempfile::tempdir().expect("tmp");
        std::fs::create_dir_all(dir.path().join("raw")).expect("raw dir");
        let meta = sample_meta();
        std::fs::write(
            dir.path().join("raw/meta.json"),
            serde_json::to_string(&meta).unwrap(),
        )
        .expect("meta");

        let mut log =
            super::super::raw_log::RawEventLog::create(&dir.path().join("raw/events.ndjson"))
                .expect("log");
        log.append_batch(
            1,
            &[Event::Mark {
                t: 10,
                tab: None,
                source: MarkSource::Hotkey,
            }],
        )
        .expect("batch");
        log.sync().expect("sync");
        drop(log);

        let project = ProjectRef {
            label: "unknown".into(),
            repo: None,
        };
        let session = recover_session(dir.path(), &meta, project).expect("recover");
        assert_eq!(session.status, SessionStatus::Recording);
        assert!(session.ended_at.is_none());
        assert_eq!(session.events.len(), 1);
        assert_eq!(session.id, meta.id);
    }

    #[test]
    fn con_stop_marker_queda_processing() {
        let dir = tempfile::tempdir().expect("tmp");
        std::fs::create_dir_all(dir.path().join("raw")).expect("raw dir");
        let meta = sample_meta();
        std::fs::write(
            dir.path().join("raw/meta.json"),
            serde_json::to_string(&meta).unwrap(),
        )
        .expect("meta");
        std::fs::write(
            dir.path().join("raw/stop.json"),
            serde_json::to_string(&StopMarker {
                // `t` viaja en epoch-ms absoluto, igual que todo `t` de §02 (5s de
                // sesión, no 5s desde el epoch): `build_session` lo normaliza contra
                // `meta.t0_wall`.
                t: meta.t0_wall + 5000,
                ended_at: "2026-09-04T14:33:11.204Z".into(),
            })
            .unwrap(),
        )
        .expect("stop marker");

        let project = ProjectRef {
            label: "Agendi".into(),
            repo: Some("/tmp/agendi".into()),
        };
        let session = recover_session(dir.path(), &meta, project).expect("recover");
        assert_eq!(session.status, SessionStatus::Processing);
        assert_eq!(session.duration_ms, Some(5000));
        assert_eq!(
            session.ended_at.as_deref(),
            Some("2026-09-04T14:33:11.204Z")
        );
    }

    #[test]
    fn sin_meta_falla_explicitamente() {
        let dir = tempfile::tempdir().expect("tmp");
        let err = read_meta(dir.path()).unwrap_err();
        assert!(matches!(err, RecoverError::NoMeta(_)));
    }
}
