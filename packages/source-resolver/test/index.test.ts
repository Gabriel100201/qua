import { describe, expect, it } from "vitest";
import { componentChain, fiberOf, resolveSource, sourceFromStack } from "../src/index.js";

describe("React 19 source cascade", () => {
  it("finds fiber and tier 1 DOM metadata", () => {
    const el = { getAttribute: (name: string) => name === "data-qua-src" ? "src/App.tsx:4:8" : null, __reactFiber$x: {} };
    expect(fiberOf(el)).toBe(el.__reactFiber$x);
    expect(resolveSource(el).source).toEqual({ file: "src/App.tsx", line: 4, col: 8, tier: 1 });
  });
  it("parses turbopack and skips framework frames", () => {
    const f = { _debugStack: { stack: "Error\n at x (webpack-internal:///[project]/node_modules/react-dom/x.js:1:2)\n at y (turbopack:///[project]/src/Button.tsx:21:9)" } };
    expect(sourceFromStack(f)).toEqual({ file: "src/Button.tsx", line: 21, col: 9, tier: 2 });
  });
  it("degrades to tier 3 component chain when stack is absent", () => {
    const f = { type: { name: "Button" }, _debugOwner: { type: { displayName: "App" } } };
    expect(resolveSource({ __reactFiber$x: f }).source).toBeNull();
    expect(resolveSource({ __reactFiber$x: f }).component).toEqual(["App", "Button"]);
  });
  it("returns empty tier 4 fallback when React metadata is absent", () => expect(resolveSource({}).component).toEqual([]));
});
