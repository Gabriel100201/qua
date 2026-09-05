//! Escritores crash-safe de `raw/events.ndjson` y `raw/audio.pcm` (§04, §06).
//!
//! La garantía que hay que sostener: un `ack` solo sale después de que los bytes
//! correspondientes están fsync-eados en disco. Antes de eso el dato vive en el buffer
//! del `BufWriter` y en el page cache del SO — un `kill -9` lo perdería. Por eso
//! [`RawEventLog::sync`] es lo único que puede mover `last_synced_seq`, y el servidor
//! (`quad`) solo manda `Ack{seq}` cuando `sync` le devuelve ese seq.
//!
//! El período de fsync (2 s en la spec) lo maneja el llamador con un timer; acá solo
//! están las primitivas síncronas.

use std::fs::{File, OpenOptions};
use std::io::{self, BufWriter, Write};
use std::path::Path;

use qua_protocol::Event;
use serde::{Deserialize, Serialize};

/// Una línea de `raw/events.ndjson`: el lote tal como llegó en `ClientMessage::Events`.
///
/// Formato interno de B1, no parte del protocolo de red — nadie fuera de este crate
/// necesita que coincida con `ClientMessage`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawEventBatch {
    pub seq: i64,
    pub items: Vec<Event>,
}

/// Apéndice crash-safe de lotes de eventos.
///
/// `seq` es monótono por sesión (§04): un lote con `seq` menor o igual al último ya
/// escrito es un replay del outbox tras una reconexión y se descarta sin volver a
/// escribirlo (evita duplicar líneas en el ndjson).
pub struct RawEventLog {
    file: BufWriter<File>,
    last_written_seq: i64,
    last_synced_seq: i64,
    /// Hay bytes escritos que `sync` todavía no fsyncó. Cubre tanto lotes normales
    /// como escrituras fuera de banda ([`Self::append_out_of_band`]), que no tienen
    /// `seq` de cliente y por lo tanto no mueven `last_written_seq`.
    dirty: bool,
}

impl RawEventLog {
    /// Abre (creando si hace falta) `path` en modo apéndice. Nunca trunca: en operación
    /// normal el archivo siempre arranca vacío porque cada sesión mintea un directorio
    /// nuevo, pero truncar sería destructivo si algo lo reabre.
    pub fn create(path: &Path) -> io::Result<Self> {
        let file = OpenOptions::new().create(true).append(true).open(path)?;
        Ok(Self {
            file: BufWriter::new(file),
            last_written_seq: 0,
            last_synced_seq: 0,
            dirty: false,
        })
    }

    /// Agrega un lote si `seq` es nuevo. Devuelve `true` si se escribió, `false` si era
    /// un duplicado (replay de un lote ya durable).
    ///
    /// Escribe con `write_all` (llega al SO) pero NO fsyncea — eso lo hace [`Self::sync`].
    pub fn append_batch(&mut self, seq: i64, items: &[Event]) -> io::Result<bool> {
        if seq <= self.last_written_seq {
            return Ok(false);
        }
        self.write_line(seq, items)?;
        self.last_written_seq = seq;
        Ok(true)
    }

    /// Agrega eventos generados por el propio servidor (el `mark` de nivel de mensaje,
    /// §04) que no tienen un `seq` de cliente asociado. Siempre se escribe, sin dedup
    /// — no participa del contrato de replay del outbox, así que no hay forma de que
    /// llegue duplicado por una reconexión.
    ///
    /// Deliberadamente no toca `last_written_seq`: si lo hiciera, un lote de cliente
    /// posterior con un `seq` real pero numéricamente menor quedaría descartado como
    /// falso duplicado.
    pub fn append_out_of_band(&mut self, items: &[Event]) -> io::Result<()> {
        // El `seq` de la línea es un placeholder — `read_events_ndjson` no lo usa para
        // nada, solo aplana `items`. Un valor negativo lo hace imposible de confundir
        // con un `seq` real de cliente si algo llegara a inspeccionar el archivo.
        self.write_line(-1, items)
    }

