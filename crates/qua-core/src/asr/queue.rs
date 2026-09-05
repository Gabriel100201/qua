//! Cola acotada entre el VAD y el worker de whisper (§06.1: "cola acotada (cap 8)
//! → 1 worker whisper").
//!
//! A ~20× tiempo real en Apple Silicon la cola nunca se llena (DECISIÓN de §06.1),
//! así que el límite es una red de seguridad, no el camino esperado: cuando se llena,
//! el productor (el VAD cerrando segmentos) se bloquea en vez de tirar audio, porque
//! perder una utterance entera es peor que una pausa momentánea del pipeline.

use std::sync::mpsc::{sync_channel, Receiver, SyncSender};

/// Un segmento de audio ya cerrado por el VAD, listo para transcribirse.
#[derive(Debug)]
pub struct PendingSegment {
    pub samples: Vec<f32>,
    /// Offset en ms del arranque del segmento dentro del reloj de la sesión.
    pub t_offset_ms: i64,
}

/// Crea el par productor/consumidor de la cola de §06.1. `cap` viene de
/// `AsrConfig::queue_cap`, nunca hardcodeado en el call site.
pub fn bounded_segment_queue(cap: usize) -> (SyncSender<PendingSegment>, Receiver<PendingSegment>) {
    sync_channel(cap)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::TrySendError;

    fn segment(offset: i64) -> PendingSegment {
        PendingSegment {
            samples: vec![0.0; 4],
            t_offset_ms: offset,
        }
    }

    #[test]
    fn la_cola_acepta_hasta_la_capacidad_configurada_y_despues_se_llena() {
        let (tx, rx) = bounded_segment_queue(8);
        for i in 0..8 {
            tx.try_send(segment(i))
                .expect("hay lugar hasta la capacidad");
        }
        match tx.try_send(segment(999)) {
            Err(TrySendError::Full(seg)) => assert_eq!(seg.t_offset_ms, 999),
            other => panic!("se esperaba Full, se obtuvo {other:?}"),
        }

        // Al consumir uno, se libera espacio para el siguiente.
        let first = rx.recv().expect("hay al menos un elemento");
        assert_eq!(first.t_offset_ms, 0);
        tx.try_send(segment(8))
            .expect("hay lugar tras consumir uno");
    }

    #[test]
    fn entrega_en_orden_fifo() {
        let (tx, rx) = bounded_segment_queue(8);
        for i in 0..3 {
            tx.send(segment(i)).unwrap();
        }
        drop(tx);
        let offsets: Vec<i64> = rx.iter().map(|s| s.t_offset_ms).collect();
        assert_eq!(offsets, vec![0, 1, 2]);
    }
}
