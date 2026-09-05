//! Ring buffer de audio: f32, 16 kHz, 60 s (§06.1).
//!
//! Guarda las muestras ya decodificadas del jitter buffer, en punto flotante
//! normalizado a `[-1.0, 1.0]` — el formato que espera whisper. La capacidad fija
//! acota la memoria del daemon sin importar cuánto dure la sesión: cuando se llena,
//! pisa lo más viejo. 60 s alcanza de sobra para un segmento (corte forzado a 25 s
//! más el padding del VAD), así que mientras el pipeline lea cada segmento antes de
//! que el ring le dé la vuelta, nunca pierde datos que todavía necesita.

pub const SAMPLE_RATE_HZ: usize = 16_000;

/// Normaliza una muestra PCM `i16` (el formato del frame binario de §04) a f32 en
/// `[-1.0, 1.0]`. Se divide por 32768 (no por `i16::MAX` = 32767) para que
/// `i16::MIN` mapee exacto a `-1.0` en vez de desbordar apenas por debajo.
pub fn i16_to_f32(sample: i16) -> f32 {
    sample as f32 / 32768.0
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum RingBufferError {
    #[error("el rango pedido [{start}, {end}) ya fue sobrescrito por el ring buffer")]
    Overwritten { start: u64, end: u64 },
    #[error("rango inválido: start {start} >= end {end}")]
    EmptyRange { start: u64, end: u64 },
}

/// Buffer circular de muestras f32, direccionado por índice absoluto (nunca se
/// reinicia, aunque el almacenamiento físico sí da la vuelta).
pub struct RingBuffer {
    capacity: usize,
    storage: Vec<f32>,
    /// Total de muestras escritas desde el arranque de la sesión.
    total_written: u64,
}

impl RingBuffer {
    pub fn with_seconds(seconds: u32) -> Self {
        Self::with_capacity(SAMPLE_RATE_HZ * seconds as usize)
    }

    pub fn with_capacity(capacity: usize) -> Self {
        assert!(capacity > 0, "el ring buffer necesita capacidad > 0");
        Self {
            capacity,
            storage: vec![0.0; capacity],
            total_written: 0,
        }
    }

    pub fn capacity(&self) -> usize {
        self.capacity
    }

    /// Índice absoluto (exclusivo) de la próxima muestra a escribir.
    pub fn write_head(&self) -> u64 {
        self.total_written
    }

    /// Convierte `i16` PCM (el formato del frame binario de §04) a f32 normalizado
    /// y lo empuja al ring.
    pub fn push_i16(&mut self, samples: &[i16]) {
        for &s in samples {
            self.push_sample(i16_to_f32(s));
        }
    }

    pub fn push_sample(&mut self, sample: f32) {
        let idx = (self.total_written as usize) % self.capacity;
        self.storage[idx] = sample;
        self.total_written += 1;
    }

    /// Más vieja muestra todavía viva en el ring (índice absoluto, inclusive).
    fn oldest_valid_index(&self) -> u64 {
        self.total_written.saturating_sub(self.capacity as u64)
    }

    /// Lee `[start, end)` en índices absolutos. Falla si alguna muestra de ese
    /// rango ya fue pisada o si el rango todavía no se escribió del todo.
    pub fn read_range(&self, start: u64, end: u64) -> Result<Vec<f32>, RingBufferError> {
        if start >= end {
            return Err(RingBufferError::EmptyRange { start, end });
        }
        if start < self.oldest_valid_index() || end > self.total_written {
            return Err(RingBufferError::Overwritten { start, end });
        }
        let mut out = Vec::with_capacity((end - start) as usize);
        for abs in start..end {
            out.push(self.storage[(abs as usize) % self.capacity]);
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escribe_y_lee_un_rango_simple() {
        let mut ring = RingBuffer::with_capacity(10);
        for i in 0..5 {
            ring.push_sample(i as f32);
        }
        assert_eq!(
            ring.read_range(0, 5).unwrap(),
            vec![0.0, 1.0, 2.0, 3.0, 4.0]
        );
    }

    #[test]
    fn i16_se_normaliza_a_menos_uno_uno() {
        let mut ring = RingBuffer::with_capacity(4);
        ring.push_i16(&[i16::MAX, i16::MIN, 0]);
        let out = ring.read_range(0, 3).unwrap();
        assert!((out[0] - 1.0).abs() < 1e-3, "i16::MAX casi 1.0: {}", out[0]);
        assert_eq!(out[1], -1.0, "i16::MIN mapea exacto a -1.0");
        assert_eq!(out[2], 0.0);
    }

    #[test]
    fn pisa_lo_mas_viejo_al_dar_la_vuelta() {
        let mut ring = RingBuffer::with_capacity(4);
        for i in 0..10 {
            ring.push_sample(i as f32);
        }
        // quedan vivas las últimas 4: [6,7,8,9]
        assert_eq!(ring.read_range(6, 10).unwrap(), vec![6.0, 7.0, 8.0, 9.0]);
        assert_eq!(
            ring.read_range(0, 4),
            Err(RingBufferError::Overwritten { start: 0, end: 4 })
        );
    }

    #[test]
    fn sesenta_segundos_a_16khz_es_la_capacidad_de_la_spec() {
        let ring = RingBuffer::with_seconds(60);
        assert_eq!(ring.capacity(), 960_000);
    }
}
