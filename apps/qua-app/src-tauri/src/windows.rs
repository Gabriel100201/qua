//! Una sola ventana webview reutilizada para onboarding / pairing / sesiones (§09) —
//! el frontend rutea por hash (`src/main.ts`). Nace oculta y minimizada: la app vive
//! en el tray, no en el Dock.

use tauri::{AppHandle, Listener, Manager, WebviewUrl, WebviewWindowBuilder};

const LABEL: &str = "main";

pub fn show(app: &AppHandle, view: &str) {
    if let Some(win) = app.get_webview_window(LABEL) {
        let _ = win.eval(&format!("location.hash = '#/{view}'"));
        let _ = win.show();
        let _ = win.set_focus();
        return;
    }

    let win = match WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html".into()))
        .title("QUA")
        .inner_size(760.0, 560.0)
        .visible(false)
        .build()
    {
        Ok(w) => w,
        Err(e) => {
            tracing::error!(error = %e, "no se pudo crear la ventana principal");
            return;
        }
    };
    let view = view.to_string();
    let win_clone = win.clone();
    win.once("tauri://created", move |_| {
        let _ = win_clone.eval(&format!("location.hash = '#/{view}'"));
        let _ = win_clone.show();
        let _ = win_clone.set_focus();
    });
}
