import { describe, expect, it } from "vitest";
import {
  DEFAULT_REDACTION_CONFIG,
  isPrivateSubtree,
  isSensitiveField,
  redactText,
  redactUrl,
  REDACTED,
} from "./redact.js";

describe("redacción (§12)", () => {
  it("marca como privado todo lo que cuelga de [data-private]", () => {
    document.body.innerHTML = `<div data-private><span id="s">secreto</span></div>`;
    const span = document.getElementById("s")!;
    expect(isPrivateSubtree(span)).toBe(true);
  });

  it("respeta selectores extra de config.toml (capture.redact_selectors)", () => {
    document.body.innerHTML = `<div class="pii"><span id="s">secreto</span></div>`;
    const span = document.getElementById("s")!;
    expect(isPrivateSubtree(span, DEFAULT_REDACTION_CONFIG)).toBe(false);
    expect(isPrivateSubtree(span, { ...DEFAULT_REDACTION_CONFIG, redactSelectors: [".pii"] })).toBe(true);
  });

  it("redactText recorta a 80 chars fuera de subárbol privado", () => {
    document.body.innerHTML = `<p id="p">${"x".repeat(120)}</p>`;
    const p = document.getElementById("p")!;
    const result = redactText(p, p.textContent!.trim());
    expect(result).toHaveLength(80);
  });

  it("redactText devuelve [redactado] bajo subárbol privado", () => {
    document.body.innerHTML = `<div data-private><p id="p">info confidencial</p></div>`;
    const p = document.getElementById("p")!;
    expect(redactText(p, "info confidencial")).toBe(REDACTED);
  });

  it("un selector inválido en redactSelectors no tira, solo se ignora", () => {
    document.body.innerHTML = `<span id="s">x</span>`;
    const span = document.getElementById("s")!;
    expect(() => isPrivateSubtree(span, { ...DEFAULT_REDACTION_CONFIG, redactSelectors: ["[[[invalido"] })).not.toThrow();
  });

  describe("isSensitiveField", () => {
    it("password siempre es sensible", () => {
      expect(isSensitiveField({ type: "password" })).toBe(true);
    });

    it("autocomplete de tarjeta es sensible", () => {
      expect(isSensitiveField({ type: "text", autocomplete: "cc-number" })).toBe(true);
    });

    it("name/type que matchea la regex de §12 es sensible", () => {
      expect(isSensitiveField({ name: "cvv" })).toBe(true);
      expect(isSensitiveField({ name: "dni_paciente" })).toBe(true);
      expect(isSensitiveField({ type: "text", name: "cbu" })).toBe(true);
    });

    it("un campo común no es sensible", () => {
      expect(isSensitiveField({ type: "email", name: "email" })).toBe(false);
    });
  });

  describe("redactUrl", () => {
    it("sin query string, la URL vuelve intacta", () => {
      expect(redactUrl("https://x.test/agenda")).toBe("https://x.test/agenda");
    });

    it("mantiene los params de la allowlist y colapsa el resto a …", () => {
      const result = redactUrl("https://x.test/api?page=2&token=abc123&sort=asc", {
        redactSelectors: [],
        queryAllowlist: ["page", "sort"],
      });
      expect(result).toContain("page=2");
      expect(result).toContain("sort=asc");
      expect(result).not.toContain("token");
      expect(result).toContain("…");
    });

    it("una URL rota nunca tira, vuelve tal cual", () => {
      expect(() => redactUrl("::::not a url")).not.toThrow();
    });
  });
});
