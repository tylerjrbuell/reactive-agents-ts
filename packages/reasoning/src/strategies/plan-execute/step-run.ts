/**
 * One plan step's execution with retries, for the plan-execute wave scheduler.
 *
 * Extracted verbatim from the wave mapper in `executePlanExecute`: marks the
 * step in-progress, publishes the step-start / retry trace events, runs
 * `executeStep` up to `stepRetries + 1` times (feeding the previous error into
 * each retry), and returns a uniform result record (success carries the output,
 * ledger steps and any durable pause; failure carries the error). Spend is
 * recorded on the strategy run as it happens, never carried on the result.
 */
import { Cause, Effect, Exit, Option } from "effect";
import type { LogEvent } from "@reactive-agents/observability";
import type { LLMService } from "@reactive-agents/llm-provider";
import type { RunEnvelope } from "../../kernel/envelope/run-envelope.js";
import { publishReasoningStep } from "../../kernel/utils/service-utils.js";
import type { StrategyServices } from "../../kernel/utils/service-utils.js";
import type { KernelPause } from "../../kernel/capabilities/sense/step-utils.js";
import type { ReasoningStep } from "../../types/index.js";
import type { Plan, PlanStep } from "../../types/plan.js";
import type { ToolSummary } from "../planning/plan-prompts.js";
import type { PlanExecuteInput } from "../plan-execute.js";
import { StrategyPaused, type StrategyRun } from "../substrate/strategy-run.js";
import { executeStep, type StepExecutorInput } from "./step-executor.js";

/** What one wave step needs from the orchestrator's scope. */
export interface StepRunDeps {
  readonly services: StrategyServices;
  readonly input: Pick<PlanExecuteInput, "taskId" | "config">;
  readonly plan: Plan;
  readonly completedSteps: PlanStep[];
  /** Step-executor input with this wave's REMAINING budget applied. */
  readonly waveInput: StepExecutorInput;
  readonly toolSummaries: ToolSummary[];
  readonly emitLog: (event: LogEvent) => Effect.Effect<void, never>;
  /** The run's live reasoning-step trace (`run.steps()`), read for the step count in events. */
  readonly steps: readonly ReasoningStep[];
  readonly stepRetries: number;
  readonly stepKernelMaxIterations: number | undefined;
  /** The strategy run the step's passes and calls are recorded on. */
  readonly run: StrategyRun;
}

/** Uniform per-step result consumed by the orchestrator's apply loop. */
export interface StepRunResult {
  readonly step: PlanStep;
  readonly stepIndex: number;
  readonly success: boolean;
  readonly output: string;
  readonly error: string | undefined;
  /** Full uncompressed tool result (tool_call steps only), for synthesis. */
  readonly fullResult?: string;
  /** Canonical tool-evidence pair (tool_call steps only). */
  readonly ledgerSteps?: readonly ReasoningStep[];
  /** Durable pause: the step stopped at an approval gate and did NOT do its work. */
  readonly pause?: KernelPause;
}

/** Run one plan step with retries; a run-ending pause is never retried or swallowed. */
export const runStepWithRetries = (
  deps: StepRunDeps,
  step: PlanStep,
): Effect.Effect<StepRunResult, StrategyPaused, LLMService | RunEnvelope> => {
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
          deps.run,
        ),
      );

      if (Exit.isSuccess(exit)) {
        const r = exit.value;
        // A step that ran but reports failure (a direct tool dispatch whose
        // call errored: unknown tool, missing argument, tool error) is a FAILED
        // step, not a completed one. It is not retried: the same call with the
        // same arguments fails the same way; the apply loop's patch handles it.
        return {
          step,
          stepIndex,
          success: r.success,
          error: r.success ? undefined : r.output,
          output: r.output,
          ...(r.fullResult !== undefined ? { fullResult: r.fullResult } : {}),
          // Canonical tool-evidence pair (tool_call steps only) — the
          // apply loop records it into the run's steps for deliverable truth.
          ...(r.ledgerSteps !== undefined ? { ledgerSteps: r.ledgerSteps } : {}),
          // Durable pause (Phase D): the step did NOT do its work. The apply
          // loop stops there and the orchestrator ends the run paused.
          ...(r.pause !== undefined ? { pause: r.pause } : {}),
        } satisfies StepRunResult;
      }
      // A run-ending pause is the run's terminal, never a step failure to retry.
      const failure = Cause.failureOption(exit.cause);
      if (Option.isSome(failure) && failure.value instanceof StrategyPaused) {
        return yield* Effect.fail(failure.value);
      }
      const squashed = Cause.squash(exit.cause);
      lastError = squashed instanceof Error ? squashed.message : String(squashed);
    }

    return {
      step,
      stepIndex,
      success: false,
      output: `[Step failed after ${deps.stepRetries + 1} attempts: ${lastError}]`,
      error: lastError,
    } satisfies StepRunResult;
  });
};
