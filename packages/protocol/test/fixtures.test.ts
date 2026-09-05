/**
 * EL TEST QUE DEFINE «LISTO» — lado TypeScript.
 *
 * Parsea TODAS las fixtures doradas y hace round-trip (parse → serializar → comparar).
 * `crates/qua-protocol/tests/fixtures.rs` hace exactamente lo mismo del lado Rust sobre
 * los mismos archivos. Si los dos lenguajes no aceptan lo mismo, uno de los dos falla.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { EVENT_KINDS } from "../src/constants.js";
import { FIXTURE_MANIFEST, FIXTURE_SCHEMAS } from "../src/fixtures.js";
import { SessionSchema } from "../src/session.js";
import { ANCHOR_KINDS } from "../src/constants.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function readFixture(path: string): unknown {
  return JSON.parse(readFileSync(resolve(repoRoot, path), "utf8"));
}

/** Orden canónico de claves, recursivo, para comparar sin depender del orden de serialización. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonical((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

describe("fixtures doradas", () => {
  it.each(FIXTURE_MANIFEST.map((f) => [f.path, f.kind] as const))(
    "%s parsea como %s",
    (path, kind) => {
      const raw = readFixture(path);
      const result = FIXTURE_SCHEMAS[kind].safeParse(raw);
      if (!result.success) {
        throw new Error(
          `${path} no valida:\n${JSON.stringify(result.error.issues, null, 2)}`,
        );
      }
    },
  );

  it.each(FIXTURE_MANIFEST.map((f) => [f.path, f.kind] as const))(
    "%s hace round-trip sin perder ni inventar nada",
    (path, kind) => {
      const raw = readFixture(path);
      const parsed = FIXTURE_SCHEMAS[kind].parse(raw);
      const reserialized = JSON.parse(JSON.stringify(parsed));
      expect(canonical(reserialized)).toEqual(canonical(raw));
    },
  );
});

describe("cobertura de session-full", () => {
  const session = SessionSchema.parse(readFixture("fixtures/session-full.json"));

  it("cubre los 18 tipos de evento de §03", () => {
    const seen = new Set(session.events.map((e) => e.k));
    const missing = EVENT_KINDS.filter((k) => !seen.has(k));
    expect(missing, `faltan tipos de evento: ${missing.join(", ")}`).toEqual([]);
    expect(seen.size).toBe(EVENT_KINDS.length);
  });

  it("cubre las 3 clases de anchor de §07", () => {
    const seen = new Set(session.issues.map((i) => i.anchor.kind));
    expect([...seen].sort()).toEqual([...ANCHOR_KINDS].sort());
  });

  it("los stats declarados coinciden con el contenido", () => {
    expect(session.stats.events_kept).toBe(session.events.length);
    expect(session.stats.utterances).toBe(session.utterances.length);
    expect(session.stats.issues).toBe(session.issues.length);
  });

  it("todo utterance_id de un issue existe en la sesión", () => {
    const ids = new Set(session.utterances.map((u) => u.id));
    for (const issue of session.issues) {
      for (const uid of issue.utterance_ids) {
        expect(ids.has(uid), `${issue.id} referencia ${uid}, que no existe`).toBe(true);
      }
    }
  });

  it("solo los anchors de tipo element llevan target", () => {
    for (const issue of session.issues) {
      if (issue.anchor.kind === "element") {
        expect(issue.anchor.target, `${issue.id} es element y no tiene target`).toBeDefined();
      } else {
        expect(issue.anchor.target, `${issue.id} es ${issue.anchor.kind} y trae target`).toBeUndefined();
      }
    }
  });
});

describe("rechazos", () => {
  it("rechaza un evento con `k` desconocido", () => {
    expect(
      FIXTURE_SCHEMAS["client-message"].safeParse({
        v: 1,
        type: "events",
        seq: 0,
        items: [{ t: 0, k: "telepatia" }],
      }).success,
    ).toBe(false);
  });

  it("rechaza un mensaje con `v` distinto de 1", () => {
    expect(FIXTURE_SCHEMAS["client-message"].safeParse({ v: 2, type: "ping" }).success).toBe(
      false,
    );
  });

  it("rechaza un id de sesión con formato equivocado", () => {
    const raw = readFixture("fixtures/session-minimal.json") as Record<string, unknown>;
    expect(SessionSchema.safeParse({ ...raw, id: "sesion-de-ayer" }).success).toBe(false);
  });
});
