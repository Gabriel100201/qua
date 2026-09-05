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

// WORKAROUND temporal — ver docs/DECISIONS.md (A2-04) y el mismo alias en
// tsconfig.json: el `build` de @qua/protocol emite a dist/src/* pero su
// package.json apunta a dist/*, así que ni Node ni Vite lo resuelven.
// Mientras F0 no lo corrige, se resuelve directo contra el fuente TS.
export default defineConfig({
  resolve: {
    alias: {
      "@qua/protocol": fileURLToPath(new URL("../packages/protocol/src/index.ts", import.meta.url)),
    },
  },
  test: {
    include: ["entrypoints/**/*.test.ts"],
    environment: "node",
  },
});
