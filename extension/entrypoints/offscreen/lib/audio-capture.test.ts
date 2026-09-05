import { describe, expect, it, vi } from "vitest";
import { AUDIO_FRAME } from "@qua/protocol";
import {
  AudioCapture,
  MIC_CONSTRAINTS,
  PCM_TAP_PROCESSOR_NAME,
  RECORDER_MIME_TYPE,
  type AudioCaptureCallbacks,
  type AudioCaptureDeps,
} from "./audio-capture.js";

interface FakeTrack {
  stop: ReturnType<typeof vi.fn>;
}

function fakeStream(): { stream: MediaStream; tracks: FakeTrack[] } {
  const tracks: FakeTrack[] = [{ stop: vi.fn() }];
  const stream = { getTracks: () => tracks } as unknown as MediaStream;
  return { stream, tracks };
}

function fakeCtx() {
  const addModule = vi.fn().mockResolvedValue(undefined);
  const connect = vi.fn();
  const close = vi.fn().mockResolvedValue(undefined);
  const ctx = {
    sampleRate: 16000,
    audioWorklet: { addModule },
    createMediaStreamSource: vi.fn(() => ({ connect })),
    close,
  };
  return { ctx: ctx as unknown as AudioContext, addModule, connect, close };
}

function fakeNode() {
  const postMessage = vi.fn();
  const disconnect = vi.fn();
  const node = {
    port: { onmessage: null as ((ev: MessageEvent) => void) | null, postMessage },
    disconnect,
  };
  return { node: node as unknown as AudioWorkletNode, postMessage, disconnect, raw: node };
}

function fakeRecorder() {
  const start = vi.fn();
  const stop = vi.fn();
  const recorder = {
    ondataavailable: null as ((ev: BlobEvent) => void) | null,
    start,
    stop,
    state: "inactive" as string,
  };
  return { recorder: recorder as unknown as MediaRecorder, start, stop, raw: recorder };
}

function setup(overrides: Partial<AudioCaptureDeps> = {}) {
  const { stream, tracks } = fakeStream();
  const { ctx, addModule, connect, close } = fakeCtx();
  const { node, postMessage, disconnect, raw: nodeRaw } = fakeNode();
  const { recorder, start: recStart, stop: recStop, raw: recRaw } = fakeRecorder();

  const getUserMedia = vi.fn().mockResolvedValue(stream);
  const createAudioContext = vi.fn(() => ctx);
  const createWorkletNode = vi.fn(() => node);
  const createMediaRecorder = vi.fn(() => recorder);

  const callbacks: AudioCaptureCallbacks = {
    onFrame: vi.fn(),
    onGap: vi.fn(),
    onRecordingChunk: vi.fn(),
    onError: vi.fn(),
    onStarted: vi.fn(),
  };

  const deps: AudioCaptureDeps = {
    getUserMedia,
    createAudioContext,
    createWorkletNode,
    createMediaRecorder,
    workletUrl: "worklet/pcm-tap-processor.js",
    ...overrides,
  };

  const capture = new AudioCapture(deps, callbacks);
  return {
    capture,
    callbacks,
    getUserMedia,
    createAudioContext,
    createWorkletNode,
    createMediaRecorder,
    addModule,
    connect,
    close,
    postMessage,
    disconnect,
    nodeRaw,
    recStart,
    recStop,
    recRaw,
    tracks,
  };
}

