import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Ver el comentario de `tsconfig.json` (D-10 en docs/DECISIONS.md): el build
// de @qua/protocol no respeta su propio package.json todavía, así que
// resolvemos contra el fuente en vez de contra `dist/`.
const protocolSrc = fileURLToPath(new URL("../packages/protocol/src/index.ts", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@qua/protocol": protocolSrc,
    },
  },
  test: {
    environment: "jsdom",
    include: ["entrypoints/**/*.test.ts", "test/**/*.test.ts"],
  },
});
