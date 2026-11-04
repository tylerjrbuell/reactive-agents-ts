/**
 * Plan refinement for the plan-execute outer loop.
 *
 * Extracted verbatim from `executePlanExecute`: after an UNSATISFIED reflection,
 * either PATCH the plan (rewrite failed + pending steps) when any step failed, or
 * AUGMENT it with supplementary steps when every step completed but the goal is
 * unmet. Both helpers swallow LLM extraction failures into `null` (no refinement,
 * the loop simply continues). Mutates `plan.steps` and appends to the `steps`
 * trace in place; returns the extra spend for the orchestrator's counters.
 */
import { Effect } from "effect";
import type { LLMService } from "@reactive-agents/llm-provider";
import { publishReasoningStep } from "../../kernel/utils/service-utils.js";
import type { StrategyServices } from "../../kernel/utils/service-utils.js";
import { makeStep } from "../../kernel/capabilities/sense/step-utils.js";
import type { ReasoningStep } from "../../types/index.js";
import type { Plan } from "../../types/plan.js";
import type { PlanExecuteInput } from "../plan-execute.js";
import { patchPlan, augmentPlan } from "../planning/plan-mutation.js";

export interface RefinePlanDeps {
  readonly plan: Plan;
  readonly goal: string;
  readonly reflectionForRefine: string;
  /** D9: set only on a delivery-gate repair; names the missing deliverables for the patch prompt. */
  readonly repairGuidance?: string;
  readonly input: PlanExecuteInput;
  readonly llm: LLMService["Type"];
  readonly eventBus: StrategyServices["eventBus"];
  readonly steps: ReasoningStep[];
  readonly refinement: number;
  readonly maxRefinements: number;
  /** Spend so far (passed to the planner helpers for budget awareness). */
  readonly totalTokens: number;
  /** True when every plan step completed (selects AUGMENT over no-op when nothing failed). */
  readonly allStepsCompleted: boolean;
}

export interface RefinePlanResult {
  readonly tokensAdded: number;
  readonly llmCallsAdded: number;
}

export const refinePlan = (deps: RefinePlanDeps): Effect.Effect<RefinePlanResult, never, LLMService> =>
  Effect.gen(function* () {
    const { plan, goal, reflectionForRefine, input, llm, eventBus, steps, refinement, maxRefinements, totalTokens, allStepsCompleted } = deps;
    let tokensAdded = 0;
    let llmCallsAdded = 0;
    const hasFailures = plan.steps.some((s) => s.status === "failed");
    if (hasFailures) {
      const patchResult = yield* patchPlan(
        plan,
        plan.steps.findIndex((s) => s.status === "failed"),
        input,
        llm,
        totalTokens,
        deps.repairGuidance,
      ).pipe(Effect.catchAll(() => Effect.succeed(null)));

      if (patchResult) {
        tokensAdded += patchResult.tokens;
      llmCallsAdded += 1;
        const lastCompletedIdx = plan.steps.reduce(
          (acc, s, idx) => (s.status === "completed" ? idx : acc),
          -1,
        );
        plan.steps.splice(
          lastCompletedIdx + 1,
          plan.steps.length - lastCompletedIdx - 1,
          ...patchResult.steps,
        );

        const patchDetail = patchResult.steps.map((s) => `${s.id}: ${s.title}`).join(", ");
        yield* publishReasoningStep(eventBus, {
          _tag: "ReasoningStepCompleted",
          taskId: input.taskId ?? "plan-execute",
          strategy: "plan-execute-reflect",
          step: steps.length,
          totalSteps: maxRefinements + 1,
          thought: `[REFINE] Patched plan — kept ${lastCompletedIdx + 1} completed steps, replaced with: ${patchDetail}`,
          kernelPass: `plan-execute:refine-${refinement + 1}`,
        });
      }
    } else if (allStepsCompleted) {
      // All steps completed but goal unmet — generate supplementary steps
      const augmentResult = yield* augmentPlan(
        plan,
        goal,
        reflectionForRefine,
        input,
        llm,
        totalTokens,
      ).pipe(Effect.catchAll(() => Effect.succeed(null)));

      if (augmentResult && augmentResult.steps.length > 0) {
        tokensAdded += augmentResult.tokens;
        llmCallsAdded += 1;
        plan.steps.push(...augmentResult.steps);

        const augDetail = augmentResult.steps.map((s) => `${s.id}: ${s.title}`).join(", ");
        steps.push(
          makeStep("thought", `[AUGMENT] Added ${augmentResult.steps.length} supplementary steps: ${augDetail}`),
        );
        yield* publishReasoningStep(eventBus, {
          _tag: "ReasoningStepCompleted",
          taskId: input.taskId ?? "plan-execute",
          strategy: "plan-execute-reflect",
          step: steps.length,
          totalSteps: maxRefinements + 1,
          thought: `[AUGMENT] Goal unmet with all steps completed — added ${augmentResult.steps.length} supplementary steps: ${augDetail}`,
          kernelPass: `plan-execute:augment-${refinement + 1}`,
        });
      }
    }
    return { tokensAdded, llmCallsAdded };
  });
