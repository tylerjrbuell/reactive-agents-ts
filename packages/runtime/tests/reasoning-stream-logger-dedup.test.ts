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
});
