//! Formateo de tiempos compartido por `report` y `transcript`.

/// `ms` desde `t0_wall` → `"HH:MM:SS"`, siempre con horas aunque sean `00` (§8.1:
/// `(00:02:14)`).
pub(super) fn hms(ms: i64) -> String {
    let total_s = ms.max(0) / 1000;
    let h = total_s / 3600;
    let m = (total_s % 3600) / 60;
    let s = total_s % 60;
    format!("{h:02}:{m:02}:{s:02}")
}
