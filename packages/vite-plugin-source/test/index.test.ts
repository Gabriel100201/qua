import { expect, it } from "vitest";
import plugin from "../src/index.js";
it("stamps JSX only in dev", () => { const result = plugin({ dev: true }).transform("const x = <Button />", "src/A.tsx"); expect(result?.code).toContain('data-qua-src="src/A.tsx:1:11"'); expect(plugin({ dev: false }).transform("const x = <Button />", "src/A.tsx")).toBeNull(); });
