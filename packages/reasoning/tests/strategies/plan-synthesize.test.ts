import { describe, it, expect } from "bun:test";
import { Effect, Layer, Option } from "effect";
import { LLMService, TestLLMService, TestLLMServiceLayer, LLMError } from "@reactive-agents/llm-provider";
import { synthesizePlanAnswer } from "../../src/strategies/plan-execute/synthesize.js";
import { hydratePlan } from "../../src/types/plan.js";
import type { ReasoningStep } from "../../src/types/index.js";

/** Seam pin for plan-execute/synthesize.ts. */
const plan = () => {
  const p = hydratePlan(
    {
      steps: [
        { title: "A", instruction: "a", type: "analysis" },
        { title: "B", instruction: "b", type: "analysis" },
      ],
    },
    { taskId: "t", agentId: "a", goal: "G", planMode: "linear" },
  );
  p.steps[0]!.result = "preview-A";
  p.steps[0]!.fullResult = "FULL-A";
  p.steps[1]!.result = "result-B";
  return p;
};

const run = (layer: Layer.Layer<LLMService>, steps: ReasoningStep[]) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const llm = yield* LLMService;
      return yield* synthesizePlanAnswer({
        plan: plan(),
        goal: "G",
        input: {},
        llm,
        eventBus: Option.none(),
        steps,
        refinement: 0,
        totalTokens: 10,
      });
    }).pipe(Effect.provide(layer)),
  );

describe("synthesizePlanAnswer", () => {
  it("renders the LLM's answer, records a [SYNTHESIS] trace step, and reports spend", async () => {
    const steps: ReasoningStep[] = [];
    const r = await run(TestLLMServiceLayer([{ match: "", text: "The clean answer." }]), steps);
    expect(r.output).toBe("The clean answer.");
    expect(steps.some((s) => s.content === "[SYNTHESIS] The clean answer.")).toBe(true);
    expect(r.tokens).toBeGreaterThanOrEqual(0);
  });

  it("degrades to the joined step results (full result preferred over preview) when the LLM fails", async () => {
    const base = TestLLMService([{ match: "", text: "unused" }]);
    const failing = Layer.succeed(
      LLMService,
      LLMService.of({ ...base, complete: () => Effect.fail(new LLMError({ message: "down", provider: "test" })) }),
    );
    const steps: ReasoningStep[] = [];
    const r = await run(failing, steps);
    expect(r.output).toBe("Step 1: FULL-A\n\nStep 2: result-B");
    expect(r.tokens).toBe(0);
    expect(r.cost).toBe(0);
  });
});
