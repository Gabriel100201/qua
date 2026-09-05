//! Pairing (§04): ventana de 60 s, código de 6 dígitos, token de 32 bytes.
//!
//! La ventana la abre la app Tauri (C1) mostrando el código — acá solo está el estado
//! del lado del daemon: generarlo, guardar cuándo vence, y validarlo una sola vez
//! (`POST /pair` lo consume; un segundo intento con el mismo código ya vencido falla).

use std::time::{Duration, Instant};

use rand::RngCore;

/// Ventana de pairing de §04.
pub const PAIRING_WINDOW: Duration = Duration::from_secs(60);
/// 32 bytes → 64 caracteres hex, como en `fixtures/messages/http-pair-response.json`.
pub const TOKEN_BYTES: usize = 32;

#[derive(Debug, Clone)]
pub struct PairingWindow {
    pub code: String,
    opened_at: Instant,
}

impl PairingWindow {
    pub fn new(code: String) -> Self {
        Self {
            code,
            opened_at: Instant::now(),
        }
    }

    pub fn is_expired(&self) -> bool {
        self.opened_at.elapsed() > PAIRING_WINDOW
    }
}

/// Código de 6 dígitos, con ceros a la izquierda si hace falta.
pub fn generate_code() -> String {
    let n = rand::thread_rng().next_u32() % 1_000_000;
    format!("{n:06}")
}

/// Token de 32 bytes en hex (64 caracteres).
pub fn generate_token() -> String {
    let mut bytes = [0u8; TOKEN_BYTES];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// `Origin: chrome-extension://<id>` — es la única forma de origin que el pairing
/// acepta (§04, §05: la extensión es el único cliente legítimo).
pub fn is_valid_extension_origin(origin: &str) -> bool {
    origin.starts_with("chrome-extension://") && origin.len() > "chrome-extension://".len()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn el_codigo_tiene_siempre_6_digitos() {
        for _ in 0..50 {
            let code = generate_code();
            assert_eq!(code.len(), 6);
            assert!(code.chars().all(|c| c.is_ascii_digit()));
        }
    }

    #[test]
    fn el_token_es_32_bytes_en_hex() {
        let token = generate_token();
        assert_eq!(token.len(), TOKEN_BYTES * 2);
        assert!(token.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn valida_el_formato_de_origin() {
        assert!(is_valid_extension_origin("chrome-extension://abcdef"));
        assert!(!is_valid_extension_origin("https://evil.example"));
        assert!(!is_valid_extension_origin("chrome-extension://"));
    }
}
