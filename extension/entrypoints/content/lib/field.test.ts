import { describe, expect, it } from "vitest";
import { buildFieldRef } from "./field.js";

describe("buildFieldRef (§12 — nunca lleva value)", () => {
  it("un input común da FieldRef con name/type/label", () => {
    document.body.innerHTML = `<label for="e">Email</label><input id="e" name="email" type="email" />`;
    const input = document.getElementById("e") as HTMLInputElement;
    const field = buildFieldRef(input);
    expect(field).toEqual({ name: "email", type: "email", label: "Email" });
    expect(field).not.toHaveProperty("value");
  });

  it("un input type=password devuelve null — no se emite en absoluto", () => {
    document.body.innerHTML = `<input name="password" type="password" />`;
    const input = document.querySelector("input") as HTMLInputElement;
    expect(buildFieldRef(input)).toBeNull();
  });

  it("autocomplete de tarjeta devuelve null aunque el type sea text", () => {
    document.body.innerHTML = `<input name="cc" type="text" autocomplete="cc-number" />`;
    const input = document.querySelector("input") as HTMLInputElement;
    expect(buildFieldRef(input)).toBeNull();
  });

  it("un name que matchea la regex de §12 devuelve null", () => {
    document.body.innerHTML = `<input name="cvv" type="text" />`;
    const input = document.querySelector("input") as HTMLInputElement;
    expect(buildFieldRef(input)).toBeNull();
  });
});
