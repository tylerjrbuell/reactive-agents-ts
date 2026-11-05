/**
 * The REFLECT phase of one plan-execute iteration: judge whether the executed
 * plan met the goal.
 *
 * S4b (Plan 9): when every step completed AND the deterministic delivery
 * judgment verified at least one run-contract condition with nothing unmet,
 * the reflect model call could only say SATISFIED, so it is skipped and the
 * skip is traced. Judged at the terminal phase with no output yet, so an
 * `output:*` requirement stays unmet and keeps the call; a poor contract (only
 * the `answer` floor, `met === 0`) keeps it too. Otherwise one critique call
 * (thinking-safe extraction) runs and is accounted on the strategy run.
 */
import { Effect } from "effect";
import type { LLMService } from "@reactive-agents/llm-provider";
import { makeStep } from "../../kernel/capabilities/sense/step-utils.js";
import { judgeStrategyDelivery } from "../../kernel/capabilities/verify/strategy-delivery.js";
import { runCritiquePass } from "../../kernel/capabilities/verify/critique.js";
import type { RunContract } from "../../kernel/contract/run-contract.js";
import type { Plan } from "../../types/plan.js";
import { buildReflectionPrompt, type StepResult } from "../planning/plan-prompts.js";
import type { StrategyRun } from "../substrate/strategy-run.js";
import type { PlanExecuteInput } from "../plan-execute.js";

/** What the reflect phase reads from the orchestrator's scope. */
export interface ReflectDeps {
  readonly run: StrategyRun;
  readonly llm: LLMService["Type"];
  readonly input: Pick<PlanExecuteInput, "systemPrompt" | "taskId">;
  readonly goal: string;
  readonly plan: Plan;
  readonly runContract: RunContract;
  /** The contract's requirement descriptions, listed in the reflect prompt. */
  readonly requirements: readonly string[];
  readonly refinement: number;
  readonly depth: PlanExecuteInput["config"]["strategies"]["planExecute"]["reflectionDepth"];
}

/** The reflection verdict text, and whether the model call was skipped. */
export interface ReflectOutcome {
  readonly content: string;
  /** True when the deterministic verdict decided (no model thought to score). */
  readonly skipped: boolean;
}

/** Run (or deterministically skip) one reflect pass over the executed plan. */
export const reflectOnPlan = (deps: ReflectDeps): Effect.Effect<ReflectOutcome> =>
  Effect.gen(function* () {
    const { run, llm, input, plan, refinement } = deps;
    const allStepsCompleted = plan.steps.every((s) => s.status === "completed");
    const verified = allStepsCompleted
      ? judgeStrategyDelivery(deps.runContract, { steps: run.steps(), ledger: yield* run.ledger() })
      : undefined;
    if (verified !== undefined && verified.decision.accepted && verified.met > 0) {
      run.record(
        makeStep(
          "observation",
          `[REFLECT ${refinement + 1}] skipped — every step completed and ${verified.decision.verdictSummary}`,
          { frameworkInstrumentation: "critique-marker" },
        ),
      );
      return { content: `SATISFIED: ${verified.decision.verdictSummary}`, skipped: true };
    }

    const stepResults: StepResult[] = plan.steps.map((s) => ({
      stepId: s.id,
      title: s.title,
      status: s.status,
      result: s.result ?? s.error,
    }));
    const role = "You are evaluating plan execution. Determine if the task has been adequately addressed.";
    const result = yield* runCritiquePass({
      llm,
      systemPrompt: input.systemPrompt ? `${input.systemPrompt}\n\n${role}` : role,
      promptBody: buildReflectionPrompt(deps.goal, stepResults, deps.requirements),
      depth: deps.depth,
      strategyName: "plan-execute-reflect",
      step: refinement,
      ...(input.taskId ? { traceContext: { taskId: input.taskId } } : {}),
    });
    // critique = one direct LLM call
    run.account({ tokens: result.tokens, cost: result.cost, llmCalls: 1 });
    // Honest trace when the reflect LLM call failed and degraded to a no-op —
    // the run keeps its executed plan/answer instead of aborting on a blip.
    if (result.degraded) {
      run.record(
        makeStep("observation", `[REFLECT ${refinement}] skipped — ${result.degraded.reason}`, {
          frameworkInstrumentation: "critique-marker",
        }),
      );
    }
    return { content: result.content, skipped: false };
  });
