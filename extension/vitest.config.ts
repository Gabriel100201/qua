import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Mismo alias que `tsconfig.json`: resolvemos `@qua/protocol` contra el fuente
// TS para no depender de que el paquete esté construido antes de los tests.
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
