import { expect, it } from "vitest";
import plugin from "../src/index.js";
it("adds a source attribute to JSX AST nodes", () => { const attrs: unknown[] = []; const visitor = plugin({}, { dev: true }).visitor as any; visitor.JSXOpeningElement({ node: { openingElement: { attributes: attrs } }, parentPath: { node: { loc: { start: { line: 3, column: 4 } } } } }, { file: { opts: { filename: "src/A.tsx" } } }); expect(attrs).toHaveLength(1); expect((attrs[0] as any).value).toBe("src/A.tsx:3:5"); });
