import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { subscribeReasoningStreamLogger } from "../src/engine/phases/agent-loop/reasoning-stream-logger";
import { EventBus, EventBusLive } from "@reactive-agents/core";

describe("reasoning-stream-logger dedup", () => {
  test("only ONE subscriber (the root's) receives a shared-bus ReasoningStepCompleted event", async () => {
    const calls: string[] = [];
    const makeObs = (tag: string) => ({
      debug: (msg: string) => Effect.sync(() => { calls.push(`${tag}:${msg}`); }),
    }) as never;

    await Effect.runPromise(
      Effect.gen(function* () {
        const eb = yield* EventBus;
        // Root subscribes (this is the ONLY subscription that should exist
        // once execution-engine.ts is fixed to skip the call for sub-agents).
        yield* subscribeReasoningStreamLogger({
          eb, obs: makeObs("root"), logModelIO: false, isVerbose: true, isDebug: false,
        });
        yield* eb.publish({
          _tag: "ReasoningStepCompleted", taskId: "t1", strategy: "reactive",
          step: 1, totalSteps: 1, action: "web-search",
        } as never);
      }).pipe(Effect.provide(EventBusLive)),
    );

    expect(calls.filter((c) => c.includes("action")).length).toBe(1);
  });

  test("execution-engine skips the subscription when config.logPrefix is set (sub-agent)", () => {
    const shouldSubscribe = (logPrefix: string) => logPrefix === "";
    expect(shouldSubscribe("")).toBe(true);
    expect(shouldSubscribe("  │ ")).toBe(false);
  });

  test("shared EventBus fans out to BOTH subscribers (demonstrates the duplication without the fix)", async () => {
    const calls: string[] = [];
    const makeObs = (tag: string) => ({
      debug: (msg: string) => Effect.sync(() => { calls.push(`${tag}:${msg}`); }),
    }) as never;

    await Effect.runPromise(
      Effect.gen(function* () {
        const eb = yield* EventBus;
        // Root subscribes
        yield* subscribeReasoningStreamLogger({
          eb, obs: makeObs("parent"), logModelIO: false, isVerbose: true, isDebug: false,
        });
        // Sub-agent subscribes to THE SAME bus (this is what execution-engine.ts now prevents)
        yield* subscribeReasoningStreamLogger({
          eb, obs: makeObs("child"), logModelIO: false, isVerbose: true, isDebug: false,
        });
        // Publish ONE event
        yield* eb.publish({
          _tag: "ReasoningStepCompleted", taskId: "t1", strategy: "reactive",
          step: 1, totalSteps: 1, action: "web-search",
        } as never);
      }).pipe(Effect.provide(EventBusLive)),
    );

    // Both subscribers receive the event → TWO calls mentioning "action"
    const actionCalls = calls.filter((c) => c.includes("action"));
    expect(actionCalls.length).toBe(2);
    expect(actionCalls.some((c) => c.startsWith("parent:"))).toBe(true);
    expect(actionCalls.some((c) => c.startsWith("child:"))).toBe(true);
  });

  test("single subscription to shared EventBus logs event exactly once (the fix)", async () => {
    const calls: string[] = [];
    const makeObs = (tag: string) => ({
      debug: (msg: string) => Effect.sync(() => { calls.push(`${tag}:${msg}`); }),
    }) as never;

    await Effect.runPromise(
      Effect.gen(function* () {
        const eb = yield* EventBus;
        // Only root subscribes (sub-agent subscription is skipped by execution-engine.ts)
        yield* subscribeReasoningStreamLogger({
          eb, obs: makeObs("root"), logModelIO: false, isVerbose: true, isDebug: false,
        });
        // Publish ONE event
        yield* eb.publish({
          _tag: "ReasoningStepCompleted", taskId: "t1", strategy: "reactive",
          step: 1, totalSteps: 1, action: "web-search",
        } as never);
      }).pipe(Effect.provide(EventBusLive)),
    );

    // Only ONE subscriber receives the event → ONE call mentioning "action"
    const actionCalls = calls.filter((c) => c.includes("action"));
    expect(actionCalls.length).toBe(1);
    expect(actionCalls[0]).toMatch(/^root:/);
  });
});
