<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/wordmark-dark.png">
    <img src="assets/wordmark.png" alt="QUA" width="360">
  </picture>
</p>

<p align="center">
  <strong>Talk through what you see. QUA turns it into a QA report anchored to every element.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Chrome-MV3-4285F4?logo=googlechrome&logoColor=white" alt="Chrome MV3">
  <img src="https://img.shields.io/badge/Whisper-WebGPU-111111" alt="Whisper on WebGPU">
  <img src="https://img.shields.io/badge/Rust-%E2%86%92%20WASM-B7410E?logo=rust&logoColor=white" alt="Rust to WASM">
  <img src="https://img.shields.io/badge/runs-100%25%20on--device-2ea44f" alt="100% on-device">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT"></a>
</p>

<p align="center">
  <b>English</b> · <a href="./README.es.md">Español</a>
</p>

---

You test a web app and say out loud what you notice: *"this button does nothing"*, *"the text
gets cut off here"*. QUA records the session, transcribes your voice and anchors each comment
to the element you were looking at or clicking — with its selector, geometry, classes, route,
console errors, network requests and a cropped screenshot. The output is a `report.md` you can
paste straight into your coding agent, Linear or Slack.

**Everything happens inside Chrome.** No app, no server, no account: Whisper runs on your GPU
through WebGPU and the audio never leaves the browser.

<table>
<tr>
<td width="300" valign="top"><img src="docs/ejemplos/popup-listo.png" alt="QUA popup with a finished report" width="300"></td>
<td valign="top">

```markdown
## 01 · bug · high
**Dicho** (00:01:26) — "Actualmente si presiono uno me lleva al
proyecto. Pero quizás lo mejor sería que cuando lo presione se
abra una pantalla propia por proyecto"

**Ancla** `#project-gallery > a:nth-of-type(2)`
  · confianza 0.74 · click −0.7s
**Elemento** el enlace que dice "PediloApp Sistema de pedidos…"
**Geometría** 314×310 px @ (697, 335) · viewport 1710×981 @2x
**Captura** ![](assets/i01.png)
```

<sub>A real issue from a real session. <i>Dicho</i> = what you said, <i>Ancla</i> = the element it was
anchored to. The UI and reports are in Spanish today (see <a href="#limitations">Limitations</a>).</sub>

</td>
</tr>
</table>

## Why

When you review a UI, the slow part isn't finding problems — it's writing them down. You
notice ten things in two minutes and then spend twenty describing *which* button, *which*
screen, *what* the console said. Coding agents make this worse: they can fix the bug in
seconds, but only if you tell them exactly where it is.

QUA lets you keep talking and clicking. It figures out *where* you meant.

## How it works

```
 microphone ─▶ Silero VAD ─▶ Whisper large-v3-turbo ─┐   offscreen document, WebGPU
                                                     ├─▶ correlator ─▶ report.md + screenshots
 DOM: clicks, hover, focus, console, network, routes ┘   Rust compiled to WASM
