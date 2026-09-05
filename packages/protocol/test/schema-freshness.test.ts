/**
 * Los JSON Schema de `fixtures/schema/` están commiteados. Este test falla si alguien
 * cambia un tipo y no corre `pnpm gen:schema`, así el contrato publicado nunca queda viejo.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { EventSchema } from "../src/event.js";
import { IssueSchema } from "../src/issue.js";
import {
  ClientMessageSchema,
  HealthResponseSchema,
  PairRequestSchema,
  PairResponseSchema,
  ServerMessageSchema,
} from "../src/messages.js";
import { SessionSchema } from "../src/session.js";
import { TargetRefSchema } from "../src/target.js";
import { UtteranceSchema } from "../src/utterance.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

// Misma lista que `scripts/gen-schema.ts`.
const schemas: Record<string, z.ZodType> = {
  session: SessionSchema,
  event: EventSchema,
  "target-ref": TargetRefSchema,
  utterance: UtteranceSchema,
  issue: IssueSchema,
  "client-message": ClientMessageSchema,
  "server-message": ServerMessageSchema,
  "pair-request": PairRequestSchema,
  "pair-response": PairResponseSchema,
  "health-response": HealthResponseSchema,
};

describe("fixtures/schema está al día", () => {
  it.each(Object.keys(schemas))("%s.schema.json", (name) => {
    const generated = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: `https://qua.local/schema/${name}.schema.json`,
      ...z.toJSONSchema(schemas[name]!, { target: "draft-2020-12", io: "output" }),
    };
    const committed = JSON.parse(
      readFileSync(resolve(repoRoot, `fixtures/schema/${name}.schema.json`), "utf8"),
    );
    expect(
      committed,
      `fixtures/schema/${name}.schema.json quedó viejo — corré \`pnpm gen:schema\``,
    ).toEqual(generated);
  });
});
