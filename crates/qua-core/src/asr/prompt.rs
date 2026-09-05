//! Priming del prompt de whisper (§06.1): vocabulario del usuario + continuidad con
//! la utterance anterior. Es, según la spec, "lo que más mueve la aguja en calidad de
//! transcripción con spanglish técnico".

use std::path::Path;

/// `vocab.txt` sembrado por defecto (§06.1), embebido en el binario para no depender
/// de que exista un asset externo en la instalación.
pub const DEFAULT_VOCAB: &str = include_str!("assets/vocab.txt");

/// Si `path` (normalmente `~/.qua/vocab.txt`) no existe todavía, lo crea con
/// [`DEFAULT_VOCAB`]. Devuelve el contenido vigente en cualquier caso.
pub fn ensure_vocab_seeded(path: &Path) -> std::io::Result<String> {
    match std::fs::read_to_string(path) {
        Ok(contents) => Ok(contents),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::write(path, DEFAULT_VOCAB)?;
            Ok(DEFAULT_VOCAB.to_string())
        }
        Err(err) => Err(err),
    }
}

/// `initial_prompt = vocab.txt + " " + últimos 200 chars de la utterance anterior`.
pub fn build_initial_prompt(vocab: &str, previous_utterance_text: Option<&str>) -> String {
    let vocab = vocab.trim();
    match previous_utterance_text.map(|t| last_n_chars(t, 200)) {
        Some(tail) if !tail.is_empty() => format!("{vocab} {tail}"),
        _ => vocab.to_string(),
    }
}

/// Los últimos `n` **caracteres** (no bytes: el español tiene tildes y `ñ`
/// multi-byte en UTF-8, cortar por bytes partiría un carácter a la mitad).
fn last_n_chars(s: &str, n: usize) -> &str {
    let char_count = s.chars().count();
    if char_count <= n {
        return s;
    }
    let skip = char_count - n;
    let byte_idx = s
        .char_indices()
        .nth(skip)
        .map(|(i, _)| i)
        .unwrap_or(s.len());
    &s[byte_idx..]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sin_utterance_anterior_el_prompt_es_solo_el_vocab() {
        let prompt = build_initial_prompt("Agendi, Supabase", None);
        assert_eq!(prompt, "Agendi, Supabase");
    }

    #[test]
    fn con_utterance_anterior_corta_apenas_los_ultimos_200_chars() {
        let previous = "a".repeat(250);
        let prompt = build_initial_prompt("vocab", Some(&previous));
        assert_eq!(prompt, format!("vocab {}", "a".repeat(200)));
    }

    #[test]
    fn corta_por_caracteres_no_por_bytes_con_tildes_y_enie() {
        // 205 caracteres, todos multi-byte en UTF-8 (ñ es 2 bytes).
        let previous: String = std::iter::repeat_n('ñ', 205).collect();
        let prompt = build_initial_prompt("vocab", Some(&previous));
        let tail = prompt.strip_prefix("vocab ").unwrap();
        assert_eq!(
            tail.chars().count(),
            200,
            "tiene que cortar en 200 chars, no bytes"
        );
        assert!(tail.chars().all(|c| c == 'ñ'));
    }

    #[test]
    fn utterance_anterior_corta_no_agrega_nada() {
        let prompt = build_initial_prompt("vocab", Some(""));
        assert_eq!(prompt, "vocab");
    }

    #[test]
    fn ensure_vocab_seeded_crea_el_archivo_si_no_existe() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested").join("vocab.txt");
        assert!(!path.exists());
        let contents = ensure_vocab_seeded(&path).unwrap();
        assert_eq!(contents, DEFAULT_VOCAB);
        assert!(path.exists());
        assert!(contents.contains("Agendi"));
        assert!(contents.contains("hover"));
    }

    #[test]
    fn ensure_vocab_seeded_no_pisa_un_vocab_ya_personalizado() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("vocab.txt");
        std::fs::write(&path, "MiPalabraCustom").unwrap();
        let contents = ensure_vocab_seeded(&path).unwrap();
        assert_eq!(contents, "MiPalabraCustom");
    }
}
