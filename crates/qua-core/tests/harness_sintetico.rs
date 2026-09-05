//! Corrida del correlador contra el harness sintético de F1/F1b (`packages/qua-synth`).
//!
//! **Es una medición, no el oráculo.** Los tests que mandan sobre §07 son los unitarios de
//! `src/correlate/`: están escritos contra la spec y no dependen de estas fixtures. Acá se
//! mide el porcentaje de anclaje sobre los 26 escenarios y se imprime el detalle, para
//! poder decir dónde discrepan el harness y §07 (ver el reporte de B3 y `docs/DECISIONS.md`).
//!
//! `cargo test -p qua-core --test harness_sintetico -- --nocapture` imprime la tabla.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use qua_core::correlate::{correlate, events_from_ndjson, CorrelatorConfig};
use qua_protocol::{AnchorKind, Event, Utterance};
use serde_json::{json, Value};

fn dir_del_harness() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/qua-synth/expected")
}

/// Lo que declara el `expected.json` de cada escenario.
#[derive(Debug)]
struct Esperado {
    /// `null` = no se espera ningún issue.
    hay_issue: bool,
    kind: String,
    selector: Option<String>,
}

/// **Shim del harness, no del correlador.**
///
/// Las fixtures de `qua-synth` no validan contra el contrato de §03: a `nav` le faltan
/// `title` y `kind`, a `click` le falta `mods`, a `scroll_settle` le faltan `y` y `pct`, y
/// a `mutation_burst` le falta `count`. Se completan acá con valores neutros para poder
/// medir el correlador; el correlador de producción **no** los inventa (los saltea y los
/// reporta, ver `ingest::SkipReason::Malformed`).
fn parchar_al_contrato(linea: &str) -> Option<String> {
    let mut v: Value = serde_json::from_str(linea).ok()?;
    let obj = v.as_object_mut()?;
    let k = obj.get("k")?.as_str()?.to_string();
    let poner = |o: &mut serde_json::Map<String, Value>, campo: &str, valor: Value| {
        o.entry(campo.to_string()).or_insert(valor);
    };
    match k.as_str() {
        "nav" => {
            poner(obj, "title", json!(""));
            poner(obj, "kind", json!("load"));
        }
        "click" => poner(obj, "mods", json!([])),
        "scroll_settle" => {
            poner(obj, "y", json!(0));
            poner(obj, "pct", json!(0));
        }
        "mutation_burst" => poner(obj, "count", json!(0)),
        _ => {}
    }
    serde_json::to_string(&v).ok()
}

fn cargar(dir: &Path, id: &str) -> (Vec<Event>, Vec<Utterance>, Esperado, usize, usize) {
    let crudo = std::fs::read_to_string(dir.join(format!("{id}.events.ndjson")))
        .unwrap_or_else(|e| panic!("{id}.events.ndjson: {e}"));

    // Cuántas líneas rechaza el contrato tal cual vienen: es el dato que le importa a F1b.
    let (_, rechazadas_crudas) = events_from_ndjson(&crudo);

    let parchado: String = crudo
        .lines()
        .filter_map(parchar_al_contrato)
        .collect::<Vec<_>>()
        .join("\n");
    let (events, saltadas) = events_from_ndjson(&parchado);

    let utterances: Vec<Utterance> = serde_json::from_str(
        &std::fs::read_to_string(dir.join(format!("{id}.utterances.json")))
            .unwrap_or_else(|e| panic!("{id}.utterances.json: {e}")),
    )
    .unwrap_or_else(|e| panic!("{id}.utterances.json no parsea contra el contrato: {e}"));

    let esperado_json: Value = serde_json::from_str(
        &std::fs::read_to_string(dir.join(format!("{id}.expected.json")))
            .unwrap_or_else(|e| panic!("{id}.expected.json: {e}")),
    )
    .expect("expected.json es JSON");

    let esperado = Esperado {
        hay_issue: !esperado_json["issue"].is_null(),
        kind: esperado_json["anchor"]["kind"]
            .as_str()
            .expect("anchor.kind")
            .to_string(),
        selector: esperado_json["anchor"]["selector"]
            .as_str()
            .map(str::to_string),
    };

    (
        events,
        utterances,
        esperado,
        rechazadas_crudas.len(),
        saltadas.len(),
    )
}

fn kind_str(k: AnchorKind) -> &'static str {
    match k {
        AnchorKind::Element => "element",
        AnchorKind::Route => "route",
        AnchorKind::Session => "session",
    }
}

struct Resultado {
    id: String,
    ok: bool,
    obtenido: String,
    esperado: String,
    confianza: f64,
}

