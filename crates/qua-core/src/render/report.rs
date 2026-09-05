//! `report.md` (§8.1): tabla resumen + un bloque por issue.
//!
//! El formato exacto de campos, orden y separadores es el de §8.1; los detalles que la
//! spec deja implícitos (ancho de columna, cómo se ve un ancla `route`/`session`, qué
//! pasa cuando falta `git`) están resueltos y anotados en `docs/DECISIONS.md` (D-B4-01
//! a D-B4-04).

use qua_protocol::{
    Anchor, AnchorKind, Issue, IssueCategory, Session, Severity, TargetRef, UNANCHORED_CONFIDENCE,
};

use super::time_fmt::hms;

pub fn render_report_md(session: &Session) -> String {
    let (anchored, unanchored) = split_by_confidence(&session.issues);

    let mut out = String::new();
    out.push_str(&format!("# QUA — {}\n", session.project.label));
    out.push_str(&meta_line(session, anchored.len(), unanchored.len()));
    out.push_str("\n\n");
    out.push_str(&summary_table(&anchored));

    if !anchored.is_empty() {
        out.push_str("\n---\n");
        let viewport = (
            session.env.viewport.w,
            session.env.viewport.h,
            session.env.viewport.dpr,
        );
        for (i, issue) in anchored.iter().enumerate() {
            out.push('\n');
            out.push_str(&issue_block(i + 1, issue, viewport));
            out.push_str("\n---\n");
        }
    }

    if !unanchored.is_empty() {
        out.push('\n');
        out.push_str(&unanchored_section(&unanchored));
    }

    out
}

fn split_by_confidence(issues: &[Issue]) -> (Vec<&Issue>, Vec<&Issue>) {
    let mut anchored: Vec<&Issue> = Vec::new();
    let mut unanchored: Vec<&Issue> = Vec::new();
    for issue in issues {
        if issue.anchor.confidence < UNANCHORED_CONFIDENCE {
            unanchored.push(issue);
        } else {
            anchored.push(issue);
        }
    }
    // Orden de §8.1: severidad (high > med > low) y después confianza descendente.
    anchored.sort_by(|a, b| {
        b.severity
            .cmp(&a.severity)
            .then(b.anchor.confidence.total_cmp(&a.anchor.confidence))
    });
    // "Sin anclar" no tiene orden definido en la spec; cronológico es lo más útil para
    // releer la sesión en vivo (D-B4-04).
    unanchored.sort_by_key(|i| i.t);
    (anchored, unanchored)
}

/// El conteo del encabezado cuenta lo mismo que ve la tabla resumen: los issues
/// anclados, más los de "Sin anclar" aparte. `session.issues.len()` a secas queda mal —
/// es la suma de ambos, pero la tabla solo lista los anclados, así que un lector cuenta 3
/// filas contra un encabezado que dice "4 issues" (D-B6-02, ver `docs/DECISIONS.md`).
fn meta_line(session: &Session, anchored: usize, unanchored: usize) -> String {
    let mut parts = vec![
        date_time(&session.started_at),
        duration(session.duration_ms),
    ];
    if let Some(git) = &session.git {
        let mut clause = format!("rama `{}` @ `{}`", git.branch, git.sha);
        if git.dirty {
            clause.push_str(" (dirty)");
        }
        parts.push(clause);
    }
    parts.push(if unanchored > 0 {
        format!("{anchored} issues + {unanchored} sin anclar")
    } else {
        format!("{anchored} issues")
    });
    parts.join(" · ")
}

/// `"2026-09-04T14:32:11.204Z"` → `"2026-09-04 14:32"` (§8.1: sin segundos, sin
/// convertir de UTC — ver D-B4-06).
fn date_time(started_at: &str) -> String {
    let mut out = started_at.replacen('T', " ", 1);
    if let Some(colon2) = out.match_indices(':').nth(1) {
        out.truncate(colon2.0);
    }
    out
}

/// `412308` → `"6m 52s"` (§8.1). Sin horas si no hacen falta, sin minutos si no hacen
/// falta.
fn duration(duration_ms: Option<i64>) -> String {
    let total_s = duration_ms.unwrap_or(0) / 1000;
    let h = total_s / 3600;
    let m = (total_s % 3600) / 60;
    let s = total_s % 60;
    if h > 0 {
        format!("{h}h {m}m {s}s")
    } else if m > 0 {
        format!("{m}m {s}s")
    } else {
        format!("{s}s")
    }
}

fn category_str(c: IssueCategory) -> &'static str {
    match c {
        IssueCategory::Ui => "ui",
        IssueCategory::Bug => "bug",
        IssueCategory::Perf => "perf",
        IssueCategory::Copy => "copy",
        IssueCategory::Idea => "idea",
    }
}

fn severity_str(s: Severity) -> &'static str {
    match s {
        Severity::Low => "low",
        Severity::Med => "med",
        Severity::High => "high",
    }
}

/// Recorta `http://host:port/a/b?x=1` a `/a/b?x=1`. Si no hay esquema, devuelve la URL
/// tal cual (D-B4-02).
fn url_path(url: &str) -> &str {
    match url.find("://") {
        Some(scheme_end) => {
            let rest = &url[scheme_end + 3..];
            match rest.find('/') {
                Some(slash) => &rest[slash..],
                None => "/",
            }
        }
        None => url,
    }
}

