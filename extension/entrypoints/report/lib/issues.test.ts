import { describe, expect, it } from "vitest";
import type { Issue } from "@qua/protocol";
import { cue, describe as describeEl, issueMd, split, stamp } from "./issues.js";

const issue = (o: Partial<Issue> & { conf?: number }): Issue => ({
  id: "i01", utterance_ids: ["u01"], t: 86_000, text: "si presiono uno me lleva al proyecto", category: "bug", severity: "high",
  anchor: { kind: "element", confidence: o.conf ?? 0.74, reason: ["click −0.7s"], url: "https://technodevs.com.ar/",
    target: { sel: "#project-gallery > a:nth-of-type(2)", strategy: "css-path", tag: "a", text: "PediloApp\nSistema de pedidos" } },
  evidence: { console: [], net: [], timings: [] }, ...o,
} as Issue);

describe("visor del reporte", () => {
  it("separa anclados y sin anclar con el umbral de report.md, en orden de tiempo", () => {
    const { anchored, unanchored } = split([issue({ id: "b", t: 9 }), issue({ id: "a", t: 1 }), issue({ id: "c", conf: 0.2 })]);
    expect(anchored.map((i) => i.id)).toEqual(["a", "b"]);
    expect(unanchored.map((i) => i.id)).toEqual(["c"]);
  });
  it("frases legibles", () => {
    expect(stamp(86_000)).toBe("01:26");
    expect(describeEl(issue({}).anchor.target!)).toBe("El enlace que dice “PediloApp Sistema de pedidos”.");
    expect(cue(issue({}))).toBe("Click, 0,7 s antes de hablar.");
  });
  it("un issue solo como markdown", () => {
    const md = issueMd(issue({}));
    expect(md).toContain("## Bug · high");
    expect(md).toContain("**Ancla** `#project-gallery > a:nth-of-type(2)`");
    expect(md).toContain("**Ruta** https://technodevs.com.ar/");
  });
});
