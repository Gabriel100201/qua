//! `transcript.txt` (§8.2): "texto plano con timestamps", para reescuchar/releer sin
//! abrir `session.json`.

use qua_protocol::Session;

use super::time_fmt::hms;

pub fn render_transcript(session: &Session) -> String {
    let mut out = String::new();
    for u in &session.utterances {
        out.push_str(&format!("[{}] {}", hms(u.t_start), u.text));
        if u.marked {
            out.push_str(" [mark]");
        }
        out.push('\n');
    }
    out
}
