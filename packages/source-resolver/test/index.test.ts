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
  it("normalizes webpack-internal project-relative frames", () => {
    const f = { _debugStack: { stack: "Error\n at render (webpack-internal:///./src/Page.tsx:8:3)" } };
    expect(sourceFromStack(f)).toEqual({ file: "src/Page.tsx", line: 8, col: 3, tier: 2 });
  });
  it("skips several framework frames and finds the first user frame", () => {
    const frames = ["node_modules/react/c.js", "node_modules/react-dom/d.js", "next/server.js", "turbopack:///[project]/src/Real.tsx"];
    const stack = "Error\n" + frames.map((file, i) => ` at f (${file}:10:2)`).join("\n");
    expect(sourceFromStack({ _debugStack: { stack } })).toMatchObject({ file: "src/Real.tsx", line: 10, col: 2, tier: 2 });
  });
  it("degrades when every stack frame is internal", () => {
    const f = { _debugStack: { stack: "Error\n at a (webpack-internal:///./node_modules/react-dom/a.js:1:1)\n at b (webpack-internal:///./next/x.js:2:2)" }, type: { name: "Button" } };
    expect(resolveSource({ __reactFiber$x: f })).toMatchObject({ source: null, component: ["Button"] });
  });
  it("degrades to tier 3 component chain when stack is absent", () => {
    const f = { type: { name: "Button" }, _debugOwner: { type: { displayName: "App" } } };
    expect(resolveSource({ __reactFiber$x: f }).source).toBeNull();
    expect(resolveSource({ __reactFiber$x: f }).component).toEqual(["App", "Button"]);
  });
  it("returns empty tier 4 fallback when React metadata is absent", () => expect(resolveSource({}).component).toEqual([]));
  it("limits component chains to max entries", () => {
    let f: any = { type: { name: "One" } };
    for (const name of ["Two", "Three", "Four", "Five", "Six"]) f = { type: { name }, _debugOwner: f };
    expect(componentChain(f, 4)).toEqual(["Three", "Four", "Five", "Six"]);
  });
});