/// Cómo se identifica un ancla en la columna "Ancla" de la tabla y en el campo
/// **Ancla** del detalle: el selector para `element`, el path para `route`, y una
/// etiqueta fija para `session` (D-B4-02: la spec no da un ejemplo de estos dos
/// últimos casos, así que el formato es criterio de B4).
fn anchor_label(anchor: &Anchor) -> String {
    match anchor.kind {
        AnchorKind::Element => match &anchor.target {
            Some(t) => format!("`{}`", t.sel),
            None => "`(elemento sin selector)`".to_string(),
        },
        AnchorKind::Route => match &anchor.url {
            Some(url) => format!("`{}`", url_path(url)),
            None => "`(ruta desconocida)`".to_string(),
        },
        AnchorKind::Session => "(sesión completa)".to_string(),
    }
}

fn summary_table(anchored: &[&Issue]) -> String {
    let categories: Vec<&str> = anchored.iter().map(|i| category_str(i.category)).collect();
    let severities: Vec<&str> = anchored.iter().map(|i| severity_str(i.severity)).collect();
    let cat_w = categories.iter().map(|s| s.len()).max().unwrap_or(0);
    let sev_w = severities.iter().map(|s| s.len()).max().unwrap_or(0);

    let mut out = String::new();
    out.push_str("| # | Categoría | Sev | Confianza | Ancla |\n");
    out.push_str("|---|-----------|-----|-----------|-------|\n");
    for (i, issue) in anchored.iter().enumerate() {
        out.push_str(&format!(
            "| {} | {:cat_w$} | {:sev_w$} | {:.2} | {} |\n",
            i + 1,
            category_str(issue.category),
            severity_str(issue.severity),
            issue.anchor.confidence,
            anchor_label(&issue.anchor),
            cat_w = cat_w,
            sev_w = sev_w,
        ));
    }
    out
}

/// Formatea un `f64` sin el `.0` sobrante: `2.0 → "2"`, `1.5 → "1.5"` (para `dpr` y
/// rects que a veces llegan como enteros exactos).
fn trim_float(v: f64) -> String {
    if v.fract() == 0.0 {
        format!("{v:.0}")
    } else {
        format!("{v}")
    }
}

fn issue_block(n: usize, issue: &Issue, viewport: (i64, i64, f64)) -> String {
    let mut out = String::new();
    out.push_str(&format!(
        "## {:02} · {} · {}\n",
        n,
        category_str(issue.category),
        severity_str(issue.severity)
    ));
    out.push_str(&format!(
        "**Dicho** ({}) — \"{}\"\n",
        hms(issue.t),
        issue.text
    ));
    out.push('\n');

    let target = issue.anchor.target.as_ref();

    out.push_str(&format!(
        "**Ancla** {} · confianza {:.2}",
        anchor_label(&issue.anchor),
        issue.anchor.confidence
    ));
    if !issue.anchor.reason.is_empty() {
        out.push_str(" · ");
        out.push_str(&issue.anchor.reason.join(" · "));
    }
    out.push('\n');

    out.push_str(&format!("**Ruta** {}\n", route_line(issue)));

    if let Some(t) = target {
        if let Some(line) = source_line(t) {
            out.push_str(&line);
            out.push('\n');
        }
        if let Some(line) = geometry_line(t, Some(viewport)) {
            out.push_str(&line);
            out.push('\n');
        }
        if let Some(classes) = &t.classes {
            out.push_str(&format!("**Clases** `{classes}`\n"));
        }
    }

    if !issue.evidence.timings.is_empty() {
        let joined = issue
            .evidence
            .timings
            .iter()
            .map(|t| format!("{}: {} ms", t.label, t.ms))
            .collect::<Vec<_>>()
            .join("; ");
        out.push_str(&format!("**Timing** {joined}\n"));
    }

    if let Some(shot) = &issue.evidence.screenshot {
        out.push_str(&format!("**Captura** ![]({shot})\n"));
    }

    out
}

fn route_line(issue: &Issue) -> String {
    match issue.anchor.kind {
        AnchorKind::Session => "(sesión completa)".to_string(),
        _ => {
            let path = issue
                .anchor
                .url
                .as_deref()
                .map(url_path)
                .unwrap_or("(ruta desconocida)");
            match issue.anchor.tab {
                Some(tab) => format!("`{path}` (pestaña {tab})"),
                None => format!("`{path}`"),
            }
        }
    }
}

fn source_line(target: &TargetRef) -> Option<String> {
    let src_part = match &target.src {
        Some(src) => format!("`{}:{}`", src.file, src.line),
        None => "`(sin archivo fuente)`".to_string(),
    };
    let component_part = target
        .component
        .as_ref()
        .filter(|c| !c.is_empty())
        .map(|c| format!(" — `{}`", c.join(" > ")));

    if target.src.is_none() && component_part.is_none() {
        return None;
    }
    Some(format!(
        "**Fuente** {src_part}{}",
        component_part.unwrap_or_default()
    ))
}

fn geometry_line(target: &TargetRef, viewport: Option<(i64, i64, f64)>) -> Option<String> {
    let rect = target.rect.as_ref()?;
    let mut line = format!(
        "**Geometría** {}×{} px @ ({}, {})",
        trim_float(rect.w),
        trim_float(rect.h),
        trim_float(rect.x),
        trim_float(rect.y)
    );
    if let Some((w, h, dpr)) = viewport {
        line.push_str(&format!(" · viewport {w}×{h} @{}x", trim_float(dpr)));
    }
    Some(line)
}

fn unanchored_section(unanchored: &[&Issue]) -> String {
    let mut out = String::new();
    out.push_str("## Sin anclar\n\n");
    for issue in unanchored {
        let route = match &issue.anchor.url {
            Some(url) => format!("`{}`", url_path(url)),
            None => "(sesión completa)".to_string(),
        };
        out.push_str(&format!(
            "- ({}) {}/{} — \"{}\" · ruta {route}\n",
            hms(issue.t),
            category_str(issue.category),
            severity_str(issue.severity),
            issue.text
        ));
    }
    out
}
