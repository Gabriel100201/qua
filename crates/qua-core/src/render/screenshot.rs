//! Recorte de capturas (§07 paso 9): "recorta al rect del target con 24 px de padding,
//! y guarda el recorte más un contexto de 640 px de ancho en `assets/<issue>.png`".
//!
//! [`crop_for_target`] es la función pura (testeable sin tocar disco ni WS). El plano
//! de captura en vivo — pedir `capture.request` a la extensión y guardar el frame
//! crudo — no lo implementa B4 (nadie lo pidió todavía: B1 lo recibe y lo descarta,
//! ver `crates/quad/src/ws.rs`). [`render_screenshots`] deja la convención de dónde
//! B4 espera encontrar ese frame una vez que alguien lo cablee: ver D-B4-05 en
//! `docs/DECISIONS.md`.

use std::path::{Path, PathBuf};

use image::DynamicImage;
use qua_protocol::{AnchorKind, Rect, Session};

use super::RenderError;

/// Padding alrededor del rect del target, en píxeles CSS (mismo espacio que `Rect`).
pub const TARGET_PADDING_PX: f64 = 24.0;
/// Ancho mínimo del recorte final, en píxeles CSS — el "contexto" de §07 paso 9.
pub const CONTEXT_WIDTH_PX: f64 = 640.0;

/// Recorta `img` al rect del target con `TARGET_PADDING_PX` de padding, después lo
/// ensancha (centrado, sin estirar el alto) hasta `CONTEXT_WIDTH_PX` si el resultado
/// quedó más angosto que eso. `dpr` escala de píxeles CSS (los de `Rect`) a píxeles de
/// imagen — un frame retina a 2x necesita el doble de píxeles para el mismo rect.
///
/// Clampea contra los bordes de `img`: un target pegado a un borde no hace que el
/// recorte se salga de la imagen, solo pierde contexto de ese lado.
pub fn crop_for_target(img: &DynamicImage, rect: &Rect, dpr: f64) -> DynamicImage {
    let dpr = if dpr > 0.0 { dpr } else { 1.0 };
    let img_w = img.width() as f64;
    let img_h = img.height() as f64;

    let pad = TARGET_PADDING_PX * dpr;
    let (rx, ry, rw, rh) = (rect.x * dpr, rect.y * dpr, rect.w * dpr, rect.h * dpr);

    let mut x0 = rx - pad;
    let mut y0 = ry - pad;
    let mut x1 = rx + rw + pad;
    let y1 = ry + rh + pad;

    let context_w = CONTEXT_WIDTH_PX * dpr;
    if x1 - x0 < context_w {
        let cx = (x0 + x1) / 2.0;
        x0 = cx - context_w / 2.0;
        x1 = cx + context_w / 2.0;
    }

    // Clamp contra los bordes reales de la imagen.
    x0 = x0.max(0.0).min(img_w);
    y0 = y0.max(0.0).min(img_h);
    x1 = x1.max(x0).min(img_w);
    let y1 = y1.max(y0).min(img_h);

    let (x0, y0) = (x0.round() as u32, y0.round() as u32);
    let w = ((x1 - x0 as f64).round() as u32)
        .max(1)
        .min(img.width() - x0);
    let h = ((y1 - y0 as f64).round() as u32)
        .max(1)
        .min(img.height() - y0);

    img.crop_imm(x0, y0, w, h)
}

/// Nombre de archivo bajo `raw/frames/` donde `render_screenshots` busca el frame
/// crudo de un issue, antes de convertirlo (D-B4-05). Soporta jpg/jpeg/png porque
/// `ClientMessage::Frame` manda JPEG (§04) pero un test o una herramienta externa
/// puede dejar un PNG a mano.
fn find_raw_frame(session_dir: &Path, issue_id: &str) -> Option<PathBuf> {
    for ext in ["jpg", "jpeg", "png"] {
        let path = session_dir
            .join("raw/frames")
            .join(format!("{issue_id}.{ext}"));
        if path.exists() {
            return Some(path);
        }
    }
    None
}

