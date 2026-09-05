//! Codec del frame binario de audio (§04).
//!
//! Espejo de `packages/protocol/src/audio-frame.ts`. `fixtures/audio-frame.bin` es
//! el frame dorado que los dos lados tienen que decodificar igual.

use crate::constants::audio_frame as layout;

/// Un frame binario de audio ya decodificado.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AudioFrame {
    pub seq: u32,
    /// ms desde `t0_wall`.
    pub t_ms: u64,
    /// Exactamente `SAMPLES_PER_FRAME` muestras.
    pub samples: Vec<i16>,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum AudioFrameError {
    #[error("se esperaban {expected} bytes, llegaron {got}")]
    BadLength { expected: usize, got: usize },
    #[error("magic inesperado: 0x{got:02x} (se esperaba 0x{expected:02x})")]
    BadMagic { expected: u8, got: u8 },
    #[error("se esperaban {expected} muestras, llegaron {got}")]
    BadSampleCount { expected: usize, got: usize },
}

impl AudioFrame {
    /// Escribe el frame con el layout de §04.
    pub fn encode(&self) -> Result<Vec<u8>, AudioFrameError> {
        if self.samples.len() != layout::SAMPLES_PER_FRAME {
            return Err(AudioFrameError::BadSampleCount {
                expected: layout::SAMPLES_PER_FRAME,
                got: self.samples.len(),
            });
        }
        let mut out = Vec::with_capacity(layout::TOTAL_BYTES);
        out.push(layout::MAGIC);
        out.extend_from_slice(&self.seq.to_le_bytes());
        out.extend_from_slice(&self.t_ms.to_le_bytes());
        for sample in &self.samples {
            out.extend_from_slice(&sample.to_le_bytes());
        }
        debug_assert_eq!(out.len(), layout::TOTAL_BYTES);
        Ok(out)
    }

    /// Lee un frame. Falla si el magic o el tamaño no cierran.
    pub fn decode(bytes: &[u8]) -> Result<Self, AudioFrameError> {
        if bytes.len() != layout::TOTAL_BYTES {
            return Err(AudioFrameError::BadLength {
                expected: layout::TOTAL_BYTES,
                got: bytes.len(),
            });
        }
        let magic = bytes[layout::OFFSET_MAGIC];
        if magic != layout::MAGIC {
            return Err(AudioFrameError::BadMagic {
                expected: layout::MAGIC,
                got: magic,
            });
        }
        let seq = u32::from_le_bytes(
            bytes[layout::OFFSET_SEQ..layout::OFFSET_SEQ + 4]
                .try_into()
                .expect("4 bytes"),
        );
        let t_ms = u64::from_le_bytes(
            bytes[layout::OFFSET_T_MS..layout::OFFSET_T_MS + 8]
                .try_into()
                .expect("8 bytes"),
        );
        let samples = bytes[layout::OFFSET_SAMPLES..]
            .chunks_exact(layout::BYTES_PER_SAMPLE)
            .map(|c| i16::from_le_bytes([c[0], c[1]]))
            .collect();
        Ok(AudioFrame { seq, t_ms, samples })
    }
}

/// `true` si el buffer arranca con el magic de audio. Barato: no parsea nada más.
pub fn is_audio_frame(bytes: &[u8]) -> bool {
    bytes.first() == Some(&layout::MAGIC)
}