describe("AudioCapture.start — §5.4 de punta a punta", () => {
  it("pide el micrófono con las constraints exactas de §5.4", async () => {
    const s = setup();
    await s.capture.start({ t0Wall: 1000 });
    expect(s.getUserMedia).toHaveBeenCalledWith(MIC_CONSTRAINTS);
  });

  it("crea el AudioContext a 16 kHz, carga el worklet, y conecta la fuente al tap", async () => {
    const s = setup();
    await s.capture.start({ t0Wall: 1000 });

    expect(s.createAudioContext).toHaveBeenCalledTimes(1);
    expect(s.addModule).toHaveBeenCalledWith("worklet/pcm-tap-processor.js");
    expect(s.createWorkletNode).toHaveBeenCalledTimes(1);
    expect(s.connect).toHaveBeenCalledTimes(1);
  });

  it("inicializa el worklet con el offset t_ms respecto de t0Wall y el startSeq, vía postMessage", async () => {
    const s = setup();
    const before = performance.timeOrigin + performance.now();
    await s.capture.start({ t0Wall: 1000, startSeq: 7 });
    const after = performance.timeOrigin + performance.now();

    expect(s.postMessage).toHaveBeenCalledTimes(1);
    const [msg] = s.postMessage.mock.calls[0]!;
    expect(msg.type).toBe("qua:pcm-tap-init");
    expect(msg.startSeq).toBe(7);
    // startTMs = nowMs() - t0Wall, con nowMs() tomado en algún punto de start().
    expect(msg.startTMs).toBeGreaterThanOrEqual(Math.round(before - 1000) - 1);
    expect(msg.startTMs).toBeLessThanOrEqual(Math.round(after - 1000) + 1);
  });

  it("startSeq por defecto es 0", async () => {
    const s = setup();
    await s.capture.start({ t0Wall: 0 });
    const [msg] = s.postMessage.mock.calls[0]!;
    expect(msg.startSeq).toBe(0);
  });

  it("arranca el MediaRecorder opus en paralelo", async () => {
    const s = setup();
    await s.capture.start({ t0Wall: 0 });
    expect(s.createMediaRecorder).toHaveBeenCalledTimes(1);
    expect(s.recStart).toHaveBeenCalledTimes(1);
  });

  it("usa el nombre de processor y mimetype documentados en §5.4", () => {
    expect(PCM_TAP_PROCESSOR_NAME).toBe("pcm-tap");
    expect(RECORDER_MIME_TYPE).toBe("audio/webm;codecs=opus");
  });

  it("avisa onStarted al terminar de punta a punta", async () => {
    const s = setup();
    await s.capture.start({ t0Wall: 0 });
    expect(s.callbacks.onStarted).toHaveBeenCalledTimes(1);
  });

  it("relay de un chunk grabado hacia onRecordingChunk", async () => {
    const s = setup();
    await s.capture.start({ t0Wall: 0 });
    const blob = new Blob([new Uint8Array([1, 2, 3])]);
    s.recRaw.ondataavailable!({ data: blob } as BlobEvent);
    expect(s.callbacks.onRecordingChunk).toHaveBeenCalledWith(blob);
  });

  it("ignora chunks vacíos del MediaRecorder", async () => {
    const s = setup();
    await s.capture.start({ t0Wall: 0 });
    s.recRaw.ondataavailable!({ data: new Blob([]) } as BlobEvent);
    expect(s.callbacks.onRecordingChunk).not.toHaveBeenCalled();
  });
});

describe("AudioCapture — manejo de errores", () => {
  it("si getUserMedia rechaza, avisa onError y no toca AudioContext", async () => {
    const s = setup({ getUserMedia: vi.fn().mockRejectedValue(new Error("Permission denied")) });
    await s.capture.start({ t0Wall: 0 });
    expect(s.callbacks.onError).toHaveBeenCalledWith(expect.stringContaining("getUserMedia falló"));
    expect(s.createAudioContext).not.toHaveBeenCalled();
    expect(s.callbacks.onStarted).not.toHaveBeenCalled();
  });

  it("si addModule del worklet falla, suelta el micrófono y avisa onError", async () => {
    const s = setup();
    s.addModule.mockRejectedValueOnce(new Error("404"));
    await s.capture.start({ t0Wall: 0 });
    expect(s.callbacks.onError).toHaveBeenCalledWith(expect.stringContaining("AudioWorklet falló"));
    expect(s.tracks[0]!.stop).toHaveBeenCalledTimes(1);
    expect(s.callbacks.onStarted).not.toHaveBeenCalled();
  });

  it("si el MediaRecorder falla, el PCM en vivo sigue: onStarted igual se llama", async () => {
    const s = setup({
      createMediaRecorder: vi.fn(() => {
        throw new Error("mimeType no soportado");
      }),
    });
    await s.capture.start({ t0Wall: 0 });
    expect(s.callbacks.onError).toHaveBeenCalledWith(expect.stringContaining("MediaRecorder falló"));
    expect(s.callbacks.onStarted).toHaveBeenCalledTimes(1);
  });
});