/// Recorta y guarda `assets/<id>.png` para cada issue de tipo `element` con
/// `confidence >= 0.5` (§07 paso 9) que tenga un frame crudo disponible. Los que no
/// tienen frame (el caso común hoy: nada todavía pide `capture.request`) se saltean en
/// silencio — no es un error, es trabajo pendiente de una tarea futura de captura.
pub fn render_screenshots(
    session: &Session,
    session_dir: &Path,
) -> Result<Vec<PathBuf>, RenderError> {
    const SCREENSHOT_MIN_CONFIDENCE: f64 = 0.5;

    let mut written = Vec::new();
    for issue in &session.issues {
        if issue.anchor.kind != AnchorKind::Element {
            continue;
        }
        if issue.anchor.confidence < SCREENSHOT_MIN_CONFIDENCE {
            continue;
        }
        let Some(target) = &issue.anchor.target else {
            continue;
        };
        let Some(rect) = &target.rect else { continue };
        let Some(raw_path) = find_raw_frame(session_dir, &issue.id) else {
            continue;
        };

        let img = image::open(&raw_path)
            .map_err(|e| RenderError::Io(std::io::Error::other(e.to_string())))?;
        let cropped = crop_for_target(&img, rect, session.env.viewport.dpr);

        let out_path = session_dir.join("assets").join(format!("{}.png", issue.id));
        if let Some(parent) = out_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        cropped
            .save(&out_path)
            .map_err(|e| RenderError::Io(std::io::Error::other(e.to_string())))?;
        written.push(out_path);
    }
    Ok(written)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgb, RgbImage};

    fn solid_image(w: u32, h: u32) -> DynamicImage {
        DynamicImage::ImageRgb8(RgbImage::from_pixel(w, h, Rgb([10, 20, 30])))
    }

    #[test]
    fn recorta_con_padding_cuando_ya_supera_el_ancho_de_contexto() {
        let img = solid_image(2000, 2000);
        // Rect de 700 de ancho: con 24px de padding a cada lado ya supera 640, así que
        // no debería ensancharse más allá de rect + 2*padding.
        let rect = Rect {
            x: 500.0,
            y: 500.0,
            w: 700.0,
            h: 100.0,
        };
        let cropped = crop_for_target(&img, &rect, 1.0);
        assert_eq!(cropped.width(), 700 + 48);
        assert_eq!(cropped.height(), 100 + 48);
    }

    #[test]
    fn ensancha_al_contexto_minimo_cuando_el_target_es_angosto() {
        let img = solid_image(2000, 2000);
        let rect = Rect {
            x: 1000.0,
            y: 500.0,
            w: 88.0,
            h: 32.0,
        };
        let cropped = crop_for_target(&img, &rect, 1.0);
        assert_eq!(cropped.width(), 640);
        // El alto nunca se ensancha: solo el padding del target.
        assert_eq!(cropped.height(), 32 + 48);
    }

    #[test]
    fn escala_por_dpr_antes_de_recortar() {
        let img = solid_image(2000, 2000);
        let rect = Rect {
            x: 500.0,
            y: 500.0,
            w: 88.0,
            h: 32.0,
        };
        let cropped_1x = crop_for_target(&img, &rect, 1.0);
        let cropped_2x = crop_for_target(&img, &rect, 2.0);
        assert_eq!(cropped_2x.width(), cropped_1x.width() * 2);
        assert_eq!(cropped_2x.height(), cropped_1x.height() * 2);
    }

    #[test]
    fn clampea_contra_el_borde_de_la_imagen_sin_salirse() {
        let img = solid_image(300, 300);
        let rect = Rect {
            x: 10.0,
            y: 10.0,
            w: 20.0,
            h: 20.0,
        };
        let cropped = crop_for_target(&img, &rect, 1.0);
        assert!(cropped.width() <= 300);
        assert!(cropped.height() <= 300);
    }
}
