//! Una sola ventana webview reutilizada para onboarding / pairing / sesiones (§09) —
//! el frontend rutea por hash (`src/main.ts`). Nace oculta y minimizada: la app vive
//! en el tray, no en el Dock.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

const LABEL: &str = "main";

pub fn show(app: &AppHandle, view: &str) {
    if let Some(win) = app.get_webview_window(LABEL) {
        let _ = win.eval(&format!("location.hash = '#/{view}'"));
        let _ = win.show();
        let _ = win.set_focus();
        return;
    }

    let url = WebviewUrl::App(format!("index.html#/{view}").into());
    let win = match WebviewWindowBuilder::new(app, LABEL, url)
        .title("QUA")
        .inner_size(1040.0, 700.0)
        .min_inner_size(760.0, 480.0)
        .visible(true)
        .build()
    {
        Ok(w) => w,
        Err(e) => {
            tracing::error!(error = %e, "no se pudo crear la ventana principal");
            return;
        }
    };
    // Ya nace visible y con la ruta en la URL: no depende de un evento de carga.
    let _ = win.show();
    let _ = win.set_focus();
}
