import { describe, expect, it, vi } from "vitest";
import { createScoreRecorder, transcribeSession, type AsrOutput } from "./transcribe.js";

function logits(values: number[]) {
  return { data: Float32Array.from(values), dims: [1, values.length] };
}

describe("createScoreRecorder", () => {
  it("promedia el log-prob del token elegido sin contar el EOT final", () => {
    const rec = createScoreRecorder();
    // Dos tokens de texto con p=0.5 cada uno y un EOT seguro que no cuenta.
    rec.processor(null, logits([0, 0, -Infinity]));
    rec.processor(null, logits([0, 0, -Infinity]));
    rec.processor(null, logits([100, 0, 0]));
    expect(rec.result().avgLogprob).toBeCloseTo(Math.log(0.5), 6);
  });

  it("toma no_speech_prob del primer paso", () => {
    const rec = createScoreRecorder(1);
    rec.processor(null, logits([0, Math.log(3)])); // p(nospeech) = 3/4
    rec.processor(null, logits([0, 50]));
    expect(rec.result().noSpeechProb).toBeCloseTo(0.75, 6);
  });

  it("un token suprimido (-inf) da no_speech_prob 0", () => {
    const rec = createScoreRecorder(1);
    rec.processor(null, logits([0, -Infinity]));
    expect(rec.result().noSpeechProb).toBe(0);
  });

  it("devuelve los mismos logits (no los modifica)", () => {
    const rec = createScoreRecorder();
    const l = logits([1, 2, 3]);
    expect(rec.processor(null, l)).toBe(l);
  });
});

describe("transcribeSession", () => {
  it("transcribe cada segmento del VAD con su offset y numera las utterances", async () => {
    const pcm = new Int16Array(16000 * 4);
    const segments = [
      { t_offset_ms: 500, start_sample: 8000, len: 16000 },
      { t_offset_ms: 2500, start_sample: 40000, len: 8000 },
      { t_offset_ms: 3200, start_sample: 51200, len: 4000 },
    ];
    const outputs: AsrOutput[] = [
      { text: " hola ", chunks: [{ timestamp: [0.2, 0.9], text: " hola" }] },
      { text: "   " }, // whisper no devolvió nada: se descarta
      { text: "chau", chunks: [{ timestamp: [0, null], text: "chau" }] },
    ];
    const asr = vi.fn(async () => outputs.shift()!);
    const segment = vi.fn(() => JSON.stringify(segments));

    const out = await transcribeSession(pcm, { vadProbabilities: async () => new Float32Array(3), segment, asr });

    expect(out.map((u) => [u.id, u.text, u.t_start, u.t_end])).toEqual([
      // t_end = fin del segmento del VAD (1500 y 3450), igual que whisper.cpp en quad.
      ["u01", "hola", 700, 1500],
      ["u02", "chau", 3200, 3450],
    ]);
    expect(asr).toHaveBeenCalledTimes(3);
    const [audio, opts] = asr.mock.calls[0]! as unknown as [Float32Array, Record<string, unknown>];
    expect(audio.length).toBe(16000);
    expect(opts).toMatchObject({ language: "spanish", task: "transcribe", return_timestamps: true });
    expect(Array.isArray(opts.logits_processor)).toBe(true);
  });

  it("le pasa al segmentador el mismo PCM y las probabilidades del VAD", async () => {
    const pcm = new Int16Array(1024);
    const probs = new Float32Array([0.1, 0.9]);
    const segment = vi.fn(() => "[]");
    await transcribeSession(pcm, { vadProbabilities: async () => probs, segment, asr: vi.fn() }, { asrToml: "[asr]" });
    expect(segment).toHaveBeenCalledWith(pcm, probs, "[asr]");
  });
});
