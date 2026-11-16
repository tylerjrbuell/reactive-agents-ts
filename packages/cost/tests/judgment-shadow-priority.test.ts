// Run: bun test packages/cost/tests/judgment-shadow-priority.test.ts --timeout 15000
//
// The complexity router's judgment tier classification is observation-only (it
// publishes JudgmentShadow and never changes the recommended tier), so it must
// pass `priority: "shadow"` to `judgment.ask` and be bounded by the
// JudgmentService concurrency gate.
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { EventBusLive } from "@reactive-agents/core";
import { JudgmentService, JudgmentTimeout } from "@reactive-agents/judgment";
import { analyzeComplexity } from "../src/routing/complexity-router.js";

describe("complexity-router shadow judgment passes priority: shadow", () => {
  it("the tier classification ask is shadow priority", async () => {
    const priorities: Array<string | undefined> = [];
    const judgment = Layer.succeed(JudgmentService, {
      ask: (input) => {
        priorities.push(input.priority);
        return Effect.fail(new JudgmentTimeout({ message: "stub", timeoutMs: 1 }));
      },
      listModels: () => Effect.succeed([]),
    } satisfies JudgmentService["Type"]);

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* analyzeComplexity("What is 2+2?");
        yield* Effect.sleep("50 millis");
      }).pipe(Effect.provide(Layer.merge(EventBusLive, judgment))),
    );

    expect(priorities).toEqual(["shadow"]);
  }, 15000);
});
