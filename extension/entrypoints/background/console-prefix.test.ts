import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * D-U2-01 (docs/DECISIONS.md): sin el prefijo `[qua]` no hay forma de filtrar los
 * logs de la extensión en `chrome://serviceworker-internals` en medio del ruido de
 * la página. Regla simple: todo `console.warn`/`console.error` del service worker
 * arranca con `"[qua] ..."`. Este test escanea el código fuente en vez de confiar en
 * que alguien se acuerde — así falla solo si alguien agrega un log sin el prefijo.
 */
function backgroundSourceFiles(): string[] {
  return readdirSync(HERE)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => join(HERE, f));
}

describe("service worker: console.warn/error siempre con prefijo [qua]", () => {
  it("todo console.warn(...)/console.error(...) en extension/entrypoints/background arranca con '[qua] '", () => {
    const offenders: string[] = [];
    const callRegex = /console\.(warn|error)\(\s*(["'`])(.*?)\2/g;

    for (const file of backgroundSourceFiles()) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(callRegex)) {
        const [, level, , message] = match;
        if (!(message ?? "").startsWith("[qua] ")) {
          offenders.push(`${file}: console.${level}("${message}")`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("sanity: el regex sí encuentra los console.warn conocidos de session-manager.ts", () => {
    const source = readFileSync(join(HERE, "session-manager.ts"), "utf8");
    const matches = [...source.matchAll(/console\.(warn|error)\(/g)];
    expect(matches.length).toBeGreaterThan(0);
  });
});
