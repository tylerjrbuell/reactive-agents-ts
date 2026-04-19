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
   * The Effect fiber inside Stream.toAsyncIterable() blocks for 200ms (delayMs).
   * We abort() after 50ms. Without fiber interruption the stream waits the full
   * 200ms and emits StreamCompleted. With the fix it emits StreamCancelled ~50ms
   * in and the test finishes quickly.
   */
  it("mid-stream abort interrupts the Effect fiber and emits StreamCancelled", async () => {
    const agent = await ReactiveAgents.create()
      .withName("abort-fiber-test")
      .withTestScenario([{ text: "slow response", delayMs: 500 }])
      .build();

    const ctrl = new AbortController();
    const tags: string[] = [];
    const start = Date.now();

    // Abort after 50ms — well before the 500ms delay completes
    const abortTimer = setTimeout(() => ctrl.abort(), 50);

    try {
      for await (const ev of agent.runStream("test", { signal: ctrl.signal })) {
        tags.push(ev._tag);
      }
    } finally {
      clearTimeout(abortTimer);
    }

    const elapsed = Date.now() - start;
    await agent.dispose();

    // Must emit StreamCancelled, not StreamCompleted
    expect(tags).toContain("StreamCancelled");
    expect(tags).not.toContain("StreamCompleted");

    // Must terminate well before the 500ms delay expires (< 300ms gives headroom)
    expect(elapsed).toBeLessThan(300);
  }, 10_000);

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
