use std::sync::atomic::{AtomicU32, AtomicU8, Ordering};
use std::sync::Mutex;
use std::time::Instant;

/// FSM de tray de §09: idle · grabando · procesando. Es un reflejo local para la UI
/// (tray + hotkeys) — la fuente de verdad de si hay sesión activa es el `session` de
/// `GET /health`, que sondeamos cada 5 s (§09) y usamos para corregir este estado si
/// se desincroniza (p.ej. la extensión arrancó/paró la sesión desde el popup).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum RecState {
    Idle = 0,
    Recording = 1,
    Processing = 2,
}

impl RecState {
    fn from_u8(v: u8) -> Self {
        match v {
            1 => RecState::Recording,
            2 => RecState::Processing,
            _ => RecState::Idle,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            RecState::Idle => "idle",
            RecState::Recording => "● grabando",
            RecState::Processing => "procesando…",
        }
    }
}

pub struct AppState {
    pub http: reqwest::Client,
    rec_state: AtomicU8,
    pub recording_since: Mutex<Option<Instant>>,
    /// Nivel de mic 0..=1000 (milésimos) para no lidiar con floats atómicos.
    mic_level_milli: AtomicU32,
    pub selected_input_device: Mutex<Option<String>>,
    pub sidecar_restarts: AtomicU32,
    pub last_health_ok: Mutex<bool>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(3))
                .build()
                .expect("cliente http"),
            rec_state: AtomicU8::new(RecState::Idle as u8),
            recording_since: Mutex::new(None),
            mic_level_milli: AtomicU32::new(0),
            selected_input_device: Mutex::new(None),
            sidecar_restarts: AtomicU32::new(0),
            last_health_ok: Mutex::new(false),
        }
    }
}

impl AppState {
    pub fn rec_state(&self) -> RecState {
        RecState::from_u8(self.rec_state.load(Ordering::Relaxed))
    }

    pub fn set_rec_state(&self, s: RecState) {
        self.rec_state.store(s as u8, Ordering::Relaxed);
        if s == RecState::Recording {
            *self.recording_since.lock().unwrap() = Some(Instant::now());
        } else if s == RecState::Idle {
            *self.recording_since.lock().unwrap() = None;
        }
    }

    pub fn mic_level(&self) -> f32 {
        self.mic_level_milli.load(Ordering::Relaxed) as f32 / 1000.0
    }

    pub fn set_mic_level(&self, level: f32) {
        let clamped = level.clamp(0.0, 1.0);
        self.mic_level_milli
            .store((clamped * 1000.0) as u32, Ordering::Relaxed);
    }

    pub fn duration_label(&self) -> Option<String> {
        let since = (*self.recording_since.lock().unwrap())?;
        let secs = since.elapsed().as_secs();
        Some(format!("{:02}:{:02}", secs / 60, secs % 60))
    }
}
