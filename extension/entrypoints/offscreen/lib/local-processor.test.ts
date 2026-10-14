import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { LocalStore } from "../../../shared/local/store.js";
import { processLocalSession, readFramesFromRing } from "./local-processor.js";
import type { QuaWasm } from "../../../shared/local/process.js";

let n = 0;
async function seeded() {
  const store = new LocalStore(`qua-local-proc-${++n}`);
  await store.putSession({
    id: "s1",
    status: "processing",
    meta: {
      id: "s1",
      t0_wall: 1000,
      started_at: "",
      base_url: "https://x/",
      env: { ua: "", chrome: "", platform: "", viewport: { w: 1, h: 1, dpr: 1 }, ext: "" },
    },
  });
  await store.appendEvents("s1", [{ t: 1100, k: "mark", source: "hotkey" }]);
  return store;
}

const wasm: QuaWasm = {
  finalize: (json) => {
    const input = JSON.parse(json);
    return JSON.stringify({ session: { env: { viewport: { dpr: 1 } }, issues: [], events: input.events }, captures: [] });
  },
  render: () => JSON.stringify({ report_md: "# QUA — x", issues_json: "[]", transcript: "t" }),
  crop: () => new Uint8Array(),
};

describe("processLocalSession", () => {
  it("transcribe, correlaciona y deja el reporte listo en IndexedDB", async () => {
    const store = await seeded();
    const transcribe = vi.fn(async () => []);
    await processLocalSession(
      { store, loadWasm: async () => wasm, transcribe, readFrames: async () => [], onModelState: () => undefined },
      "s1",
      new Int16Array(160),
      2000,
      "fin",
    );
    const s = await store.getSession("s1");
    expect(s?.status).toBe("ready");
    expect(s?.report_md).toBe("# QUA — x");
    expect(JSON.parse(s!.session_json!).events).toHaveLength(1);
    expect(transcribe).toHaveBeenCalledOnce();
    expect(await store.events("s1")).toEqual([]); // ya quedaron dentro de session_json
  });

  it("sin audio no llama a whisper, pero igual arma el reporte de eventos", async () => {
    const store = await seeded();
    const transcribe = vi.fn(async () => []);
    await processLocalSession(
      { store, loadWasm: async () => wasm, transcribe, readFrames: async () => [], onModelState: () => undefined },
      "s1",
      new Int16Array(0),
      2000,
      "fin",
    );
    expect(transcribe).not.toHaveBeenCalled();
    expect((await store.getSession("s1"))?.status).toBe("ready");
  });

  it("si algo falla, la sesión queda en failed con el motivo", async () => {
    const store = await seeded();
    await expect(
      processLocalSession(
        {
          store,
          loadWasm: async () => wasm,
          transcribe: async () => {
            throw new Error("sin WebGPU ni WASM");
          },
          readFrames: async () => [],
          onModelState: () => undefined,
        },
        "s1",
        new Int16Array(16),
        2000,
        "fin",
      ),
    ).rejects.toThrow("sin WebGPU ni WASM");
    const s = await store.getSession("s1");
    expect(s?.status).toBe("failed");
    expect(s?.error).toContain("sin WebGPU ni WASM");
  });
});

describe("readFramesFromRing", () => {
  it("no crea la base del ring si todavía no existe", async () => {
    expect(await readFramesFromRing(0, 10)).toEqual([]);
    const dbs = await indexedDB.databases();
    expect(dbs.some((d) => d.name === "qua-screenshots")).toBe(false);
  });
});
