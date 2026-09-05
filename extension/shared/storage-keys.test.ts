import { describe, expect, it } from "vitest";
import { TOKEN_STORAGE_KEY } from "./storage-keys.js";
import { PAIR_TOKEN_STORAGE_KEY } from "../entrypoints/options/lib/pairing.js";

describe("claves de storage compartidas", () => {
  it("el service worker y la página de opciones usan LA MISMA clave para el token", () => {
    // Regresión: options escribía "quaPairToken" y el SW leía "qua:daemon-token".
    // El emparejamiento funcionaba pero la sesión nunca podía arrancar.
    expect(PAIR_TOKEN_STORAGE_KEY).toBe(TOKEN_STORAGE_KEY);
  });
});
