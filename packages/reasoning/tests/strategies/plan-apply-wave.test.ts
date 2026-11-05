import { describe, it, expect } from "bun:test";
import { Effect, Option } from "effect";
import { LLMService, TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { applyWaveResults } from "../../src/strategies/plan-execute/apply-wave.js";
import type { StepRunResult } from "../../src/strategies/plan-execute/step-run.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { hydratePlan } from "../../src/types/plan.js";
import type { ReasoningStep } from "../../src/types/index.js";

/** Seam pin for plan-execute/apply-wave.ts: state application, inline patch, honest LLM-call accounting. */
const input = {
  taskDescription: "Research X",
  taskType: "research",
  memoryContext: "",
  availableTools: [],
  config: defaultReasoningConfig,
} as const;

const PATCH_JSON = JSON.stringify({
  steps: [{ title: "Retry differently", instruction: "try again", type: "analysis" }],
});

const twoStepPlan = () =>
  hydratePlan(
    {
      steps: [
        { title: "A", instruction: "a", type: "analysis" },
        { title: "B", instruction: "b", type: "analysis" },
      ],
    },
    { taskId: "t", agentId: "a", goal: "Research X", planMode: "linear" },
  );

const apply = (plan: ReturnType<typeof twoStepPlan>, results: (step: ReturnType<typeof twoStepPlan>["steps"][number]) => StepRunResult[]) => {
  const steps: ReasoningStep[] = [];
  const completedSteps: typeof plan.steps = [];
  return Effect.runPromise(
    Effect.gen(function* () {
      const llm = yield* LLMService;
      const delta = yield* applyWaveResults(
        {
          plan, input, llm, eventBus: Option.none(), planStoreOpt: Option.none(), completedSteps, totalTokens: 100,
          steps, record: (...more) => { steps.push(...more); },
        },
        results(plan.steps[0]!),
      );
      return { delta, steps, completedSteps };
    }).pipe(Effect.provide(TestLLMServiceLayer([{ match: "", text: PATCH_JSON }]))),
  );
};

describe("applyWaveResults", () => {
  it("marks a successful step completed and adds no spend (the strategy run accounted the step)", async () => {
    const plan = twoStepPlan();
    const { delta, steps, completedSteps } = await apply(plan, (step) => [
      { step, stepIndex: 0, success: true, output: "done", error: undefined } satisfies StepRunResult,
    ]);
    expect(plan.steps[0]!.status).toBe("completed");
    expect(plan.steps[0]!.result).toBe("done");
    expect(completedSteps).toHaveLength(1);
    expect(delta).toMatchObject({ tokens: 0, llmCalls: 0, waveFailed: false, pause: undefined });
    expect(steps.some((s) => s.content.startsWith("[EXEC s1] ✓ done"))).toBe(true);
  });

  it("a failed step triggers ONE inline patch, counts exactly one LLM call, and flags the wave for recompute", async () => {
    const plan = twoStepPlan();
    const { delta } = await apply(plan, (step) => [
      { step, stepIndex: 0, success: false, output: "[Step failed after 2 attempts: boom]", error: "boom" } satisfies StepRunResult,
    ]);
    expect(plan.steps[0]!.status).toBe("failed");
    expect(plan.steps.map((s) => s.title)).toEqual(["A", "Retry differently"]);
    expect(delta.llmCalls).toBe(1); // regression pin: was double-counted (2) before
    expect(delta.waveFailed).toBe(true);
  });
});
