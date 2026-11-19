import { afterEach, describe, expect, it } from "bun:test";
import { requestTurnPause, requestTurnStop, requestTurnStopAnswer } from "./chat-stream.js";

const originalFetch = globalThis.fetch;
const answer = (body: unknown, status = 200) => {
  globalThis.fetch = (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Stop / Pause answers carry whether the turn let go of the session", () => {
  it("Stop: settled true, explicit false (still winding down), absent (older server) counts as settled", async () => {
    answer({ stopped: true, settled: true });
    expect(await requestTurnStopAnswer("s1")).toEqual({ ok: true, stopped: true, settled: true });
    answer({ stopped: true, settled: false });
    expect(await requestTurnStopAnswer("s1")).toEqual({ ok: true, stopped: true, settled: false });
    answer({ stopped: true });
    expect(await requestTurnStopAnswer("s1")).toEqual({ ok: true, stopped: true, settled: true });
  });

  it("Stop: a refusal or a network failure is not ok; the boolean wrapper stays false", async () => {
    answer({ error: "x" }, 500);
    expect(await requestTurnStopAnswer("s1")).toEqual({ ok: false });
    globalThis.fetch = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await requestTurnStop("s1")).toBe(false);
  });

  it("Pause reports persisted and settled", async () => {
    answer({ stopped: true, persisted: true, settled: false });
    expect(await requestTurnPause("s1")).toEqual({ ok: true, stopped: true, persisted: true, settled: false });
  });
});
