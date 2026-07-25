import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { subscribeReasoningStreamLogger } from "../src/engine/phases/agent-loop/reasoning-stream-logger";
import { EventBus, EventBusLive } from "@reactive-agents/core";

describe("reasoning-stream-logger model-io dedup", () => {
  test("a reactive-strategy LLM call logs model-io exactly once, via LLMExchangeEmitted only", async () => {
    const calls: string[] = [];
    const obs = { debug: (msg: string) => Effect.sync(() => { calls.push(msg); }) } as never;

    await Effect.runPromise(
      Effect.gen(function* () {
        const eb = yield* EventBus;
        yield* subscribeReasoningStreamLogger({
          eb, obs, logModelIO: true, isVerbose: true, isDebug: true,
        });
        // Same underlying call, emitted on both event types as reactive does today.
        yield* eb.publish({
          _tag: "ReasoningStepCompleted", taskId: "t1", strategy: "reactive", step: 1, totalSteps: 1,
          prompt: { system: "sys", user: "usr" },
        } as never);
        yield* eb.publish({
          _tag: "LLMExchangeEmitted", taskId: "t1", requestKind: "reactive", provider: "test",
          model: "m", messages: [{ role: "user", content: "usr" }], systemPrompt: "sys",
          response: { content: "resp" }, durationMs: 1, tokensUsed: 1, estimatedCost: 0,
        } as never);
      }).pipe(Effect.provide(EventBusLive)),
    );

    const modelIoCalls = calls.filter((c) => c.includes("model-io"));
    expect(modelIoCalls.length).toBe(1);
  });
});