    fn write_line(&mut self, seq: i64, items: &[Event]) -> io::Result<()> {
        let line = RawEventBatch {
            seq,
            items: items.to_vec(),
        };
        serde_json::to_writer(&mut self.file, &line)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
        self.file.write_all(b"\n")?;
        self.dirty = true;
        Ok(())
    }

    /// Si hay datos escritos y no sincronizados, hace `flush` + `fsync`. Devuelve
    /// `Some(seq)` cuando ese fsync deja durable un `seq` de cliente nuevo — eso es lo
    /// único que hay que ackear; una escritura fuera de banda igual se fsyncea pero no
    /// produce un ack propio porque no tiene `seq` que confirmar.
    pub fn sync(&mut self) -> io::Result<Option<i64>> {
        if !self.dirty {
            return Ok(None);
        }
        self.file.flush()?;
        self.file.get_ref().sync_data()?;
        self.dirty = false;
        if self.last_synced_seq < self.last_written_seq {
            self.last_synced_seq = self.last_written_seq;
            return Ok(Some(self.last_synced_seq));
        }
        Ok(None)
    }

    pub fn last_written_seq(&self) -> i64 {
        self.last_written_seq
    }

    pub fn last_synced_seq(&self) -> i64 {
        self.last_synced_seq
    }
}

/// Apéndice crash-safe de PCM crudo (i16 little-endian, mono, 16 kHz).
///
/// Guarda las muestras en el orden de llegada de los frames binarios del WS. El
/// reordenamiento por `seq` (jitter buffer) es de B2 — acá el archivo es el respaldo
/// crudo, no la señal final.
pub struct RawAudioLog {
    file: BufWriter<File>,
    bytes_written: u64,
    bytes_synced: u64,
}

impl RawAudioLog {
    pub fn create(path: &Path) -> io::Result<Self> {
        let file = OpenOptions::new().create(true).append(true).open(path)?;
        Ok(Self {
            file: BufWriter::new(file),
            bytes_written: 0,
            bytes_synced: 0,
        })
    }

    /// Agrega muestras i16 como bytes little-endian.
    pub fn append_samples(&mut self, samples: &[i16]) -> io::Result<()> {
        for s in samples {
            self.file.write_all(&s.to_le_bytes())?;
        }
        self.bytes_written += (samples.len() * 2) as u64;
        Ok(())
    }

    /// Igual que [`RawEventLog::sync`] pero para el archivo de audio.
    pub fn sync(&mut self) -> io::Result<bool> {
        if self.bytes_synced >= self.bytes_written {
            return Ok(false);
        }
        self.file.flush()?;
        self.file.get_ref().sync_data()?;
        self.bytes_synced = self.bytes_written;
        Ok(true)
    }

    pub fn bytes_written(&self) -> u64 {
        self.bytes_written
    }
}

/// Lee `raw/events.ndjson` completo, tolerando una última línea partida (un `kill -9`
/// puede cortar a mitad de un `write_all` si el disco es lento, aunque en la práctica un
/// `sync_data` exitoso previo garantiza que todo lo acked está entero). Líneas
/// corruptas se descartan con un aviso por stderr en vez de abortar toda la
/// recuperación — es preferible perder la cola no confirmada a no recuperar nada.
pub fn read_events_ndjson(path: &Path) -> io::Result<Vec<Event>> {
    let raw = match std::fs::read_to_string(path) {
        Ok(s) => s,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e),
    };
    let mut events = Vec::new();
    for (i, line) in raw.lines().enumerate() {
        if line.trim().is_empty() {
            continue;
        }
        match serde_json::from_str::<RawEventBatch>(line) {
            Ok(batch) => events.extend(batch.items),
            Err(e) => {
                eprintln!(
                    "qua-core: raw/events.ndjson línea {} ilegible, se descarta ({e})",
                    i + 1
                );
            }
        }
    }
    Ok(events)
}

