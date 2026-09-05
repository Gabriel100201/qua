//! Estado de una sesión en curso: une los escritores crash-safe de `qua-core::ingest`
//! con el buffer en memoria que arma el `session.json` final sin releer el disco.

use std::path::{Path, PathBuf};

use chrono::{SecondsFormat, Utc};
use qua_core::ingest::{RawAudioLog, RawEventLog, SessionMeta};
use qua_protocol::{Event, SessionStartPayload};
use rand::RngCore;

/// `2026-09-04T14-32-11Z-a3f9` (§03): ISO compacto (sin `:`) + 4 hex.
pub fn new_session_id() -> String {
    let now = Utc::now();
    let ts = now.format("%Y-%m-%dT%H-%M-%S").to_string();
    let mut suffix = [0u8; 2];
    rand::thread_rng().fill_bytes(&mut suffix);
    let hex: String = suffix.iter().map(|b| format!("{b:02x}")).collect();
    format!("{ts}Z-{hex}")
}

pub fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

/// Una sesión abierta por `hello`. `meta` queda `None` hasta que llega `session.start`
/// — antes de eso, `events`/`mark`/`frame` son `no_session` (§04, D-04).
pub struct ActiveSession {
    pub id: String,
    pub dir: PathBuf,
    pub meta: Option<SessionMeta>,
    events_log: RawEventLog,
    audio_log: RawAudioLog,
    events_buffer: Vec<Event>,
}

impl ActiveSession {
    /// `hello`: mintea el id, crea `<data_dir>/sessions/<id>/raw/` y abre los dos logs
    /// crudos. Todavía no hay `t0_wall` ni `env` — eso llega con `session.start`.
    pub fn create(data_dir: &Path) -> std::io::Result<Self> {
        let id = new_session_id();
        let dir = data_dir.join("sessions").join(&id);
        std::fs::create_dir_all(dir.join("raw"))?;
        let events_log = RawEventLog::create(&dir.join("raw/events.ndjson"))?;
        let audio_log = RawAudioLog::create(&dir.join("raw/audio.pcm"))?;
        Ok(Self {
            id,
            dir,
            meta: None,
            events_log,
            audio_log,
            events_buffer: Vec::new(),
        })
    }

    pub fn is_started(&self) -> bool {
        self.meta.is_some()
    }

    /// `session.start`: fija el reloj único (§02) y escribe `raw/meta.json` de una,
    /// sincrónico — es un solo escritor pequeño y crítico, no vale la pena diferirlo
    /// al timer de 2 s.
    pub fn start(&mut self, payload: SessionStartPayload) -> std::io::Result<()> {
        let meta = SessionMeta {
            id: self.id.clone(),
            t0_wall: payload.t0_wall,
            started_at: now_iso(),
            base_url: payload.base_url,
            env: payload.env,
        };
        std::fs::write(
            self.dir.join("raw/meta.json"),
            serde_json::to_vec(&meta).expect("SessionMeta serializa"),
        )?;
        self.meta = Some(meta);
        Ok(())
    }

    /// Agrega un lote al log crudo y al buffer en memoria. Devuelve `false` si era un
    /// replay (mismo `seq` o anterior) — el llamador no debe tratarlo como error, es
    /// justo lo que el outbox de la extensión hace tras reconectar (§04).
    pub fn ingest_events(&mut self, seq: i64, items: Vec<Event>) -> std::io::Result<bool> {
        let written = self.events_log.append_batch(seq, &items)?;
        if written {
            self.events_buffer.extend(items);
        }
        Ok(written)
    }

    pub fn ingest_audio(&mut self, samples: &[i16]) -> std::io::Result<()> {
        self.audio_log.append_samples(samples)
    }

    /// El `mark` de nivel de mensaje (§04) no trae `seq` de cliente — se escribe fuera
    /// de banda (ver D-B1-02 en DECISIONS.md) y el llamador sincroniza enseguida
    /// después, porque `mark` "fuerza flush inmediato".
    pub fn ingest_mark(&mut self, event: Event) -> std::io::Result<()> {
        self.events_log
            .append_out_of_band(std::slice::from_ref(&event))?;
        self.events_buffer.push(event);
        Ok(())
    }

    /// El fsync periódico de §04. `Some(seq)` si había algo nuevo que sincronizar —
    /// eso es exactamente el `seq` que hay que ackear.
    pub fn sync(&mut self) -> std::io::Result<Option<i64>> {
        let event_seq = self.events_log.sync()?;
        self.audio_log.sync()?;
        Ok(event_seq)
    }

    pub fn events_snapshot(&self) -> Vec<Event> {
        self.events_buffer.clone()
    }
}
