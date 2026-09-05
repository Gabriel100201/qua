//! §07 paso 3 — clasificación de deixis en español.
//!
//! | Clase | Efecto |
//! |---|---|
//! | POINTER | prefiere hover y click, peso ×1.5 |
//! | ACTION  | prefiere el click anterior, peso ×2, adjunta timings |
//! | SCREEN  | `anchor.kind = "route"` |
//! | GLOBAL  | `anchor.kind = "session"` |
//!
//! Los patrones de la spec son alternancias de literales sin `\b`. Acá se aplican con
//! frontera de palabra: sin eso `eso` matchea dentro de «peso» y `esa` dentro de «mesa»,
//! y todo texto quedaría clasificado POINTER. Ver `docs/DECISIONS.md`, D-B3-03.

use std::sync::LazyLock;

use regex::Regex;

use super::text::normalize;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Deixis {
    Pointer,
    Action,
    Screen,
    Global,
    /// Ningún patrón matcheó: sin sesgo, el scoring decide solo.
    None,
}

impl Deixis {
    pub fn as_str(self) -> &'static str {
        match self {
            Deixis::Pointer => "pointer",
            Deixis::Action => "action",
            Deixis::Screen => "screen",
            Deixis::Global => "global",
            Deixis::None => "none",
        }
    }
}

/// Resultado del paso 3: la clase que manda y el literal que la disparó, que va al
/// `reason[]` del ancla como `deixis:este` (§07 paso 6).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeixisMatch {
    pub class: Deixis,
    /// El texto exacto que matcheó, normalizado. `None` si no matcheó nada.
    pub literal: Option<String>,
}

impl DeixisMatch {
    fn none() -> Self {
        Self {
            class: Deixis::None,
            literal: None,
        }
    }

    /// `"deixis:este"` para el `reason[]`.
    pub fn reason(&self) -> Option<String> {
        self.literal.as_ref().map(|l| format!("deixis:{l}"))
    }
}

macro_rules! pat {
    ($name:ident, $re:expr) => {
        static $name: LazyLock<Regex> =
            LazyLock::new(|| Regex::new($re).expect("patrón de deixis de §07 inválido"));
    };
}

// Los patrones de la tabla de §07, ya normalizados (sin tildes) y con frontera.
pat!(
    POINTER,
    r"\b(este icono|este campo|el boton|este|esta|esto|ese|esa|eso|aca|aqui|ahi)\b"
);
pat!(
    ACTION,
    r"\b(cuando (?:le doy|hago clic|clickeo|toco|aprieto)|al (?:entrar|abrir|guardar))\b"
);
pat!(
    SCREEN,
    r"\b(esta pantalla|esta pagina|esta vista|esta seccion|el layout|el header|el sidebar)\b"
);
pat!(GLOBAL, r"\b(en general|en toda la app|en todos lados|siempre que)\b");

/// Clasifica el texto de un grupo de utterances.
///
/// Precedencia **GLOBAL > SCREEN > ACTION > POINTER**: las dos primeras deciden el
/// `anchor.kind` por sí solas, así que ganarle a un `este` suelto que aparezca en la
/// misma frase es la regla de oro de §07 paso 6 aplicada al paso 3. Entre ACTION y
/// POINTER gana la más específica. Ver `docs/DECISIONS.md`, D-B3-03.
pub fn classify(text: &str) -> DeixisMatch {
    let n = normalize(text);
    for (class, re) in [
        (Deixis::Global, &*GLOBAL),
        (Deixis::Screen, &*SCREEN),
        (Deixis::Action, &*ACTION),
        (Deixis::Pointer, &*POINTER),
    ] {
        if let Some(m) = re.find(&n) {
            return DeixisMatch {
                class,
                literal: Some(m.as_str().to_string()),
            };
        }
    }
    DeixisMatch::none()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn clase(t: &str) -> Deixis {
        classify(t).class
    }

    #[test]
    fn pointer_con_los_demostrativos_de_la_tabla() {
        for t in [
            "este botón es muy chico",
            "esta cosa no me gusta",
            "esto está raro",
            "ese ícono es feo",
            "esa lista tarda",
            "eso no se entiende",
            "acá falta un espacio",
            "aquí no se ve",
            "ahí se rompe",
            "el botón es chico",
            "este campo pide mucho",
            "este ícono no se entiende",
        ] {
            assert_eq!(clase(t), Deixis::Pointer, "{t}");
        }
    }

    #[test]
    fn action_con_las_dos_formas() {
        for t in [
            "cuando le doy se cuelga",
            "cuando hago clic no pasa nada",
            "cuando clickeo tarda",
            "cuando toco el botón se rompe",
            "cuando aprieto guardar falla",
            "al entrar tarda un montón",
            "al abrir el modal se cuelga",
            "al guardar tira error",
        ] {
            assert_eq!(clase(t), Deixis::Action, "{t}");
        }
    }

    #[test]
    fn screen_y_global() {
        for t in [
            "esta pantalla necesita un título más claro",
            "esta página carga lento",
            "esta vista está desordenada",
            "esta sección sobra",
            "el layout se rompe",
            "el header es muy alto",
            "el sidebar molesta",
        ] {
            assert_eq!(clase(t), Deixis::Screen, "{t}");
        }
        for t in [
            "en general la app se ve mal",
            "en toda la app falta contraste",
            "en todos lados pasa lo mismo",
            "siempre que guardo tarda",
        ] {
            assert_eq!(clase(t), Deixis::Global, "{t}");
        }
    }

    /// La razón de la precedencia: `esta pantalla` contiene `esta`.
    #[test]
    fn screen_le_gana_a_pointer() {
        assert_eq!(clase("esta pantalla tiene este botón chico"), Deixis::Screen);
    }

    #[test]
    fn global_le_gana_a_todo() {
        assert_eq!(
            clase("en general cuando le doy a este botón se cuelga"),
            Deixis::Global
        );
    }

    #[test]
    fn action_le_gana_a_pointer() {
        assert_eq!(clase("cuando le doy a este botón se cuelga"), Deixis::Action);
    }

    /// Sin frontera de palabra, «peso» sería POINTER y «indice» sería copy.
    #[test]
    fn no_matchea_dentro_de_otra_palabra() {
        assert_eq!(clase("el peso de la mesa es una tontera"), Deixis::None);
        assert_eq!(clase("nada que ver"), Deixis::None);
    }

    #[test]
    fn funciona_con_y_sin_tildes() {
        assert_eq!(clase("ACÁ falta algo"), Deixis::Pointer);
        assert_eq!(clase("aca falta algo"), Deixis::Pointer);
        assert_eq!(classify("Este botón").literal.as_deref(), Some("este"));
    }

    #[test]
    fn el_literal_va_al_reason() {
        assert_eq!(
            classify("este botón es chico").reason().as_deref(),
            Some("deixis:este")
        );
        assert_eq!(classify("nada").reason(), None);
    }
}
