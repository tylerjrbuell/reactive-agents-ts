// Run: bun test packages/interaction/tests/judgment-shadow-priority.test.ts --timeout 15000
//
// The autonomy-confidence judgment is observation-only (it publishes
// JudgmentShadow and never feeds the auto-approve decision), so it must pass
// `priority: "shadow"` to `judgment.ask` and be bounded by the JudgmentService
// concurrency gate.
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { EventBusLive } from "@reactive-agents/core";
import { JudgmentService, JudgmentTimeout } from "@reactive-agents/judgment";
import { PreferenceLearner, PreferenceLearnerLive } from "../src/services/preference-learner.js";

describe("preference-learner shadow judgment passes priority: shadow", () => {
  it("the autonomy-confidence ask is shadow priority", async () => {
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
        const svc = yield* PreferenceLearner;
        for (let i = 0; i < 5; i++) yield* svc.recordApproval({ userId: "u", taskType: "review", approved: true });
        yield* svc.shouldAutoApprove({ userId: "u", taskType: "review" });
        yield* Effect.sleep("50 millis");
      }).pipe(Effect.provide(Layer.mergeAll(PreferenceLearnerLive, EventBusLive, judgment))),
    );

    expect(priorities).toEqual(["shadow"]);
  }, 15000);
});