#[cfg(test)]
mod tests {
    use super::*;
    use qua_protocol::{Event, MarkSource};

    fn mark(t: i64) -> Event {
        Event::Mark {
            t,
            tab: None,
            source: MarkSource::Hotkey,
        }
    }

    #[test]
    fn escribe_y_relee_lotes() {
        let dir = tempfile::tempdir().expect("tmp");
        let path = dir.path().join("events.ndjson");
        let mut log = RawEventLog::create(&path).expect("create");

        assert!(log.append_batch(1, &[mark(10)]).expect("batch1"));
        assert!(log.append_batch(2, &[mark(20), mark(21)]).expect("batch2"));
        // Replay del mismo seq: se descarta, no duplica.
        assert!(!log.append_batch(2, &[mark(20), mark(21)]).expect("dup"));

        let synced = log
            .sync()
            .expect("sync")
            .expect("hubo algo que sincronizar");
        assert_eq!(synced, 2);
        assert_eq!(log.sync().expect("sync vacío"), None);

        let events = read_events_ndjson(&path).expect("read");
        assert_eq!(events.len(), 3);
    }

    #[test]
    fn tolera_una_linea_final_corrupta() {
        let dir = tempfile::tempdir().expect("tmp");
        let path = dir.path().join("events.ndjson");
        let mut log = RawEventLog::create(&path).expect("create");
        log.append_batch(1, &[mark(1)]).expect("batch");
        log.sync().expect("sync");
        // Simula una escritura cortada a mitad: se apenda basura sin salto de línea final coherente.
        use std::io::Write as _;
        let mut f = OpenOptions::new().append(true).open(&path).expect("reopen");
        write!(f, "{{\"seq\":2,\"items\":[").expect("garbage");

        let events = read_events_ndjson(&path).expect("read tolerante");
        assert_eq!(
            events.len(),
            1,
            "la línea buena se preserva, la rota se descarta"
        );
    }

    #[test]
    fn out_of_band_no_pisa_el_dedup_de_seq() {
        let dir = tempfile::tempdir().expect("tmp");
        let path = dir.path().join("events.ndjson");
        let mut log = RawEventLog::create(&path).expect("create");

        assert!(log.append_batch(5, &[mark(1)]).expect("batch seq 5"));
        // Un mark fuera de banda no debe tocar last_written_seq.
        log.append_out_of_band(&[mark(2)]).expect("out of band");
        assert_eq!(log.last_written_seq(), 5);
        // Un lote de cliente con seq menor a 5 pero que nunca se vio (imposible en la
        // práctica porque el cliente es monótono, pero el guard tiene que seguir
        // rechazándolo como duplicado, no confundirse por el out-of-band).
        assert!(!log.append_batch(3, &[mark(3)]).expect("seq viejo"));
        // Y uno nuevo de verdad sigue funcionando.
        assert!(log.append_batch(6, &[mark(4)]).expect("seq nuevo"));

        let synced = log.sync().expect("sync").expect("hay algo para ackear");
        assert_eq!(synced, 6);

        let events = read_events_ndjson(&path).expect("read");
        assert_eq!(
            events.len(),
            3,
            "batch5 + out_of_band + batch6, el seq viejo se descartó"
        );
    }

    #[test]
    fn audio_log_cuenta_bytes_y_sincroniza() {
        let dir = tempfile::tempdir().expect("tmp");
        let path = dir.path().join("audio.pcm");
        let mut log = RawAudioLog::create(&path).expect("create");
        log.append_samples(&[1, -1, 320]).expect("samples");
        assert_eq!(log.bytes_written(), 6);
        assert!(log.sync().expect("sync"));
        assert!(!log.sync().expect("sync vacío"));

        let bytes = std::fs::read(&path).expect("read");
        assert_eq!(bytes.len(), 6);
    }
}
