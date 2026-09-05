import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Event } from "@qua/protocol";
import { installHooks } from "./hooks.js";

function collect() {
  const events: Event[] = [];
  return { emit: (e: Event) => events.push(e), events };
}

describe("installHooks", () => {
  let teardown: (() => void) | undefined;

  afterEach(() => {
    teardown?.();
    teardown = undefined;
    vi.restoreAllMocks();
  });

  describe("fetch", () => {
    it("net_fail cuando el status es >= 400", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
      const { emit, events } = collect();
      teardown = installHooks({ window, document }, emit);

      await window.fetch("https://x.test/api/turnos");

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ k: "net_fail", method: "GET", status: 404 });
    });

    it("net_fail con status 0 cuando la request rechaza (error de red)", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new Error("network down");
        }),
      );
      const { emit, events } = collect();
      teardown = installHooks({ window, document }, emit);

      await expect(window.fetch("https://x.test/api/turnos")).rejects.toThrow("network down");
      expect(events).toEqual([expect.objectContaining({ k: "net_fail", status: 0 })]);
    });

    it("net_slow cuando tarda > 1200 ms y el status es exitoso", async () => {
      let now = 0;
      vi.spyOn(performance, "now").mockImplementation(() => now);
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          now += 1500;
          return new Response(null, { status: 200 });
        }),
      );
      const { emit, events } = collect();
      teardown = installHooks({ window, document }, emit);

      await window.fetch("https://x.test/api/lento");

      expect(events).toEqual([expect.objectContaining({ k: "net_slow", duration_ms: 1500 })]);
    });

    it("redacta la query string a la allowlist configurada", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 500 })));
      const { emit, events } = collect();
      teardown = installHooks(
        { window, document },
        emit,
        { redaction: { redactSelectors: [], queryAllowlist: ["page"] } },
      );

      await window.fetch("https://x.test/api?page=2&token=secreto");

      const event = events[0];
      expect(event?.k).toBe("net_fail");
      const url = event && "url" in event ? event.url : "";
      expect(url).toContain("page=2");
      expect(url).not.toContain("secreto");
    });

    it("nunca deja de resolver/rechazar como el fetch original", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response("ok", { status: 200 })));
      const { emit } = collect();
      teardown = installHooks({ window, document }, emit);

      const response = await window.fetch("https://x.test/ok");
      expect(await response.text()).toBe("ok");
    });
  });

  describe("XMLHttpRequest", () => {
    it("net_fail cuando el status de la respuesta es >= 400", async () => {
      const { emit, events } = collect();
      teardown = installHooks({ window, document }, emit);

      const xhr = new XMLHttpRequest();
      const done = new Promise<void>((resolve) => xhr.addEventListener("load", () => resolve()));
      xhr.open("GET", "https://x.test/api/roto");
      Object.defineProperty(xhr, "status", { value: 500, configurable: true });
      xhr.send();
      xhr.dispatchEvent(new Event("load"));
      await done;

      expect(events).toEqual([expect.objectContaining({ k: "net_fail", method: "GET", status: 500 })]);
    });

    it("net_fail (status 0) en un evento 'error' de la XHR", async () => {
      const { emit, events } = collect();
      teardown = installHooks({ window, document }, emit);

      const xhr = new XMLHttpRequest();
      const done = new Promise<void>((resolve) => xhr.addEventListener("error", () => resolve()));
      xhr.open("POST", "https://x.test/api/timeout");
      xhr.send();
      xhr.dispatchEvent(new Event("error"));
      await done;

      expect(events).toEqual([expect.objectContaining({ k: "net_fail", method: "POST", status: 0 })]);
    });
  });

  describe("console", () => {
    it("console.error/warn emiten evento console preservando el log original", () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const { emit, events } = collect();
      teardown = installHooks({ window, document }, emit);

      console.error("algo se rompió", { detalle: 1 });

      expect(errorSpy).toHaveBeenCalledWith("algo se rompió", { detalle: 1 });
      expect(events).toEqual([expect.objectContaining({ k: "console", level: "error" })]);
    });

    it("un Error como argumento adjunta el stack", () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { emit, events } = collect();
      teardown = installHooks({ window, document }, emit);

      console.error(new Error("boom"));

      const event = events[0];
      expect(event?.k).toBe("console");
      expect(event && "stack" in event ? event.stack : undefined).toContain("boom");
    });
  });

  describe("history", () => {
    beforeEach(() => {
      window.history.replaceState(null, "", "/");
    });

    it("pushState emite nav kind=spa", () => {
      const { emit, events } = collect();
      teardown = installHooks({ window, document }, emit);

      window.history.pushState({ page: 1 }, "", "/turno/5");

      expect(events).toEqual([expect.objectContaining({ k: "nav", kind: "spa" })]);
    });

    it("popstate hacia un índice mayor se etiqueta forward, hacia uno menor back", () => {
      const { emit, events } = collect();
      teardown = installHooks({ window, document }, emit);

      window.history.pushState({}, "", "/a");
      window.history.pushState({}, "", "/b");

      const [, pushA, pushB] = events;
      const stateAfterA = pushA && pushA.k === "nav" ? window.history.state : undefined;
      void stateAfterA;

      // Simula volver a "/a" y después ir de nuevo a "/b".
      window.dispatchEvent(new PopStateEvent("popstate", { state: { __quaNavIdx: 1 } }));
      window.dispatchEvent(new PopStateEvent("popstate", { state: { __quaNavIdx: 2 } }));

      const navs = events.filter((e) => e.k === "nav") as Array<Extract<Event, { k: "nav" }>>;
      expect(navs.at(-2)?.kind).toBe("back");
      expect(navs.at(-1)?.kind).toBe("forward");
      void pushB;
    });
  });
});
