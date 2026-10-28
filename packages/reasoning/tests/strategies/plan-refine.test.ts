import { describe, it, expect } from "bun:test";
import { Effect, Option } from "effect";
import { LLMService, TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { refinePlan } from "../../src/strategies/plan-execute/refine-plan.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { hydratePlan } from "../../src/types/plan.js";
import type { ReasoningStep } from "../../src/types/index.js";

/** Seam pin for plan-execute/refine-plan.ts: patch vs augment vs no-op. */
const input = {
  taskDescription: "Research X",
  taskType: "research",
  memoryContext: "",
  availableTools: [],
  config: defaultReasoningConfig,
} as const;

const onePlan = () =>
  hydratePlan(
    { steps: [{ title: "Gather", instruction: "gather", type: "analysis" }] },
    { taskId: "t", agentId: "a", goal: "Research X", planMode: "linear" },
  );

const AUGMENT_JSON = JSON.stringify({
  steps: [{ title: "Extra", instruction: "dig deeper", type: "analysis" }],
});

const run = (plan: ReturnType<typeof onePlan>, allStepsCompleted: boolean, steps: ReasoningStep[]) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const llm = yield* LLMService;
      return yield* refinePlan({
        plan,
        goal: "Research X",
        reflectionForRefine: "UNSATISFIED: missing detail",
        input,
        llm,
        eventBus: Option.none(),
        steps,
        refinement: 0,
        maxRefinements: 3,
        totalTokens: 0,
        allStepsCompleted,
      });
    }).pipe(Effect.provide(TestLLMServiceLayer([{ match: "", text: AUGMENT_JSON }]))),
  );

describe("refinePlan", () => {
  it("is a no-op when nothing failed and not all steps completed", async () => {
    const plan = onePlan();
    const steps: ReasoningStep[] = [];
    const r = await run(plan, false, steps);
    expect(r).toEqual({ tokensAdded: 0, llmCallsAdded: 0 });
    expect(plan.steps).toHaveLength(1);
    expect(steps).toHaveLength(0);
  });

  it("AUGMENTs with supplementary steps when every step completed but the goal is unmet", async () => {
    const plan = onePlan();
    plan.steps[0]!.status = "completed";
    const steps: ReasoningStep[] = [];
    const r = await run(plan, true, steps);
    expect(r.llmCallsAdded).toBe(1);
    expect(plan.steps.map((s) => s.title)).toEqual(["Gather", "Extra"]);
    expect(steps.some((s) => s.content.startsWith("[AUGMENT]"))).toBe(true);
  });

  it("PATCHes (replaces failed + pending steps) when a step failed, without counting an extra LLM call", async () => {
    const plan = onePlan();
    plan.steps[0]!.status = "failed";
    const steps: ReasoningStep[] = [];
    const r = await run(plan, false, steps);
    expect(r.llmCallsAdded).toBe(0);
    expect(plan.steps.map((s) => s.title)).toEqual(["Extra"]);
  });
});
