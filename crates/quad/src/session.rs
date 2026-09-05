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

/// Una sesión abierta por `hello`. `meta` (y los logs crudos) quedan `None` hasta que
/// llega `session.start` — antes de eso, `events`/`mark`/`frame` son `no_session`
/// (§04, D-04).
pub struct ActiveSession {
    pub id: String,
    pub dir: PathBuf,
    pub meta: Option<SessionMeta>,
    events_log: Option<RawEventLog>,
    audio_log: Option<RawAudioLog>,
    events_buffer: Vec<Event>,
}

impl ActiveSession {
    /// `hello`: mintea el id y calcula `<data_dir>/sessions/<id>/` — todavía no toca
    /// el filesystem (D-Q1-01, docs/DECISIONS.md, revisita la "alternativa
    /// descartada" de D-P1-01). El canal de control ocioso (D-P1-01) manda `hello` en
    /// cada reciclado del service worker sin arrancar sesión nunca; crear el
    /// directorio acá dejaba un `raw/` vacío huérfano por cada uno. No hay nada que
    /// crear todavía porque no hay `t0_wall` ni `env` — eso llega con `session.start`,
    /// que es quien de verdad escribe algo a disco.
    pub fn create(data_dir: &Path) -> Self {
        let id = new_session_id();
        let dir = data_dir.join("sessions").join(&id);
        Self {
            id,
            dir,
            meta: None,
            events_log: None,
            audio_log: None,
            events_buffer: Vec::new(),
        }
    }

    pub fn is_started(&self) -> bool {
        self.meta.is_some()
    }

    /// `session.start`: acá es donde de verdad hace falta el directorio — crea
    /// `raw/`, abre los dos logs crudos, fija el reloj único (§02) y escribe
    /// `raw/meta.json` de una, sincrónico (es un solo escritor pequeño y crítico, no
    /// vale la pena diferirlo al timer de 2 s).
    pub fn start(&mut self, payload: SessionStartPayload) -> std::io::Result<()> {
        std::fs::create_dir_all(self.dir.join("raw"))?;
        let events_log = RawEventLog::create(&self.dir.join("raw/events.ndjson"))?;
        let audio_log = RawAudioLog::create(&self.dir.join("raw/audio.pcm"))?;
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
        self.events_log = Some(events_log);
        self.audio_log = Some(audio_log);
        self.meta = Some(meta);
        Ok(())
    }

    /// Agrega un lote al log crudo y al buffer en memoria. Devuelve `false` si era un
    /// replay (mismo `seq` o anterior) — el llamador no debe tratarlo como error, es
    /// justo lo que el outbox de la extensión hace tras reconectar (§04).
    ///
    /// Panics si `!is_started()` — el llamador (`ws.rs`) ya filtra por `is_started()`
    /// antes de llegar acá, así que este `expect` documenta el invariante en vez de
    /// forzar un `Result` que ningún caso real puede disparar.
    pub fn ingest_events(&mut self, seq: i64, items: Vec<Event>) -> std::io::Result<bool> {
        let log = self
            .events_log
            .as_mut()
            .expect("ingest_events: la sesión no arrancó (llamar solo si is_started())");
        let written = log.append_batch(seq, &items)?;
        if written {
            self.events_buffer.extend(items);
        }
        Ok(written)
    }

    pub fn ingest_audio(&mut self, samples: &[i16]) -> std::io::Result<()> {
        let log = self
            .audio_log
            .as_mut()
            .expect("ingest_audio: la sesión no arrancó (llamar solo si is_started())");
        log.append_samples(samples)
    }

    /// El `mark` de nivel de mensaje (§04) no trae `seq` de cliente — se escribe fuera
    /// de banda (ver D-B1-02 en DECISIONS.md) y el llamador sincroniza enseguida
    /// después, porque `mark` "fuerza flush inmediato".
    pub fn ingest_mark(&mut self, event: Event) -> std::io::Result<()> {
        let log = self
            .events_log
            .as_mut()
            .expect("ingest_mark: la sesión no arrancó (llamar solo si is_started())");
        log.append_out_of_band(std::slice::from_ref(&event))?;
        self.events_buffer.push(event);
        Ok(())
    }

    /// El fsync periódico de §04. `Some(seq)` si había algo nuevo que sincronizar —
    /// eso es exactamente el `seq` que hay que ackear. `None` sin tocar disco si la
    /// sesión todavía no arrancó (canal de control ocioso, D-P1-01) — no hay logs que
    /// abrir todavía.
    pub fn sync(&mut self) -> std::io::Result<Option<i64>> {
        let Some(events_log) = self.events_log.as_mut() else {
            return Ok(None);
        };
        let event_seq = events_log.sync()?;
        if let Some(audio_log) = self.audio_log.as_mut() {
            audio_log.sync()?;
        }
        Ok(event_seq)
    }

    pub fn events_snapshot(&self) -> Vec<Event> {
        self.events_buffer.clone()
    }
}
