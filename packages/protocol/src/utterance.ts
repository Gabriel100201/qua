import { z } from "zod";

/** Palabra con timestamp y probabilidad, tal como la devuelve whisper. */
export const WordSchema = z
  .object({
    /** Texto de la palabra. */
    w: z.string(),
    /** Inicio en ms desde `t0_wall`. */
    t: z.int(),
    /** Duración en ms. */
    d: z.int().nonnegative(),
    /** Probabilidad del token, 0..1. */
    p: z.number().min(0).max(1),
  })
  .meta({ id: "Word" });

export type Word = z.infer<typeof WordSchema>;

/** Segmento de habla cerrado por el VAD y transcripto por whisper (§03, §6.1). */
export const UtteranceSchema = z
  .object({
    /** `u` + 2 dígitos, correlativo dentro de la sesión: `u07`. */
    id: z.string().regex(/^u\d{2,}$/),
    t_start: z.int(),
    t_end: z.int(),
    text: z.string(),
    /** Código ISO 639-1. En la práctica siempre `es` (§6.1). */
    lang: z.string().min(2),
    words: z.array(WordSchema),
    avg_logprob: z.number(),
    no_speech_prob: z.number().min(0).max(1),
    /** Hubo un evento `mark` dentro de `[t_start, t_end]`. */
    marked: z.boolean(),
  })
  .meta({ id: "Utterance", title: "Utterance" });

export type Utterance = z.infer<typeof UtteranceSchema>;
