/**
 * One plan step's execution with retries, for the plan-execute wave scheduler.
 *
 * Extracted verbatim from the wave mapper in `executePlanExecute`: marks the
 * step in-progress, publishes the step-start / retry trace events, runs
 * `executeStep` up to `stepRetries + 1` times (feeding the previous error into
 * each retry), and returns a uniform result record (success carries tokens,
 * cost, envelope, ledger steps and any durable pause; failure carries the error).
 * The orchestrator applies results sequentially, so this never mutates run totals.
 */
import { Cause, Effect, Exit } from "effect";
import type { LogEvent } from "@reactive-agents/observability";
import { publishReasoningStep } from "../../kernel/utils/service-utils.js";
import type { StrategyServices } from "../../kernel/utils/service-utils.js";
import type { ReasoningStep } from "../../types/index.js";
import type { Plan, PlanStep } from "../../types/plan.js";
import type { ToolSummary } from "../planning/plan-prompts.js";
import type { PlanExecuteInput } from "../plan-execute.js";
import { executeStep, type StepExecutorInput } from "./step-executor.js";

export interface StepRunDeps {
  readonly services: StrategyServices;
  readonly input: Pick<PlanExecuteInput, "taskId" | "config">;
  readonly plan: Plan;
  readonly completedSteps: PlanStep[];
  /** Step-executor input with this wave's REMAINING budget applied. */
  readonly waveInput: StepExecutorInput;
  readonly toolSummaries: ToolSummary[];
  readonly emitLog: (event: LogEvent) => Effect.Effect<void, never>;
  /** The run's reasoning-step trace (read for the live step count in events). */
  readonly steps: readonly ReasoningStep[];
  readonly stepRetries: number;
  readonly stepKernelMaxIterations: number | undefined;
}

export const runStepWithRetries = (deps: StepRunDeps, step: PlanStep) => {
  const { services, input, plan, completedSteps, waveInput, toolSummaries, emitLog, steps } = deps;
  const { eventBus } = services;
  const stepIndex = plan.steps.indexOf(step);

  return Effect.gen(function* () {
    step.status = "in_progress";
    step.startedAt = new Date().toISOString();

    const stepLabel = `${step.id}: ${step.title} (${step.type}${step.toolName ? ` → ${step.toolName}` : ""})`;
    yield* publishReasoningStep(eventBus, {
      _tag: "ReasoningStepCompleted",
      taskId: input.taskId ?? "plan-execute",
      strategy: "plan-execute-reflect",
      step: steps.length,
      totalSteps: plan.steps.length,
      action: `[STEP ${stepIndex + 1}/${plan.steps.length}] ${stepLabel}`,
      kernelPass: `plan-execute:step-${stepIndex + 1}:start`,
    });

    let stepSucceeded = false;
    let stepResult = "";
    let lastError: string | undefined;
    // W5.5: derive the per-step slice here, where `plan` exists: the
    // run's configured iteration budget spread over the plan (floor
    // 5). Sourced from `strategies.reactive.maxIterations` — the
    // canonical store for the run budget even on non-reactive runs
    // (review note: mislabeled as "run's own" before; the value is
    // the configured default, and an explicit stepKernelMaxIterations
    // still wins over it).
    const derivedStepBudget =
      deps.stepKernelMaxIterations ??
      (plan.steps.length > 0
        ? Math.max(5, Math.ceil(input.config.strategies.reactive.maxIterations / plan.steps.length))
        : 5);

    for (let attempt = 0; attempt <= deps.stepRetries; attempt++) {
      if (attempt > 0) {
        yield* publishReasoningStep(eventBus, {
          _tag: "ReasoningStepCompleted",
          taskId: input.taskId ?? "plan-execute",
          strategy: "plan-execute-reflect",
          step: steps.length,
          totalSteps: plan.steps.length,
          thought: `[RETRY ${step.id} attempt ${attempt + 1}/${deps.stepRetries + 1}] Previous error: ${lastError}`,
          kernelPass: `plan-execute:step-${stepIndex + 1}:retry-${attempt}`,
        });
      }

      const exit = yield* Effect.exit(
        executeStep(
          step,
          stepIndex,
          plan,
          completedSteps,
          waveInput,
          toolSummaries,
          services,
          derivedStepBudget,
          attempt > 0 ? lastError : undefined,
          emitLog,
        ),
      );

      if (Exit.isSuccess(exit)) {
        stepResult = exit.value.output;
        stepSucceeded = true;
        return {
          step,
          stepIndex,
          success: true,
          output: stepResult,
          tokens: exit.value.tokens,
          cost: exit.value.cost,
          error: undefined,
          ...(exit.value.fullResult !== undefined
            ? { fullResult: exit.value.fullResult }
            : {}),
          ...(exit.value.rawTerminatedBy !== undefined
            ? { rawTerminatedBy: exit.value.rawTerminatedBy }
            : {}),
          // Canonical tool-evidence pair (tool_call steps only) — the
          // apply loop ships it into result.steps for deliverable truth.
          ...(exit.value.ledgerSteps !== undefined
            ? { ledgerSteps: exit.value.ledgerSteps }
            : {}),
          // #40: the step's completion envelope rides the wave result
          // so the apply loop can join it into the aggregate.
          envelope: exit.value.envelope,
          // Durable pause (Phase D): the step's sub-kernel stopped at an
          // approval gate — the step did NOT do its work. Carried to the
          // apply loop, which abandons the plan instead of composing
          // around an unapproved call.
          ...(exit.value.pause !== undefined ? { pause: exit.value.pause } : {}),
        };
      }
      const squashed = Cause.squash(exit.cause);
      lastError = squashed instanceof Error ? squashed.message : String(squashed);
    }

    return { step, stepIndex, success: false, output: `[Step failed after ${deps.stepRetries + 1} attempts: ${lastError}]`, tokens: 0, cost: 0, error: lastError };
  });
};

/** Uniform per-step result consumed by the orchestrator's apply loop. */
export type StepRunResult = Effect.Effect.Success<ReturnType<typeof runStepWithRetries>>;
