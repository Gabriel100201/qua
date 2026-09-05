import type { z } from "zod";
import {
  ClientMessageSchema,
  HealthResponseSchema,
  PairRequestSchema,
  PairResponseSchema,
  ServerMessageSchema,
} from "./messages.js";
import { SessionSchema } from "./session.js";

/**
 * Mapa fixture → esquema que la valida.
 *
 * Es el contrato compartido: el test de TS y el de Rust recorren esta misma lista
 * (Rust la tiene espejada en `crates/qua-protocol/tests/fixtures.rs`) y los dos tienen
 * que aceptar exactamente los mismos archivos.
 *
 * Las rutas son relativas a la raíz del repo.
 */
export const FIXTURE_MANIFEST = [
  { path: "fixtures/session-minimal.json", kind: "session" },
  { path: "fixtures/session-full.json", kind: "session" },
  { path: "fixtures/messages/client-hello.json", kind: "client-message" },
  { path: "fixtures/messages/client-session-start.json", kind: "client-message" },
  { path: "fixtures/messages/client-events.json", kind: "client-message" },
  { path: "fixtures/messages/client-mark.json", kind: "client-message" },
  { path: "fixtures/messages/client-frame.json", kind: "client-message" },
  { path: "fixtures/messages/client-session-stop.json", kind: "client-message" },
  { path: "fixtures/messages/client-ping.json", kind: "client-message" },
  { path: "fixtures/messages/server-hello-ok.json", kind: "server-message" },
  { path: "fixtures/messages/server-ack.json", kind: "server-message" },
  { path: "fixtures/messages/server-transcript-partial.json", kind: "server-message" },
  { path: "fixtures/messages/server-capture-request.json", kind: "server-message" },
  { path: "fixtures/messages/server-session-done.json", kind: "server-message" },
  { path: "fixtures/messages/server-error.json", kind: "server-message" },
  { path: "fixtures/messages/http-pair-request.json", kind: "pair-request" },
  { path: "fixtures/messages/http-pair-response.json", kind: "pair-response" },
  { path: "fixtures/messages/http-health-response.json", kind: "health-response" },
] as const satisfies ReadonlyArray<{ path: string; kind: FixtureKind }>;

export type FixtureKind =
  | "session"
  | "client-message"
  | "server-message"
  | "pair-request"
  | "pair-response"
  | "health-response";

export const FIXTURE_SCHEMAS: Record<FixtureKind, z.ZodType> = {
  session: SessionSchema,
  "client-message": ClientMessageSchema,
  "server-message": ServerMessageSchema,
  "pair-request": PairRequestSchema,
  "pair-response": PairResponseSchema,
  "health-response": HealthResponseSchema,
};
