import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import type { Event } from "@qua/protocol";

vi.mock("wxt/browser", () => ({ browser: fakeBrowser }));

const { TabTracker } = await import("./tabs.js");
const { WsClient } = await import("./ws-client.js");
const { Outbox } = await import("./outbox.js");
const { FakeDaemon } = await import("./testing/fake-daemon.js");

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const HELLO = { ext_version: "0.1.0", chrome: "142.0", platform: "macOS 15.1" };
const SESSION = {
  t0Wall: 1_700_000_000_000,
  baseUrl: "https://agendi.app",
  env: {
    ua: "test",
    chrome: "142.0",
    platform: "macOS",
    viewport: { w: 1280, h: 800, dpr: 2 },
    ext: "0.1.0",
  },
};

/**
 * CRITERIO de A2 (§14): sesión de 10 min con 5 cambios de pestaña y el daemon caído
 * 30 s en el medio → cero eventos perdidos tras el replay.
 *
 * El reloj de la sesión (`virtualNow`, en ms desde `t0_wall`) es independiente del
 * reloj real del test: se simulan 10 minutos de eventos, pero el test corre en
 * milisegundos reales porque `flushIntervalMs`/backoff se configuran chicos —
 * son constantes, no la garantía que se está probando. La garantía real (outbox
 * en IndexedDB antes de mandar, replay por seq tras reconectar) es la misma que
 * corre con las constantes de producción del §04 (250 ms → 8 s), ya cubiertas en
 * `ws-client.test.ts`.
 */
describe("Resiliencia de sesión (§04 + §5.3): outbox + reconexión", () => {
  it("10 min, 5 cambios de pestaña, daemon caído 30s en el medio: cero eventos perdidos", async () => {
    fakeBrowser.reset();

    let virtualNow = 0;
    const now = () => virtualNow;

    const outbox = new Outbox("resilience-test-outbox");
    const daemon = new FakeDaemon({ responseDelayMs: 1 });

    const expected: Event[] = [];
    const client = new WsClient({
      url: "ws://127.0.0.1:7331/ws?token=test-token",
      hello: HELLO,
      outbox,
      now,
      createSocket: daemon.createSocket,
      flushIntervalMs: 20,
      flushBatchSize: 25,
      minBackoffMs: 5,
      maxBackoffMs: 40,
    });

    const tabs = new TabTracker((event) => {
      expected.push(event);
      client.enqueue(event);
    }, now);

    client.startSession(SESSION);
    tabs.start();
    await sleep(15); // handshake inicial

    const TOTAL_MS = 10 * 60_000; // 10 minutos de sesión
    const STEP_MS = 15_000; // un evento sintético cada 15s simulados
    const TAB_SWITCH_STEPS = new Set([4, 8, 20, 24, 36]); // 5 cambios de pestaña
    const OUTAGE_AT_STEP = 20; // a los 5 min, coincide con un cambio de pestaña
    const OUTAGE_MS = 30_000; // 30s caído, en el medio de la sesión

    let nextTabId = 1;

    for (let step = 0; step * STEP_MS <= TOTAL_MS; step++) {
      virtualNow = step * STEP_MS;

      if (step === OUTAGE_AT_STEP) {
        daemon.down();
      }

      if (TAB_SWITCH_STEPS.has(step)) {
        nextTabId += 1;
        await fakeBrowser.tabs.onActivated.trigger({ tabId: nextTabId, windowId: 1 });
      } else {
        const event: Event = { t: virtualNow, k: "long_task", duration_ms: 250 };
        expected.push(event);
        client.enqueue(event);
      }

      if (step === OUTAGE_AT_STEP) {
        // 30s caído: se sigue grabando localmente (outbox) aunque no haya WS.
        await sleep(15); // varios reintentos de backoff fallan (real time)
        expect(client.getStatus()).not.toBe("connected");
        virtualNow += OUTAGE_MS;
        daemon.up();
        await sleep(80); // que el backoff reconecte y dispare el replay
        expect(client.getStatus()).toBe("connected");
      } else {
        await sleep(1);
      }
    }

    await client.flush();
    await sleep(50); // drenar acks pendientes del último lote

    expect(daemon.allEvents()).toEqual(expected);
    expect(daemon.helloCount).toBeGreaterThanOrEqual(2); // conexión inicial + al menos una reconexión
    expect(await outbox.pending()).toEqual([]); // cero eventos sin confirmar

    tabs.stop();
  }, 20_000);
});
