import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { LocalStore, type LocalSessionMeta } from "./store.js";

let n = 0;
const fresh = () => new LocalStore(`qua-local-test-${++n}`);
const meta = (id: string, t0: number): LocalSessionMeta => ({
  id,
  t0_wall: t0,
  started_at: "",
  base_url: "https://x/",
  env: { ua: "", chrome: "", platform: "", viewport: { w: 1, h: 1, dpr: 1 }, ext: "" },
});

describe("LocalStore", () => {
  it("devuelve los eventos de cada sesión en orden de llegada", async () => {
    const store = fresh();
    await store.appendEvents("a", [{ t: 1, k: "mark", source: "hotkey" }]);
    await store.appendEvents("b", [{ t: 9, k: "mark", source: "hotkey" }]);
    await store.appendEvents("a", [{ t: 2, k: "mark", source: "popup" }]);
    expect((await store.events("a")).map((e) => e.t)).toEqual([1, 2]);
    await store.dropEvents("a");
    expect(await store.events("a")).toEqual([]);
    expect(await store.events("b")).toHaveLength(1);
  });

  it("latestSession es la de t0 más reciente y updateSession hace merge", async () => {
    const store = fresh();
    await store.putSession({ id: "vieja", meta: meta("vieja", 10), status: "ready" });
    await store.putSession({ id: "nueva", meta: meta("nueva", 20), status: "recording" });
    await store.updateSession("nueva", { status: "processing", progress: { stage: "voz", done: 1, total: 2 } });
    const latest = await store.latestSession();
    expect(latest?.id).toBe("nueva");
    expect(latest?.status).toBe("processing");
    expect(latest?.meta.t0_wall).toBe(20);
    expect(await store.updateSession("no-existe", { status: "ready" })).toBeUndefined();
  });

  it("guarda las capturas por sesión", async () => {
    const store = fresh();
    await store.putAsset("a", "i01.png", new Uint8Array([1, 2]));
    await store.putAsset("b", "i01.png", new Uint8Array([3]));
    const assets = await store.assets("a");
    expect(assets.map((a) => [a.name, Array.from(a.bytes)])).toEqual([["i01.png", [1, 2]]]);
  });
});