describe("AudioCapture — frames del worklet y resiliencia (§04)", () => {
  it("reenvía cada frame recibido del worklet vía onFrame mientras está conectado", async () => {
    const s = setup();
    await s.capture.start({ t0Wall: 0 });
    const bytes = new Uint8Array([0xa0, 1, 2, 3]);
    s.nodeRaw.port.onmessage!({ data: { type: "qua:pcm-frame", bytes } } as MessageEvent);
    expect(s.callbacks.onFrame).toHaveBeenCalledWith(bytes);
  });

  it("ignora mensajes del worklet que no son frames pcm", async () => {
    const s = setup();
    await s.capture.start({ t0Wall: 0 });
    s.nodeRaw.port.onmessage!({ data: { type: "other" } } as MessageEvent);
    expect(s.callbacks.onFrame).not.toHaveBeenCalled();
  });

  it("bufferea en vez de emitir mientras setConnected(false), y drena en orden al reconectar", async () => {
    const s = setup();
    await s.capture.start({ t0Wall: 0 });
    s.capture.setConnected(false);

    const f1 = new Uint8Array([1]);
    const f2 = new Uint8Array([2]);
    s.nodeRaw.port.onmessage!({ data: { type: "qua:pcm-frame", bytes: f1 } } as MessageEvent);
    s.nodeRaw.port.onmessage!({ data: { type: "qua:pcm-frame", bytes: f2 } } as MessageEvent);
    expect(s.callbacks.onFrame).not.toHaveBeenCalled();

    s.capture.setConnected(true);
    expect(s.callbacks.onFrame).toHaveBeenNthCalledWith(1, f1);
    expect(s.callbacks.onFrame).toHaveBeenNthCalledWith(2, f2);
  });

  it("emite audio_gap cuando el buffer de 30 s se desborda estando desconectado", async () => {
    const s = setup();
    await s.capture.start({ t0Wall: 0 });
    s.capture.setConnected(false);

    const capacityFrames = 30_000 / AUDIO_FRAME.FRAME_MS;
    for (let i = 0; i < capacityFrames + 2; i++) {
      s.nodeRaw.port.onmessage!({
        data: { type: "qua:pcm-frame", bytes: new Uint8Array([i % 256]) },
      } as MessageEvent);
    }

    expect(s.callbacks.onGap).toHaveBeenCalledTimes(2);
    expect(s.callbacks.onGap).toHaveBeenCalledWith(AUDIO_FRAME.FRAME_MS);
  });
});

describe("AudioCapture.stop", () => {
  it("para el recorder, desconecta el worklet, suelta el mic y cierra el AudioContext", async () => {
    const s = setup();
    s.recRaw.state = "recording";
    await s.capture.start({ t0Wall: 0 });

    s.capture.stop();

    expect(s.recStop).toHaveBeenCalledTimes(1);
    expect(s.disconnect).toHaveBeenCalledTimes(1);
    expect(s.tracks[0]!.stop).toHaveBeenCalledTimes(1);
    expect(s.close).toHaveBeenCalledTimes(1);
  });

  it("no llama recorder.stop() si ya estaba inactivo", async () => {
    const s = setup();
    s.recRaw.state = "inactive";
    await s.capture.start({ t0Wall: 0 });
    s.capture.stop();
    expect(s.recStop).not.toHaveBeenCalled();
  });
});
