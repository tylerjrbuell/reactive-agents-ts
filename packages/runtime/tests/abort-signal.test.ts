/**
 * TDD: AbortSignal propagation into runStream() fiber.
 *
 * Bug: The Effect stream returned by executeStream() runs inside an internal
 * fiber created by Stream.toAsyncIterable(). That fiber has no connection to
 * the AbortSignal — abort() only sets a `cancelled` boolean, which is checked
 * after each `yield event` returns. If the fiber is blocked mid-iteration
 * (e.g., waiting for a delayed LLM response), abort() has no effect until the
 * next event surfaces naturally.
 *
 * The `delayMs` field on TestTurn creates a real timing window: the LLM stream
 * sleeps before emitting, so the Effect fiber is genuinely blocked during the
 * abort() call. Without the fix the stream runs to completion and yields
 * StreamCompleted. With the fix the fiber is interrupted and StreamCancelled
 * is emitted promptly.
 */
import { describe, it, expect } from "bun:test";
import { ReactiveAgents } from "../src/builder.js";

describe("runStream AbortSignal propagation", () => {
  /**
   * PRIMARY FAILING TEST (before fix):
   * The Effect fiber blocks in the scripted LLM call (delayMs). We abort() 50ms
   * into the think phase. Without fiber interruption the stream waits out the
   * delay and emits StreamCompleted. With the fix it emits StreamCancelled
   * within milliseconds of the abort.
   */
  it("mid-stream abort interrupts the Effect fiber and emits StreamCancelled", async () => {
    // The scripted LLM call sleeps DELAY_MS. If cancellation awaited the
    // in-flight call instead of interrupting it, abort-to-end latency would be
    // about DELAY_MS - ABORT_AFTER_THINK_MS (~4,950 ms); a prompt interrupt
    // measures ~1-5 ms idle and ~50 ms on one contended CPU core.
    const DELAY_MS = 5_000;
    const ABORT_AFTER_THINK_MS = 50;

    const agent = await ReactiveAgents.create()
      .withName("abort-fiber-test")
      .withTestScenario([{ text: "slow response", delayMs: DELAY_MS }])
      .build();

    const ctrl = new AbortController();
    const tags: string[] = [];
    let abortedAt: number | undefined;
    let abortTimer: ReturnType<typeof setTimeout> | undefined;

    // Abort relative to the think phase, NOT to the start of runStream. A
    // fixed timer from the start raced the cold first run: run startup holds
    // the event loop synchronously (measured 75 ms idle, ~420 ms on one
    // contended core), so the old 50 ms timer fired at ~420 ms and the old
    // `elapsed < 300` bound failed (CI: 559 ms) while cancel latency itself
    // stayed ~50 ms. Anchoring on PhaseStarted:think ensures the scripted
    // call is in flight when abort lands.
    try {
      for await (const ev of agent.runStream("test", { signal: ctrl.signal, density: "full" })) {
        tags.push(ev._tag);
        if (ev._tag === "PhaseStarted" && ev.phase === "think" && abortTimer === undefined) {
          abortTimer = setTimeout(() => {
            abortedAt = Date.now();
            ctrl.abort();
          }, ABORT_AFTER_THINK_MS);
        }
      }
    } finally {
      clearTimeout(abortTimer);
    }

    const endedAt = Date.now();
    await agent.dispose();

    // Must emit StreamCancelled, not StreamCompleted, and never surface the
    // scripted response text (the delayed call was interrupted, not awaited).
    expect(abortedAt).toBeDefined();
    expect(tags).toContain("StreamCancelled");
    expect(tags).not.toContain("StreamCompleted");
    expect(tags).not.toContain("TextDelta");

    // Contract: cancellation does not wait for the in-flight call. The bound
    // is half the remaining scripted delay, so it separates "interrupted"
    // (tens of ms) from "awaited" (~4,950 ms) without racing startup CPU.
    expect(endedAt - (abortedAt ?? 0)).toBeLessThan(DELAY_MS / 2);
  }, 15_000);

  /**
   * SECONDARY FAILING TEST: abort fires after initial check but before the
   * inner for-await starts (post-runPromise gap). With delayMs the runPromise
   * itself takes time, so abort() fired synchronously after gen.next() will
   * be observed by a re-check after runPromise completes.
   */
  it("abort during runPromise acquisition emits StreamCancelled (post-runPromise gap)", async () => {
    const agent = await ReactiveAgents.create()
      .withName("abort-acq-test")
      .withTestScenario([{ text: "response", delayMs: 200 }])
      .build();

    const ctrl = new AbortController();
    const gen = agent.runStream("test", { signal: ctrl.signal });

    // Start pulling — generator suspends at `await this.runtime.runPromise(...)`.
    // The 200ms delay means runPromise takes real time to complete.
    const pullPromise = gen.next();

    // Abort while runPromise is in flight (after the initial signal.aborted check)
    ctrl.abort();

    const first = await pullPromise;
    const tags: string[] = [];
    if (!first.done) tags.push(first.value._tag);

    for await (const ev of gen) {
      tags.push(ev._tag);
    }
    await agent.dispose();

    // Without re-check after runPromise: ["TextDelta", "StreamCompleted"]
    // With re-check: ["StreamCancelled"]
    expect(tags).toContain("StreamCancelled");
    expect(tags).not.toContain("StreamCompleted");
  }, 10_000);

  /**
   * Sanity: already-aborted signal (must pass before AND after fix).
   */
  it("already-aborted signal yields StreamCancelled immediately", async () => {
    const agent = await ReactiveAgents.create()
      .withName("abort-prestart")
      .withTestScenario([{ text: "done" }])
      .build();

    const ctrl = new AbortController();
    ctrl.abort();

    const tags: string[] = [];
    for await (const ev of agent.runStream("test", { signal: ctrl.signal })) {
      tags.push(ev._tag);
    }
    await agent.dispose();

    expect(tags).toContain("StreamCancelled");
    expect(tags).not.toContain("StreamCompleted");
  });

  /**
   * Sanity: no signal → normal completion (must pass before AND after fix).
   */
  it("stream without signal completes with StreamCompleted", async () => {
    const agent = await ReactiveAgents.create()
      .withName("abort-nosignal")
      .withTestScenario([{ text: "hello" }])
      .build();

    const tags: string[] = [];
    for await (const ev of agent.runStream("test")) {
      tags.push(ev._tag);
    }
    await agent.dispose();

    expect(tags).toContain("StreamCompleted");
    expect(tags).not.toContain("StreamCancelled");
  });
});