```

- **Speech** — Silero VAD (onnxruntime-web) cuts the audio into utterances; Whisper
  large-v3-turbo (transformers.js on WebGPU, fp16 encoder + q4 decoder) transcribes them.
  Without a GPU it falls back to Whisper small on WASM.
- **Browser trace** — a content script records clicks, hover, focus, route changes, console
  errors and network requests, with stable selectors and element geometry. On React dev
  builds it also resolves the source file and component.
- **Correlator** — this is the core, written in Rust and compiled to WebAssembly. It is not a
  timestamp join: people speak *after* they see something, so it scores the elements you
  interacted with going backwards in time, weighs hover, clicks and focus, and understands
  Spanish deixis (*"este"* = this, *"acá"* = here, *"la sección de arriba"* = the section
  above). When in doubt it anchors to the route instead of making up an element.
- **Report** — Markdown with one section per issue (category, severity, confidence, anchor,
  evidence) plus cropped screenshots. Sessions are stored in IndexedDB.

## Measured, not promised

QUA started as a native Rust daemon running whisper.cpp. Before replacing it with a
browser-only extension, I measured both on the same real sessions:

| What | Result |
|---|---|
| Transcription difference vs. whisper.cpp | **1.0 %** of words |
| Report issues | **the same 7**, with the same anchors |
| Processing 153 s of audio | **77 s** on GPU |
| From clicking *Record* to the first audio frame | **~200 ms** |

Methodology and every run are in [`docs/DECISIONS.md`](docs/DECISIONS.md) (section L1).

## What it looks like

One mark drives the whole UI: the ring. It spins while the mic opens, pulses with your voice
while recording, fills up while processing and shows one dot per issue when it's done.

<p><img src="docs/ejemplos/popup-estados.png" alt="Popup recording, dropping a mark, ready, and session history" width="100%"></p>

- **Popup** — record, drop a mark, stop, copy or download the report. The history (clock
  button) lists saved sessions and their issues.
- **On the page** — while recording, a floating pill shows the time, the mic level and the
  mark/stop buttons. Drag it to any corner; its clicks never end up in the report.

  <img src="docs/ejemplos/pastilla.png" alt="Recording pill on the page" width="330">
- **Toolbar icon** — the same ring, drawn per state (red dot while recording, fills while
  processing, issue count on the badge when done). A notification with **Copy report**
  arrives when it finishes.
- **Report viewer** — session timeline, filters by type, screenshots and per-issue copy.

  <img src="docs/ejemplos/reporte.png" alt="Report viewer" width="100%">
- **First run** — four steps that detect themselves (mic permission, voice model, pin to
  toolbar, shortcuts).

  <img src="docs/ejemplos/primera-vez.png" alt="First run" width="100%">
- **Settings** — mic picker with a level test, model, shortcuts, storage used and session
  cleanup.

## Install

**From source** (Chrome Web Store listing in progress):

```bash
pnpm install
pnpm --filter @qua/extension run build:wasm   # Rust correlator → WebAssembly (needs Rust + wasm-pack)
pnpm --filter @qua/extension run build        # → extension/build/chrome-mv3
```

Then open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick
`extension/build/chrome-mv3`.

Requirements: Node 26, pnpm 10, Rust with `wasm-pack`, and a recent Chrome. WebGPU is
strongly recommended.

## Usage

1. The first run opens by itself: mic permission, voice model (~1 GB, downloaded once from
   Hugging Face and cached), pin to toolbar, shortcuts.
2. Open the page you want to review, click the ring in the popup (or press `Ctrl+Shift+1`
   from any app) and talk about what you see. **Mark** (`Ctrl+Shift+2`) pins a precise moment.
3. **Stop** from the popup or the pill. When processing finishes you get a notification, and
   the popup offers **Copy report**, **View report** and **Download**
   (`Downloads/qua/<id>/report.md` plus its screenshots).

## Privacy

- Audio, transcripts, traces and reports stay on your machine (IndexedDB and your Downloads
  folder).
- The only network request QUA makes is downloading the Whisper weights from Hugging Face the
  first time. No analytics, no telemetry, no account.
- Recording only happens while you press *Record*, and the pill is visible the whole time.

Full policy: [`PRIVACY.md`](PRIVACY.md).

## How it was built

QUA is a one-person project, built as an exercise in **orchestrating coding agents** on a
real, multi-language system:

- **v1 (daemon)** — ~26,000 lines of Rust and TypeScript (daemon, CLI, MCP server, Tauri
  tray app, Chrome extension, whisper.cpp) in 101 commits over one night. Several agents
  worked in parallel (Opus on the correlator, Sonnet and Codex on the rest) against
  **frozen contracts** — a Zod protocol mirrored in Rust and validated with golden fixtures
  on both sides — and a shared task board in [`STATE.md`](STATE.md). It shipped with an
  end-to-end test that drives real Chrome with an injected microphone.
- **v2 (extension only)** — the daemon became a burden to install, so I ported the whole
  pipeline into the browser: Whisper on WebGPU, Silero on onnxruntime-web, and the Rust
  correlator compiled to WASM. I only switched after measuring it (table above).
- **v0.2 (UI)** — the UI was redesigned in Penpot and then implemented, fixing four real bugs
  along the way (content script timing, a blocked IndexedDB migration, stuck sessions and a
  service worker race). 219 tests plus an E2E in real Chrome.

Every non-obvious decision is written down with its reasoning in
[`docs/DECISIONS.md`](docs/DECISIONS.md); the full spec is in [`docs/SPEC.md`](docs/SPEC.md).

## Limitations

- **Spanish first.** Whisper transcribes many languages, but the UI, the report labels and the
  deixis rules are in Spanish. English is the next step.
- **Chrome only** (Manifest V3, WebGPU, global shortcuts).
- Without WebGPU it uses Whisper small on the CPU: ~3× the audio length to process and
  slightly worse transcription (2.6 % difference).
- The first run downloads ~1 GB of model weights.

## Repository layout

```
extension/               WXT + TypeScript (MV3) — the product
crates/
  qua-core/              correlator and report renderer (shared by the extension and the daemon)
  qua-wasm/              qua-core compiled to WebAssembly
  qua-protocol/          Rust mirror of the protocol, tested against the fixtures
packages/
  protocol/              TS + Zod — source of truth for every type
  source-resolver/       React component/file resolution
  babel-plugin-source/,
  vite-plugin-source/    optional plugins that tag elements with their source location
fixtures/                golden sessions — the shared TS ↔ Rust contract
e2e/                     real sessions in real Chrome
crates/quad, qua-mcp,
apps/qua-app, packaging/ v1 daemon, MCP server and Tauri app (see docs/DAEMON.md)
```

The original daemon architecture (Rust daemon + CLI + MCP server + Tauri app) still lives in
the repo and is documented in [`docs/DAEMON.md`](docs/DAEMON.md).

## Development

```bash
pnpm install
pnpm test                                     # typecheck + vitest, including golden fixtures
pnpm --filter @qua/extension run build:wasm   # rebuild the WASM after touching crates/qua-core
node e2e/local.e2e.mjs                        # full session in real Chrome
```

## Author

Built by **Gabriel Funes** — AI-focused full-stack engineer from Argentina.
[LinkedIn](https://www.linkedin.com/in/gabriel-funes-developer) · [GitHub](https://github.com/Gabriel100201)

## License

[MIT](./LICENSE)
