//! Constantes compartidas. Espejo de `packages/protocol/src/constants.ts`.

/// Versión del protocolo de mensajes de §04.
pub const PROTOCOL_VERSION: u8 = 1;

/// Puerto del daemon `quad`.
pub const DEFAULT_DAEMON_PORT: u16 = 7331;

/// Host al que bindea el daemon. Nunca 0.0.0.0: cero egreso de red (§12).
pub const DAEMON_HOST: &str = "127.0.0.1";

pub const WS_PATH: &str = "/ws";
pub const PAIR_PATH: &str = "/pair";
pub const HEALTH_PATH: &str = "/health";

/// Identificador de esquema que viaja en `Session::schema`.
pub const SCHEMA_SESSION: &str = "qua/session@1";

pub const AUDIO_SAMPLE_RATE: u32 = 16_000;
pub const AUDIO_CHANNELS: u16 = 1;

/// Layout del frame binario de audio (§04).
///
/// ```text
/// offset  0   u8       magic = 0xA0
/// offset  1   u32le    seq
/// offset  5   u64le    t_ms          // desde t0_wall
/// offset 13   i16le[320]             // 20 ms @ 16 kHz mono = 640 bytes
///                                    // total 653 B/frame · 50 fps · ~32 KB/s
/// ```
pub mod audio_frame {
    pub const MAGIC: u8 = 0xA0;

    pub const OFFSET_MAGIC: usize = 0;
    pub const OFFSET_SEQ: usize = 1;
    pub const OFFSET_T_MS: usize = 5;
    pub const OFFSET_SAMPLES: usize = 13;

    pub const HEADER_BYTES: usize = 13;
    pub const SAMPLES_PER_FRAME: usize = 320;
    pub const BYTES_PER_SAMPLE: usize = 2;
    pub const PAYLOAD_BYTES: usize = SAMPLES_PER_FRAME * BYTES_PER_SAMPLE;
    pub const TOTAL_BYTES: usize = HEADER_BYTES + PAYLOAD_BYTES;

    pub const FRAME_MS: u64 = 20;
    pub const FRAMES_PER_SECOND: u32 = 50;

    const _: () = assert!(TOTAL_BYTES == 653);
}

/// Los 18 discriminantes de `Event`, en el orden de la tabla de §03.
///
/// La prosa de la spec dice «17 tipos» pero la tabla lista 18. Ver `docs/DECISIONS.md` (D-01).
pub const EVENT_KINDS: [&str; 18] = [
    "nav",
    "tab_switch",
    "tab_close",
    "click",
    "hover",
    "focus_change",
    "input",
    "submit",
    "scroll_settle",
    "viewport",
    "console",
    "net_fail",
    "net_slow",
    "long_task",
    "layout_shift",
    "mutation_burst",
    "mark",
    "audio_gap",
];

pub const ANCHOR_KINDS: [&str; 3] = ["element", "route", "session"];

/// Umbral bajo el cual un issue cae en la sección «Sin anclar» del reporte (§8.1).
pub const UNANCHORED_CONFIDENCE: f64 = 0.35;

/// Texto con el que se reemplaza el contenido de un subárbol redactado (§12).
pub const REDACTED: &str = "[redactado]";

/// URL del WebSocket para un token y un puerto dados.
pub fn ws_url(token: &str, port: u16) -> String {
    format!("ws://{DAEMON_HOST}:{port}{WS_PATH}?token={token}")
}
