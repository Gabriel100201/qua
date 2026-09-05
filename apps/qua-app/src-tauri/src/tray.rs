//! Tray de §09: estado (idle · grabando · procesando), duración corriendo, medidor de
//! nivel de mic en vivo, selector de dispositivo de entrada.

use std::sync::Arc;

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager};

use crate::state::AppState;
use crate::{audio, hotkeys_actions, windows};

/// Handles a los ítems que se actualizan en el tick de refresco, para no reconstruir
/// el menú entero cada segundo (Tauri lo permite, pero es más trabajo del necesario y
/// parpadea si el usuario lo tiene abierto).
pub struct TrayHandles {
    pub status: MenuItem<tauri::Wry>,
    pub duration: MenuItem<tauri::Wry>,
    pub level: MenuItem<tauri::Wry>,
    pub device_items: Vec<CheckMenuItem<tauri::Wry>>,
}

pub fn setup(app: &AppHandle) -> anyhow::Result<()> {
    let status = MenuItem::with_id(app, "status", "● idle", false, None::<&str>)?;
    let duration = MenuItem::with_id(app, "duration", "", false, None::<&str>)?;
    let level = MenuItem::with_id(app, "level", "nivel de mic: —", false, None::<&str>)?;

    let devices = audio::list_input_devices().unwrap_or_default();
    let mut device_items = Vec::new();
    for name in &devices {
        let item = CheckMenuItem::with_id(app, format!("device:{name}"), name, true, false, None::<&str>)?;
        device_items.push(item);
    }
    let device_refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = device_items
        .iter()
        .map(|i| i as &dyn tauri::menu::IsMenuItem<tauri::Wry>)
        .collect();
    let device_submenu = Submenu::with_items(app, "Dispositivo de entrada", true, &device_refs)?;

    let toggle = MenuItem::with_id(app, "toggle", "Grabar / detener  ⌘⇧R", true, None::<&str>)?;
    let mark = MenuItem::with_id(app, "mark", "Marcador  ⌘⇧E", true, None::<&str>)?;
    let sessions = MenuItem::with_id(app, "sessions", "Sesiones…", true, None::<&str>)?;
    let pairing = MenuItem::with_id(app, "pairing", "Pairing…", true, None::<&str>)?;
    let doctor = MenuItem::with_id(app, "doctor", "qua doctor", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Salir", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &status,
            &duration,
            &level,
            &PredefinedMenuItem::separator(app)?,
            &device_submenu,
            &PredefinedMenuItem::separator(app)?,
            &toggle,
            &mark,
            &PredefinedMenuItem::separator(app)?,
            &sessions,
            &pairing,
            &doctor,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    let icon = app.default_window_icon().cloned();
    let mut builder = TrayIconBuilder::with_id("main")
        .menu(&menu)
        .tooltip("QUA")
        .on_menu_event(move |app, event| {
            let id = event.id().as_ref();
            if let Some(name) = id.strip_prefix("device:") {
                select_device(app, name);
                return;
            }
            match id {
                "toggle" => hotkeys_actions::toggle_recording(app),
                "mark" => hotkeys_actions::drop_mark(app),
                "sessions" => windows::show(app, "sessions"),
                "pairing" => windows::show(app, "pairing"),
                "doctor" => windows::show(app, "onboarding"),
                "quit" => app.exit(0),
                _ => {}
            }
        });
    if let Some(icon) = icon {
        builder = builder.icon(icon);
    }
    builder.build(app)?;

    app.manage(TrayHandles {
        status,
        duration,
        level,
        device_items,
    });

    // Arranca el medidor sobre el dispositivo default. Si no hay mic (CI, sandbox sin
    // permiso todavía) no es fatal: el tray simplemente muestra "—".
    if let Some(first) = devices.first() {
        select_device(app, first);
    }

    Ok(())
}

fn select_device(app: &AppHandle, name: &str) {
    let state = app.state::<Arc<AppState>>();
    *state.selected_input_device.lock().unwrap() = Some(name.to_string());

    let handles = app.state::<TrayHandles>();
    for item in &handles.device_items {
        let is_this = item.id().as_ref() == format!("device:{name}");
        let _ = item.set_checked(is_this);
    }

    let meter_state = app.state::<crate::MeterHandle>();
    let inner = Arc::clone(&state.inner());
    match audio::start_level_meter(Some(name), inner) {
        Ok(meter) => *meter_state.inner().0.lock().unwrap() = Some(meter),
        Err(e) => tracing::warn!(error = %e, "no se pudo abrir el medidor de nivel"),
    }
}

/// Se llama desde el tick de 1 s: refresca estado, duración y nivel sin tocar el
/// resto del menú.
pub fn refresh(app: &AppHandle) {
    let state = app.state::<Arc<AppState>>();
    let handles = app.state::<TrayHandles>();

    let _ = handles.status.set_text(state.rec_state().label());
    let _ = handles
        .duration
        .set_text(state.duration_label().unwrap_or_default());

    let level = state.mic_level();
    let bars = "▁▂▃▄▅▆▇█";
    let idx = ((level * (bars.chars().count() - 1) as f32).round() as usize)
        .min(bars.chars().count() - 1);
    let bar = bars.chars().nth(idx).unwrap_or('▁');
    let _ = handles
        .level
        .set_text(format!("nivel de mic: {bar} {:.0}%", level * 100.0));
}