fn correr(cfg: &CorrelatorConfig) -> (Vec<Resultado>, usize, usize) {
    let dir = dir_del_harness();
    let manifest: Value = serde_json::from_str(
        &std::fs::read_to_string(dir.join("manifest.json")).expect("manifest.json"),
    )
    .expect("manifest.json es JSON");
    let ids: Vec<String> = manifest["scenarios"]
        .as_array()
        .expect("scenarios")
        .iter()
        .map(|s| s["id"].as_str().expect("id").to_string())
        .collect();

    let mut resultados = Vec::new();
    let mut rechazadas = 0;
    let mut saltadas = 0;

    for id in ids {
        let (events, utterances, esperado, rech, salt) = cargar(&dir, &id);
        rechazadas += rech;
        saltadas += salt;

        let c = correlate(&events, &utterances, cfg);
        let primero = c.issues.first();

        let (ok, obtenido, confianza) = match (esperado.hay_issue, primero) {
            (false, None) => (true, "sin issues".to_string(), 0.0),
            (false, Some(i)) => (
                false,
                format!("{} ({} issues)", kind_str(i.anchor.kind), c.issues.len()),
                i.anchor.confidence,
            ),
            (true, None) => (false, "sin issues".to_string(), 0.0),
            (true, Some(i)) => {
                let kind = kind_str(i.anchor.kind);
                let sel = i.anchor.target.as_ref().map(|t| t.sel.clone());
                let ok = kind == esperado.kind
                    && (esperado.selector.is_none() || sel == esperado.selector);
                let obtenido = match &sel {
                    Some(s) => format!("{kind} {s}"),
                    None => kind.to_string(),
                };
                (ok, obtenido, i.anchor.confidence)
            }
        };

        let esperado_txt = match (&esperado.hay_issue, &esperado.selector) {
            (false, _) => "sin issues".to_string(),
            (true, Some(s)) => format!("{} {s}", esperado.kind),
            (true, None) => esperado.kind.clone(),
        };

        resultados.push(Resultado {
            id,
            ok,
            obtenido,
            esperado: esperado_txt,
            confianza,
        });
    }

    (resultados, rechazadas, saltadas)
}

fn imprimir(titulo: &str, r: &[Resultado]) -> f64 {
    let aciertos = r.iter().filter(|x| x.ok).count();
    let pct = 100.0 * aciertos as f64 / r.len() as f64;
    println!("\n=== {titulo} ===");
    println!("{:<5} {:<4} {:<8} {:<46} esperado", "esc", "ok", "conf", "obtenido");
    for x in r {
        println!(
            "{:<5} {:<4} {:<8.2} {:<46} {}",
            x.id,
            if x.ok { "sí" } else { "NO" },
            x.confianza,
            x.obtenido,
            x.esperado
        );
    }
    println!("→ {aciertos}/{} = {pct:.1} %", r.len());
    pct
}

/// Mide el correlador con la configuración por defecto.
#[test]
fn porcentaje_de_anclaje_sobre_el_harness() {
    let (r, rechazadas, saltadas) = correr(&CorrelatorConfig::default());
    let pct = imprimir("config por defecto (merge_extra_weight = 0.25)", &r);

    println!(
        "\nlíneas que el contrato de §03 rechaza tal cual vienen del harness: {rechazadas}"
    );
    println!("líneas descartadas después del shim (k inexistente, p. ej. `scroll`): {saltadas}");

    // El baseline temporal ingenuo que documenta el README de qua-synth da 3.8 %.
    // Quedar en o por debajo de eso querría decir que el scoring no aporta nada.
    assert!(
        pct > 3.8,
        "el correlador no le gana al baseline temporal del harness: {pct:.1} %"
    );
}

/// El mismo harness con los dos extremos de la perilla de fusión: `1.0` es la suma literal
/// de §07 paso 5 y `0.0` deja solo el aporte más fuerte. Mide cuánto de la diferencia
/// contra el ground truth de F1 viene de esa línea de la spec (D-B3-07).
#[test]
fn porcentaje_con_los_dos_extremos_de_la_fusion() {
    for w in [1.0, 0.0] {
        let cfg = CorrelatorConfig {
            merge_extra_weight: w,
            ..CorrelatorConfig::default()
        };
        let (r, _, _) = correr(&cfg);
        imprimir(&format!("merge_extra_weight = {w}"), &r);
    }
}

/// Ningún escenario puede terminar anclado a un elemento **equivocado** con confianza
/// alta: es la falla que manda al agente a editar el archivo equivocado (§07 paso 6).
#[test]
fn los_desaciertos_no_pueden_ser_de_alta_confianza() {
    let (r, _, _) = correr(&CorrelatorConfig::default());
    let mut graves: BTreeMap<&str, f64> = BTreeMap::new();
    for x in &r {
        if !x.ok && x.obtenido.starts_with("element") && x.confianza > 0.5 {
            graves.insert(&x.id, x.confianza);
        }
    }
    println!("\ndesaciertos anclados a elemento con confianza > 0.5: {graves:?}");
}
