/**
 * Emite los JSON Schema de `@qua/protocol` a `fixtures/schema/`.
 *
 * Se corre con `pnpm gen:schema`. La salida está commiteada: el CI la regenera y
 * falla si quedó desactualizada, así nadie cambia un tipo sin actualizar el contrato.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import { ClientMessageSchema, ServerMessageSchema } from "../src/messages.js";
import {
  HealthResponseSchema,
  PairRequestSchema,
  PairResponseSchema,
} from "../src/messages.js";
import { EventSchema } from "../src/event.js";
import { IssueSchema } from "../src/issue.js";
import { SessionSchema } from "../src/session.js";
import { TargetRefSchema } from "../src/target.js";
import { UtteranceSchema } from "../src/utterance.js";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "../../../fixtures/schema");

const schemas = {
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
} satisfies Record<string, z.ZodType>;

mkdirSync(outDir, { recursive: true });
for (const stale of readdirSync(outDir).filter((f) => f.endsWith(".schema.json"))) {
  rmSync(join(outDir, stale));
}

for (const [name, schema] of Object.entries(schemas)) {
  const json = z.toJSONSchema(schema, { target: "draft-2020-12", io: "output" });
  const doc = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `https://qua.local/schema/${name}.schema.json`,
    ...json,
  };
  const path = join(outDir, `${name}.schema.json`);
  writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  console.log(`✓ ${path}`);
}

console.log(`\n${Object.keys(schemas).length} esquemas escritos en ${outDir}`);
