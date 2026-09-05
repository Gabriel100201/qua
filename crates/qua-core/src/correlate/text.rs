//! Normalización de texto para los pasos 3 y 8 de §07.
//!
//! §07 paso 3 dice «sobre el texto en minúsculas y sin acentos». Acá vive esa
//! normalización, compartida con el paso 8 (ver `docs/DECISIONS.md`, D-B3-02).

/// Minúsculas y sin tildes. La `ñ` **no** se toca: en español es una letra propia,
/// no una vocal acentuada, y ninguna palabra de los patrones de §07 la usa.
pub fn normalize(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        for lc in c.to_lowercase() {
            out.push(match lc {
                'á' | 'à' | 'ä' | 'â' => 'a',
                'é' | 'è' | 'ë' | 'ê' => 'e',
                'í' | 'ì' | 'ï' | 'î' => 'i',
                'ó' | 'ò' | 'ö' | 'ô' => 'o',
                'ú' | 'ù' | 'ü' | 'û' => 'u',
                other => other,
            });
        }
    }
    out
}

/// Cuenta palabras separando por espacios en blanco y descartando lo que no tenga
/// ningún carácter alfanumérico (comas y puntos sueltos no son palabras).
pub fn word_count(s: &str) -> usize {
    s.split_whitespace()
        .filter(|w| w.chars().any(char::is_alphanumeric))
        .count()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normaliza_a_minusculas_sin_tildes() {
        assert_eq!(normalize("Está ACÁ, el Botón"), "esta aca, el boton");
        assert_eq!(normalize("REDACCIÓN · Título"), "redaccion · titulo");
    }

    #[test]
    fn la_enie_sobrevive() {
        assert_eq!(normalize("Año"), "año");
    }

    #[test]
    fn cuenta_palabras_ignorando_puntuacion_suelta() {
        assert_eq!(word_count("  eh , ,  "), 1);
        assert_eq!(word_count("este botón es muy chico"), 5);
        assert_eq!(word_count(""), 0);
    }
}
