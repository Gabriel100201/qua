import { describe, expect, it } from "vitest";
import { angleFor, bigRing, miniRing, spreadAngles } from "./ring.js";
import { bytes, clock, duration, isRecordable, place, when } from "./format.js";
import { icon } from "./icons.js";

describe("anillo", () => {
  it("cada estado tiene su forma", () => {
    expect(bigRing("recording")).toContain("#E0352B");
    expect(bigRing("opening")).toContain("qua-spin");
    expect(bigRing("error")).toContain("#E0352B");
    expect(bigRing("idle")).not.toContain("#E0352B");
    expect(bigRing("ready", { issues: [10, 20, 30] }).match(/qua-issue/g)).toHaveLength(3);
  });
  it("el progreso del procesamiento avanza dentro del tramo de su etapa", () => {
    const a = bigRing("processing", { stage: 1, progress: 0 });
    const b = bigRing("processing", { stage: 1, progress: 0.5 });
    expect(a).not.toBe(b);
  });
  it("el anillo chico dibuja como mucho 12 puntos", () => {
    expect(miniRing("ready", 28, { n: 30 }).match(/<circle/g)!.length).toBe(13);
  });
  it("los momentos de la sesión son una vuelta entera", () => {
    expect(angleFor(0, 100)).toBe(0);
    expect(angleFor(50, 100)).toBe(180);
    expect(angleFor(200, 100)).toBe(0);
  });
  it("separa puntos encimados", () => {
    expect(spreadAngles([10, 12, 13])).toEqual([10, 24, 38]);
  });
});

describe("formatos", () => {
  it("reloj, duración y bytes", () => {
    expect(clock(161_000)).toBe("02:41");
    expect(clock(3_761_000)).toBe("1:02:41");
    expect(duration(25_000)).toBe("25 s");
    expect(duration(161_000)).toBe("2 min 41 s");
    expect(bytes(1_000_000_000)).toBe("1,0 GB");
    expect(bytes(38_000_000)).toBe("38 MB");
  });
  it("lugar legible y si Chrome deja grabar", () => {
    expect(place("https://pediloapp.com/admin/?x=1")).toBe("pediloapp.com/admin");
    expect(place("http://localhost:3000/")).toBe("localhost:3000");
    expect(place("chrome-extension://abc/report.html?id=1")).toBe("QUA");
    expect(isRecordable("https://x.com")).toBe(true);
    expect(isRecordable("chrome://extensions")).toBe(false);
    expect(isRecordable("https://chromewebstore.google.com/detail/x")).toBe(false);
  });
  it("cuándo", () => {
    const now = new Date(2026, 9, 14, 22, 0).getTime();
    expect(when(new Date(2026, 9, 14, 21, 44).getTime(), now)).toBe("Hoy, 21:44");
    expect(when(new Date(2026, 9, 13, 18, 51).getTime(), now)).toBe("Ayer, 18:51");
  });
  it("íconos con el color del texto", () => {
    expect(icon("mic")).toContain('stroke="currentColor"');
  });
});
