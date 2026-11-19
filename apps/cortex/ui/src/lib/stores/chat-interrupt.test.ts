import { describe, expect, it } from "bun:test";
import { get } from "svelte/store";
import { beginInterrupt, friendlyChatError, interruptPhase, interruptTurn, unsettledNotice, whenInterruptIdle } from "./chat-interrupt.js";

describe("interrupt phase (pending Stop / Pause)", () => {
  it("enters the phase at once, drops a second press, and settles back to idle", () => {
    expect(get(interruptPhase)).toBe("idle");
    const done = beginInterrupt("stopping");
    expect(get(interruptPhase)).toBe("stopping");
    expect(beginInterrupt("stopping")).toBeNull();
    expect(beginInterrupt("pausing")).toBeNull();
    expect(get(interruptPhase)).toBe("stopping");
    done?.();
    expect(get(interruptPhase)).toBe("idle");
    const again = beginInterrupt("pausing");
    expect(get(interruptPhase)).toBe("pausing");
    again?.();
  });

  it("whenInterruptIdle resolves at once when idle, after the settle when pending, and after the bound if never settled", async () => {
    await whenInterruptIdle();
    const done = beginInterrupt("stopping")!;
    let resolved = false;
    const waiting = whenInterruptIdle(1000).then(() => (resolved = true));
    await Promise.resolve();
    expect(resolved).toBe(false);
    done();
    await waiting;
    expect(resolved).toBe(true);

    const stuck = beginInterrupt("stopping")!;
    const t0 = Date.now();
    await whenInterruptIdle(30);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(25);
    stuck();
  });
});

describe("interruptTurn (pending, settled, timed out)", () => {
  it("is pending for the whole request, then idle; a press while pending is dropped without a second request", async () => {
    let finish: (a: { ok: true; settled: boolean }) => void = () => {};
    let calls = 0;
    const request = () => {
      calls += 1;
      return new Promise<{ ok: true; settled: boolean }>((r) => (finish = r));
    };
    const first = interruptTurn("stopping", request);
    expect(get(interruptPhase)).toBe("stopping");
    expect(await interruptTurn("stopping", request)).toBeUndefined();
    expect(calls).toBe(1);
    finish({ ok: true, settled: true });
    expect(await first).toEqual({ ok: true, settled: true });
    expect(get(interruptPhase)).toBe("idle");
  });

  it("clears the phase when the request fails or comes back unsettled (never stuck on Stopping…)", async () => {
    expect(await interruptTurn("pausing", async () => ({ ok: false as const }))).toEqual({ ok: false });
    expect(get(interruptPhase)).toBe("idle");
    expect(await interruptTurn("stopping", async () => ({ ok: true as const, settled: false }))).toEqual({ ok: true, settled: false });
    expect(get(interruptPhase)).toBe("idle");
    await expect(interruptTurn("stopping", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(get(interruptPhase)).toBe("idle");
  });
});

describe("wording", () => {
  it("maps the raw busy sentence to words a person can act on, and passes other messages through", () => {
    expect(friendlyChatError("Chat session 01ABC is busy: a turn is already in flight")).toBe(
      "The previous reply is still stopping. Try again in a moment.",
    );
    expect(friendlyChatError("Turn 4 not found in session x")).toBe("Turn 4 not found in session x");
  });

  it("names Stop or Pause in the not-confirmed notice", () => {
    expect(unsettledNotice("stop").title).toContain("Stop");
    expect(unsettledNotice("pause").title).toContain("Pause");
  });
});
