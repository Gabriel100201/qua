import { z } from "zod";
import { SCHEMA_SESSION } from "./constants.js";
import { EventSchema } from "./event.js";
import { IssueSchema } from "./issue.js";
import { UtteranceSchema } from "./utterance.js";

/** Id de sesión: ISO compacto + 4 hex. `2026-09-04T14-32-11Z-a3f9`. */
export const SessionIdSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z-[0-9a-f]{4}$/, {
    message: "Formato esperado: 2026-09-04T14-32-11Z-a3f9",
  })
  .meta({ id: "SessionId" });

export const SessionStatusSchema = z
  .enum(["recording", "processing", "ready", "failed"])
  .meta({ id: "SessionStatus" });

export type SessionStatus = z.infer<typeof SessionStatusSchema>;

/** Proyecto de `config.toml` al que se atribuyó la sesión (§13). */
export const ProjectRefSchema = z
  .object({
    label: z.string(),
    repo: z.string().optional(),
  })
  .meta({ id: "ProjectRef" });

export type ProjectRef = z.infer<typeof ProjectRefSchema>;

/** Estado del repo al arrancar la sesión, leído con git2. */
export const GitInfoSchema = z
  .object({
    branch: z.string(),
    sha: z.string(),
    dirty: z.boolean(),
  })
  .meta({ id: "GitInfo" });

export type GitInfo = z.infer<typeof GitInfoSchema>;

export const ViewportInfoSchema = z
  .object({
    w: z.int().positive(),
    h: z.int().positive(),
    dpr: z.number().positive(),
  })
  .meta({ id: "ViewportInfo" });

export type ViewportInfo = z.infer<typeof ViewportInfoSchema>;

/** Entorno del navegador. Se manda una vez, en `session.start`. */
export const EnvInfoSchema = z
  .object({
    ua: z.string(),
    chrome: z.string(),
    platform: z.string(),
    viewport: ViewportInfoSchema,
    /** Versión de la extensión. */
    ext: z.string(),
  })
  .meta({ id: "EnvInfo" });

export type EnvInfo = z.infer<typeof EnvInfoSchema>;

export const AudioInfoSchema = z
  .object({
    /** Relativa al directorio de la sesión. */
    path: z.string(),
    sample_rate: z.int().positive(),
    /** Suma de las duraciones de los eventos `audio_gap`. */
    gaps_ms: z.int().nonnegative(),
  })
  .meta({ id: "AudioInfo" });

export type AudioInfo = z.infer<typeof AudioInfoSchema>;

export const SessionStatsSchema = z
  .object({
    /** Eventos que emitió el content script. */
    events_raw: z.int().nonnegative(),
    /** Eventos que sobrevivieron el filtrado y quedaron en `session.json`. */
    events_kept: z.int().nonnegative(),
    utterances: z.int().nonnegative(),
    issues: z.int().nonnegative(),
  })
  .meta({ id: "SessionStats" });

export type SessionStats = z.infer<typeof SessionStatsSchema>;

/** Pestaña vista durante la sesión, con su ventana de actividad. */
export const TabInfoSchema = z
  .object({
    tab: z.int(),
    url: z.string(),
    title: z.string(),
    first_ms: z.int(),
    last_ms: z.int(),
  })
  .meta({ id: "TabInfo" });

export type TabInfo = z.infer<typeof TabInfoSchema>;

/**
 * La sesión completa: `session.json` (§8.2).
 *
 * `ended_at` y `duration_ms` faltan mientras `status === "recording"`; ver
 * `docs/DECISIONS.md` (D-02).
 */
export const SessionSchema = z
  .object({
    schema: z.literal(SCHEMA_SESSION),
    id: SessionIdSchema,
    status: SessionStatusSchema,
    /** `performance.timeOrigin + performance.now()` del `session.start`, en ms epoch. */
    t0_wall: z.int(),
    started_at: z.iso.datetime(),
    ended_at: z.iso.datetime().optional(),
    duration_ms: z.int().nonnegative().optional(),
    project: ProjectRefSchema,
    git: GitInfoSchema.optional(),
    env: EnvInfoSchema,
    audio: AudioInfoSchema,
    stats: SessionStatsSchema,
    tabs: z.array(TabInfoSchema),
    events: z.array(EventSchema),
    utterances: z.array(UtteranceSchema),
    issues: z.array(IssueSchema),
  })
  .meta({ id: "Session", title: "Session" });

export type Session = z.infer<typeof SessionSchema>;
