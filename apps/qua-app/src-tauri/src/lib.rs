mod audio;
mod commands;
mod hotkeys;
mod hotkeys_actions;
mod model;
mod paths;
mod sidecar;
mod state;
mod tray;
mod windows;

use std::sync::{Arc, Mutex};

use tauri::WindowEvent;

use state::AppState;

/// El `Stream` de cpal del medidor de nivel en curso. Se reemplaza (drop del
/// anterior) cada vez que el usuario elige otro dispositivo de entrada.
pub struct MeterHandle(pub Mutex<Option<audio::LevelMeter>>);

impl Default for MeterHandle {
    fn default() -> Self {
        Self(Mutex::new(None))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .try_init()
        .ok();

    let app_state = Arc::new(AppState::default());

    tauri::Builder::default()
        // Tiene que registrarse primero: una segunda apertura enfoca la ventana de
        // la instancia existente en vez de arrancar otro daemon sobre el puerto 7331.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            windows::show(app, "onboarding");
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .manage(app_state.clone())
        .manage(sidecar::SidecarHandle::default())
        .manage(MeterHandle::default())
        .invoke_handler(tauri::generate_handler![
            commands::daemon_health,
            commands::pairing_start,
            commands::list_sessions,
            commands::read_report,
            commands::read_refined_report,
            commands::read_issues,
            commands::extension_path,
            commands::session_audio_path,
            commands::reprocess_session,
            commands::refine_session,
            commands::run_doctor,
            commands::model_status,
            commands::download_model,
            commands::request_mic_permission,
            commands::list_input_devices,
            commands::select_input_device,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();

            hotkeys::register(&handle)?;
            tray::setup(&handle)?;

            // El daemon corre solo (no hay flujo de onboarding que lo bloquee): sidecar
            // + health-check arrancan apenas la ventana de tray está lista (§09).
            let sidecar_handle = handle.clone();
            let sidecar_state = app_state.clone();
            tauri::async_runtime::spawn(sidecar::supervise(sidecar_handle, sidecar_state));

            let health_handle = handle.clone();
            let health_state = app_state.clone();
            tauri::async_runtime::spawn(sidecar::health_loop(health_handle, health_state));

            // Tick de 1 s: refresca duración + nivel de mic en el tray. Es más barato
            // que un timer por ítem y no depende de que el frontend esté abierto.
            let tick_handle = handle.clone();
            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(std::time::Duration::from_secs(1));
                loop {
                    interval.tick().await;
                    tray::refresh(&tick_handle);
                }
            });

            // La webview configurada puede terminar de materializarse después de
            // `setup` en macOS. Un show diferido evita que el primer lanzamiento
            // quede activo pero sin ninguna ventana en pantalla.
            let initial_window = handle.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(300)).await;
                windows::show(&initial_window, "onboarding");
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            // App de tray: cerrar la ventana la esconde, no mata el proceso — el
            // sidecar y los hotkeys siguen vivos.
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error corriendo la app de Tauri");
}
