//! Jitter buffer: reordena frames de audio por `seq` dentro de una ventana de tiempo
//! (§06.1: "jitter buffer (reordena por seq, ventana 200 ms)").
//!
//! UDP no existe acá (es WebSocket sobre TCP), pero el envío desde el offscreen doc es
//! por lotes con reintentos y reconexión (§04), así que un frame puede llegar fuera de
//! orden o repetido. El jitter buffer absorbe eso: bufferea por `seq`, entrega en orden,
//! y si un hueco no se llena dentro de la ventana lo da por perdido y sigue — más vale
//! un `audio_gap` chico que congelar el pipeline esperando un frame que nunca va a llegar.

use std::collections::BTreeMap;

use qua_protocol::audio_frame::AudioFrame;

/// Bufferea [`AudioFrame`]s por `seq` y los entrega en orden dentro de una ventana de
/// `window_ms`, medida sobre `t_ms` (el reloj de sesión que llevan los propios frames).
pub struct JitterBuffer {
    window_ms: u64,
    next_seq: Option<u32>,
    pending: BTreeMap<u32, AudioFrame>,
    max_t_ms_seen: u64,
}

impl JitterBuffer {
    pub fn new(window_ms: u64) -> Self {
        Self {
            window_ms,
            next_seq: None,
            pending: BTreeMap::new(),
            max_t_ms_seen: 0,
        }
    }

    /// Empuja un frame recién llegado. Devuelve los frames que ya se pueden entregar
    /// en orden — puede ser cero, uno, o varios si un lote llenó un hueco.
    pub fn push(&mut self, frame: AudioFrame) -> Vec<AudioFrame> {
        self.max_t_ms_seen = self.max_t_ms_seen.max(frame.t_ms);

        let next_seq = *self.next_seq.get_or_insert(frame.seq);

        // Frame repetido o más viejo que el próximo a entregar: se descarta.
        if frame.seq < next_seq {
            return Vec::new();
        }
        self.pending.insert(frame.seq, frame);

        self.drain_ready()
    }

    /// Fuerza el drenaje del buffer (fin de sesión: no tiene sentido seguir esperando
    /// frames que ya no van a llegar).
    pub fn flush(&mut self) -> Vec<AudioFrame> {
        let mut out = Vec::new();
        while let Some((&seq, _)) = self.pending.iter().next() {
            self.next_seq = Some(seq);
            out.extend(self.drain_ready());
        }
        out
    }

    fn drain_ready(&mut self) -> Vec<AudioFrame> {
        let mut out = Vec::new();
        while let Some(next_seq) = self.next_seq {
            if let Some(frame) = self.pending.remove(&next_seq) {
                out.push(frame);
                self.next_seq = Some(next_seq.wrapping_add(1));
                continue;
            }

            // El próximo seq esperado no llegó. Si el frame más viejo bufferizado ya
            // superó la ventana de tolerancia, se da por perdido: saltamos a él.
            if let Some((&oldest_seq, oldest)) = self.pending.iter().next() {
                let waited = self.max_t_ms_seen.saturating_sub(oldest.t_ms);
                if waited >= self.window_ms {
                    self.next_seq = Some(oldest_seq);
                    continue;
                }
            }
            break;
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(seq: u32, t_ms: u64) -> AudioFrame {
        AudioFrame {
            seq,
            t_ms,
            samples: vec![seq as i16; 320],
        }
    }

    #[test]
    fn entrega_en_orden_cuando_llegan_en_orden() {
        let mut jb = JitterBuffer::new(200);
        let mut out = Vec::new();
        for seq in 0..5u32 {
            out.extend(jb.push(frame(seq, seq as u64 * 20)));
        }
        let seqs: Vec<u32> = out.iter().map(|f| f.seq).collect();
        assert_eq!(seqs, vec![0, 1, 2, 3, 4]);
    }

    #[test]
    fn reordena_dentro_de_la_ventana() {
        let mut jb = JitterBuffer::new(200);
        let mut out = Vec::new();
        // llegan 0, 2, 1, 3 — el 2 se buferiza hasta que llega el 1
        out.extend(jb.push(frame(0, 0)));
        out.extend(jb.push(frame(2, 40)));
        assert!(out.iter().all(|f| f.seq != 2), "el 2 no se entrega todavía");
        out.extend(jb.push(frame(1, 20)));
        out.extend(jb.push(frame(3, 60)));

        let seqs: Vec<u32> = out.iter().map(|f| f.seq).collect();
        assert_eq!(seqs, vec![0, 1, 2, 3]);
    }

    #[test]
    fn descarta_un_frame_repetido() {
        let mut jb = JitterBuffer::new(200);
        let mut out = Vec::new();
        out.extend(jb.push(frame(0, 0)));
        out.extend(jb.push(frame(1, 20)));
        out.extend(jb.push(frame(0, 0))); // repetido, ya entregado
        let seqs: Vec<u32> = out.iter().map(|f| f.seq).collect();
        assert_eq!(seqs, vec![0, 1]);
    }

    #[test]
    fn un_hueco_que_supera_la_ventana_se_da_por_perdido() {
        let mut jb = JitterBuffer::new(200);
        let mut out = Vec::new();
        out.extend(jb.push(frame(0, 0)));
        // el seq 1 nunca llega. El seq 2 arriba con t_ms tan lejos que la ventana
        // de 200 ms ya venció para el hueco.
        out.extend(jb.push(frame(2, 40)));
        out.extend(jb.push(frame(3, 260))); // 260ms - 40ms = 220ms > 200ms de ventana

        let seqs: Vec<u32> = out.iter().map(|f| f.seq).collect();
        assert_eq!(
            seqs,
            vec![0, 2, 3],
            "el hueco del seq 1 se saltea tras la ventana"
        );
    }

    #[test]
    fn flush_entrega_todo_lo_bufferizado_sin_esperar_la_ventana() {
        let mut jb = JitterBuffer::new(200);
        jb.push(frame(0, 0));
        jb.push(frame(2, 40)); // hueco en el 1, todavía dentro de ventana
        let out = jb.flush();
        let seqs: Vec<u32> = out.iter().map(|f| f.seq).collect();
        assert_eq!(seqs, vec![2]);
    }
}
