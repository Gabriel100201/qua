//! Medidor de nivel de mic y selector de dispositivo de entrada (§09).
//!
//! El app "no captura nada" en el sentido de §09 (esa es la responsabilidad de la
//! extensión vía el offscreen document, §5.4) — este stream es solo para mostrar un
//! nivel en vivo y listar dispositivos en el tray, nunca se manda a ningún lado ni se
//! persiste.
//!
//! `cpal::Stream` no es `Send` en macOS (CoreAudio lo ata al thread que lo crea), así
//! que no puede vivir en un `tauri::State` compartido. En cambio, todo el ciclo de
//! vida del stream — crearlo, tocarlo, esperar — corre en un thread dedicado; lo único
//! que cruza a otros threads es el `Sender` que le pide que pare.

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::mpsc;
use std::sync::Arc;

use crate::state::AppState;

pub fn list_input_devices() -> anyhow::Result<Vec<String>> {
    let host = cpal::default_host();
    let mut names = Vec::new();
    for dev in host.input_devices()? {
        if let Ok(name) = dev.name() {
            names.push(name);
        }
    }
    Ok(names)
}

fn find_device(name: Option<&str>) -> anyhow::Result<cpal::Device> {
    let host = cpal::default_host();
    if let Some(name) = name {
        for dev in host.input_devices()? {
            if dev.name().map(|n| n == name).unwrap_or(false) {
                return Ok(dev);
            }
        }
    }
    host.default_input_device()
        .ok_or_else(|| anyhow::anyhow!("no hay dispositivo de entrada por default"))
}

/// Abre el input default un instante — en macOS esto es lo que dispara el diálogo de
/// permiso de micrófono la primera vez (§09 onboarding). Bloquea el thread actual
/// ~150 ms; se llama desde un comando async así que no cuelga la UI.
pub fn probe_permission() -> anyhow::Result<()> {
    let device = find_device(None)?;
    let config = device.default_input_config()?;
    let err_fn = |e| tracing::warn!(error = %e, "cpal stream error");
    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => {
            device.build_input_stream(&config.into(), move |_data: &[f32], _| {}, err_fn, None)?
        }
        _ => {
            device.build_input_stream(&config.into(), move |_data: &[i16], _| {}, err_fn, None)?
        }
    };
    stream.play()?;
    std::thread::sleep(std::time::Duration::from_millis(150));
    drop(stream);
    Ok(())
}

/// Handle `Send + Sync` del medidor: dropearlo le pide al thread dedicado que corte el
/// tap del mic y termine.
pub struct LevelMeter {
    stop_tx: mpsc::Sender<()>,
}

impl Drop for LevelMeter {
    fn drop(&mut self) {
        let _ = self.stop_tx.send(());
    }
}

/// Arranca (o reinicia sobre otro dispositivo) el tap de nivel en un thread propio. El
/// nivel calculado (RMS de la ventana más reciente, con una ganancia visual) se
/// escribe en `state.mic_level`; el tray lo lee en su tick de refresco.
pub fn start_level_meter(device_name: Option<&str>, state: Arc<AppState>) -> anyhow::Result<LevelMeter> {
    // Falla temprano si el dispositivo no existe, antes de comprometernos al thread.
    find_device(device_name)?;

    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    let device_name = device_name.map(|s| s.to_string());

    std::thread::Builder::new()
        .name("qua-mic-meter".into())
        .spawn(move || {
            let device = match find_device(device_name.as_deref()) {
                Ok(d) => d,
                Err(e) => {
                    tracing::warn!(error = %e, "medidor de nivel: no se pudo abrir el dispositivo");
                    return;
                }
            };
            let config = match device.default_input_config() {
                Ok(c) => c,
                Err(e) => {
                    tracing::warn!(error = %e, "medidor de nivel: sin config de input");
                    return;
                }
            };
            let err_fn = |e| tracing::warn!(error = %e, "cpal stream error");

            let stream = match config.sample_format() {
                cpal::SampleFormat::F32 => {
                    let state = state.clone();
                    device.build_input_stream(
                        &config.clone().into(),
                        move |data: &[f32], _| state.set_mic_level(rms_f32(data)),
                        err_fn,
                        None,
                    )
                }
                cpal::SampleFormat::I16 => {
                    let state = state.clone();
                    device.build_input_stream(
                        &config.clone().into(),
                        move |data: &[i16], _| state.set_mic_level(rms_i16(data)),
                        err_fn,
                        None,
                    )
                }
                other => {
                    tracing::warn!("formato de sample no soportado: {other:?}");
                    return;
                }
            };

            let stream = match stream {
                Ok(s) => s,
                Err(e) => {
                    tracing::warn!(error = %e, "medidor de nivel: no se pudo abrir el stream");
                    return;
                }
            };
            if let Err(e) = stream.play() {
                tracing::warn!(error = %e, "medidor de nivel: no se pudo arrancar el stream");
                return;
            }

            // Vive hasta que `LevelMeter` se dropea y manda la señal de parada.
            let _ = stop_rx.recv();
            state.set_mic_level(0.0);
            drop(stream);
        })?;

    Ok(LevelMeter { stop_tx })
}

fn rms_f32(data: &[f32]) -> f32 {
    if data.is_empty() {
        return 0.0;
    }
    let sum_sq: f32 = data.iter().map(|s| s * s).sum();
    (sum_sq / data.len() as f32).sqrt() * 4.0 // ganancia visual, no es una medición calibrada
}

fn rms_i16(data: &[i16]) -> f32 {
    if data.is_empty() {
        return 0.0;
    }
    let sum_sq: f64 = data
        .iter()
        .map(|s| (*s as f64 / i16::MAX as f64).powi(2))
        .sum();
    ((sum_sq / data.len() as f64).sqrt() * 4.0) as f32
}
