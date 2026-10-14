import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Mismos alias que `tsconfig.json`: contra el fuente TS, no contra `dist/`, para no
// depender del orden de build. Ver el comentario de ahí.
const src = (p: string) => fileURLToPath(new URL(`../packages/${p}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@qua/protocol": src("protocol"),
      "@qua/source-resolver": src("source-resolver"),
    },
  },
  test: {
    environment: "jsdom",
    include: ["entrypoints/**/*.test.ts", "shared/**/*.test.ts", "test/**/*.test.ts"],
  },
});
