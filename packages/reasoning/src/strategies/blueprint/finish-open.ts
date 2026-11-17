// File: src/strategies/blueprint/finish-open.ts
//
// The loop executor for blueprint's remainder.
//
// Blueprint's 0-LLM worker dispatches `tool_call` steps (and the analysis steps
// they consume). A plan can still hold steps it never runs: a `composite` step
// whose arguments were deferred to execute time (policy/plan-args.ts), or a step
// that names a tool without being typed as a call. Left alone they would ship as
// done. The completion invariant (policy/plan-completion.ts) hands each of them
// to plan-execute's own step executor, one at a time in plan order: a composite
// step runs one scoped ReAct pass (the model chooses its arguments), an analysis
// step one model call. A step whose dependency did not finish fails on that; a
// step the run budget no longer allows stays open, and the terminal then caps
// the run at `partial` and raises `plan-incomplete`.
import { Effect } from "effect";
import type { LogEvent } from "@reactive-agents/observability";
import type { LLMService } from "@reactive-agents/llm-provider";
import type { ReasoningConfig } from "../../types/config.js";
import type { PlanStep, Plan } from "../../types/plan.js";
import { extractDependencies } from "../../types/plan.js";
import { isOpenPlanStep, isSynthesisStep } from "../../kernel/policy/plan-completion.js";
import type { RunEnvelope } from "../../kernel/envelope/run-envelope.js";
import type { StrategyServices } from "../../kernel/utils/service-utils.js";
import type { StrategyPaused, StrategyRun } from "../substrate/strategy-run.js";
import type { ToolSummary } from "../planning/plan-prompts.js";
import type { StepExecutorInput } from "../plan-execute/step-executor.js";
import { runStepWithRetries } from "../plan-execute/step-run.js";
import { isBudgetExhausted, withSpentBudget } from "../budget/remaining-budget.js";

/** What the remainder needs from the blueprint run. */
export interface FinishOpenDeps {
  readonly services: StrategyServices;
  readonly input: StepExecutorInput & { readonly config: ReasoningConfig };
  readonly plan: Plan;
  /** The plan's steps as the worker left them (executed steps carry their status and result). */
  readonly steps: readonly PlanStep[];
  readonly toolSummaries: ToolSummary[];
  readonly emitLog: (event: LogEvent) => Effect.Effect<void, never>;
  readonly run: StrategyRun;
}

/** Open steps the executor owes: every open step that is not left to synthesis, and the open analysis steps they consume. */
function owedSteps(steps: readonly PlanStep[]): readonly PlanStep[] {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const owed = new Set(steps.filter((s) => isOpenPlanStep(s) && !isSynthesisStep(s)).map((s) => s.id));
  const visit = (id: string): void => {
    for (const dep of extractDependencies(byId.get(id)!)) {
      const d = byId.get(dep);
      if (d !== undefined && isOpenPlanStep(d) && !owed.has(dep)) {
        owed.add(dep);
        visit(dep);
      }
    }
  };
  for (const id of [...owed]) visit(id);
  return steps.filter((s) => owed.has(s.id));
}

/**
 * Run the plan's owed steps (see module header). Returns the steps it ran or
 * failed, in plan order, as new records; steps it left open are not returned.
 */
export const finishOpenSteps = (
  deps: FinishOpenDeps,
): Effect.Effect<readonly PlanStep[], StrategyPaused, LLMService | RunEnvelope> =>
  Effect.gen(function* () {
    const { run, input } = deps;
    const state = new Map(deps.steps.map((s) => [s.id, s]));
    const ran: PlanStep[] = [];
    for (const step of owedSteps(deps.steps)) {
      const spend = yield* run.runSpend();
      if (isBudgetExhausted(input.budgetLimits, spend)) break;
      const unmet = [...extractDependencies(step)].filter((d) => state.get(d)?.status !== "completed");
      const settled = (next: PlanStep): void => {
        state.set(next.id, next);
        ran.push(next);
      };
      if (unmet.length > 0) {
        settled({ ...step, status: "failed", error: `dependency step(s) [${unmet.join(", ")}] did not complete successfully`, completedAt: new Date().toISOString() });
        continue;
      }
      const completedSteps = [...state.values()].filter((s) => s.status === "completed");
      const result = yield* runStepWithRetries(
        {
          services: deps.services,
          input,
          plan: deps.plan,
          completedSteps,
          waveInput: { ...input, budgetLimits: withSpentBudget(input.budgetLimits, { tokens: run.spend().tokens, cost: run.spend().cost }) },
          toolSummaries: deps.toolSummaries,
          emitLog: deps.emitLog,
          steps: run.steps(),
          stepRetries: 0,
          stepKernelMaxIterations: undefined,
          run,
        },
        { ...step },
      );
      const completedAt = new Date().toISOString();
      settled(
        result.success
          ? { ...step, status: "completed", result: result.output, ...(result.fullResult !== undefined ? { fullResult: result.fullResult } : {}), completedAt }
          : { ...step, status: "failed", error: result.error ?? result.output, completedAt },
      );
      if (result.ledgerSteps !== undefined) run.record(...result.ledgerSteps);
      // A composite pass that stopped at an approval gate (deferred pause) ends the run here.
      yield* run.checkpoint();
    }
    return ran;
  });
