/**
 * Sequential apply phase of one plan-execute step wave.
 *
 * Extracted verbatim from `executePlanExecute`: waves run their steps
 * concurrently, then results are applied one at a time (execution order) so
 * state stays consistent. Applying a result updates the step's status/result,
 * the plan store, the completed-step list and the reasoning-step trace,
 * publishes the per-step events, and — on a failed step — attempts an inline
 * plan patch. A durable approval pause is TERMINAL for the plan: it is
 * returned and applying stops.
 *
 * The plan is mutated in place and trace steps are recorded through `record`;
 * the inline patch's spend is returned for the orchestrator to account on the
 * strategy run. Step spend, ledger facts and envelopes are never here: the
 * strategy run recorded them when the step ran.
 */
import { Effect, Option } from "effect";
import type { LLMService } from "@reactive-agents/llm-provider";
import type { PlanStoreService } from "@reactive-agents/memory";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import { publishReasoningStep } from "../../kernel/utils/service-utils.js";
import type { StrategyServices } from "../../kernel/utils/service-utils.js";
import { makeStep, type KernelPause } from "../../kernel/capabilities/sense/step-utils.js";
import type { ReasoningStep } from "../../types/index.js";
import type { Plan, PlanStep } from "../../types/plan.js";
import type { PlanExecuteInput } from "../plan-execute.js";
import { patchPlan } from "../planning/plan-mutation.js";
import type { StepRunResult } from "./step-run.js";

/** What applying one wave reads and writes in the orchestrator's scope. */
export interface ApplyWaveDeps {
  readonly plan: Plan;
  readonly input: PlanExecuteInput;
  readonly llm: LLMService["Type"];
  readonly eventBus: StrategyServices["eventBus"];
  readonly planStoreOpt: Option.Option<PlanStoreService["Type"]>;
  /** The run's live reasoning-step trace (read for event step counts). */
  readonly steps: readonly ReasoningStep[];
  /** Records trace steps on the strategy run. */
  readonly record: (...steps: readonly ReasoningStep[]) => void;
  /** Completed steps so far (appended in place). */
  readonly completedSteps: PlanStep[];
  /** Spend before this wave's patches (the planner helpers see base + this wave's patch spend). */
  readonly totalTokens: number;
}

/** What applying the wave adds that the strategy run did not already record. */
export interface WaveApplyDelta {
  /** Inline-patch tokens (the run accounts them). */
  tokens: number;
  /** Inline-patch LLM calls (the run accounts them). */
  llmCalls: number;
  /** Set when a step stopped at an approval gate (terminal for the plan). */
  pause: KernelPause | undefined;
  /** Set when an inline patch rewrote the plan — the wave scheduler must recompute waves. */
  waveFailed: boolean;
}

/** Apply one wave's step results in execution order; stops at a durable pause. */
export const applyWaveResults = (
  deps: ApplyWaveDeps,
  waveResults: readonly StepRunResult[],
): Effect.Effect<WaveApplyDelta, never, LLMService> =>
  Effect.gen(function* () {
    const { plan, input, llm, eventBus, planStoreOpt, steps, record, completedSteps } = deps;
    const acc: WaveApplyDelta = {
      tokens: 0,
      llmCalls: 0,
      pause: undefined,
      waveFailed: false,
    };

    for (const result of waveResults) {
      const { step, stepIndex } = result;
      const totalTokens = deps.totalTokens + acc.tokens;
      // Durable pause (Phase D) — TERMINAL for the whole plan. Record it and
      // stop applying: the remaining steps must not run around a gated call
      // no human has approved yet, and no refinement/synthesis pass may
      // narrate a completion. Resume replays from the durable checkpoint.
      if (result.pause !== undefined) {
        acc.pause = result.pause;
        break;
      }

      if (result.success) {
        step.status = "completed";
        step.result = result.output;
        // Preserve the full uncompressed tool result (tool_call steps only)
        // so synthesis can render every item past the preview cutoff.
        if (result.fullResult !== undefined) {
          step.fullResult = result.fullResult;
        }
        step.completedAt = new Date().toISOString();
        completedSteps.push(step);

        if (Option.isSome(planStoreOpt)) {
          yield* planStoreOpt.value.updateStepStatus(
            step.id,
            { status: "completed", result: result.output },
          ).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "reasoning/src/strategies/plan-execute.ts:439", tag: errorTag(err) })));
        }
      } else {
        step.status = "failed";
        step.error = result.output;
        step.completedAt = new Date().toISOString();

        yield* publishReasoningStep(eventBus, {
          _tag: "ReasoningStepCompleted",
          taskId: input.taskId ?? "plan-execute",
          strategy: "plan-execute-reflect",
          step: steps.length,
          totalSteps: plan.steps.length,
          observation: `[FAILED ${step.id}] ${result.error}`,
          kernelPass: `plan-execute:step-${stepIndex + 1}:failed`,
        });

        if (Option.isSome(planStoreOpt)) {
          yield* planStoreOpt.value.updateStepStatus(
            step.id,
            { status: "failed", error: result.output },
          ).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "reasoning/src/strategies/plan-execute.ts:460", tag: errorTag(err) })));
        }

        // Attempt inline patch
        const patchResult = yield* patchPlan(
          plan,
          stepIndex,
          input,
          llm,
          totalTokens,
        ).pipe(Effect.catchAll(() => Effect.succeed(null)));

        if (patchResult) {
          acc.tokens += patchResult.tokens;
          acc.llmCalls += 1;
          const patchedSteps = patchResult.steps;
          plan.steps.splice(
            stepIndex + 1,
            plan.steps.length - stepIndex - 1,
            ...patchedSteps,
          );

          const patchDetail = patchedSteps.map((s) => `${s.id}: ${s.title}`).join(", ");
          yield* publishReasoningStep(eventBus, {
            _tag: "ReasoningStepCompleted",
            taskId: input.taskId ?? "plan-execute",
            strategy: "plan-execute-reflect",
            step: steps.length,
            totalSteps: plan.steps.length,
            thought: `[PATCH] Replaced remaining steps: ${patchDetail}`,
            kernelPass: `plan-execute:step-${stepIndex + 1}:patch`,
          });
          acc.waveFailed = true; // Re-compute waves after patch
        }

        completedSteps.push(step);
      }

      // Dispatched tool steps land as their canonical ledger pair (action
      // step with metadata.toolCall + observation with toolCallId /
      // observationResult) — the ONLY shape isArtifactProduced's linkage
      // scan can verify, so deliverable receipts tell the truth for
      // plan-execute runs. The observation keeps the legacy
      // "[EXEC sN] ✓ <output>" prose (log greppability + the shell-unwrap
      // pins) — only its metadata is new. Prose-only summaries remain for
      // analysis/composite steps and never-dispatched failures.
      const stepLedger = result.ledgerSteps;
      if (stepLedger && stepLedger.length > 0) {
        record(
          ...stepLedger.map((ls) =>
            ls.type === "observation"
              ? {
                  ...ls,
                  content: `[EXEC ${step.id}] ${result.success ? "✓" : "✗"} ${result.output}`,
                }
              : ls,
          ),
        );
      } else {
        record(
          makeStep(
            result.success ? "observation" : "thought",
            `[EXEC ${step.id}] ${result.success ? "✓" : "✗"} ${result.output}`,
          ),
        );
      }

      yield* publishReasoningStep(eventBus, {
        _tag: "ReasoningStepCompleted",
        taskId: input.taskId ?? "plan-execute",
        strategy: "plan-execute-reflect",
        step: steps.length,
        totalSteps: plan.steps.length,
        observation: `[EXEC ${step.id}] ${result.success ? "✓" : "✗"} ${result.output}`,
        kernelPass: `plan-execute:step-${stepIndex + 1}:done`,
      });

      // Emit an iteration-progress boundary so the Cortex replay scrubber has
      // one checkpoint per plan step (mirrors how react-kernel emits per iteration).
      yield* publishReasoningStep(eventBus, {
        _tag: "ReasoningIterationProgress",
        taskId: input.taskId ?? "plan-execute",
        iteration: stepIndex + 1,
        maxIterations: plan.steps.length,
        strategy: "plan-execute-reflect",
        toolsThisStep: step.toolName ? [step.toolName] : [],
      });
    }

    return acc;
  });
