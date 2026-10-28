/**
 * Sequential apply phase of one plan-execute step wave.
 *
 * Extracted verbatim from `executePlanExecute`: waves run their steps
 * concurrently, then results are applied one at a time (execution order) so
 * state stays consistent. Applying a result updates the step's status/result,
 * the plan store, the completed-step list, the aggregate envelope list, the
 * reasoning-step trace and the canonical tool ledger, publishes the per-step
 * events, and — on a failed step — attempts an inline plan patch. A durable
 * approval pause is TERMINAL for the plan: it is recorded and applying stops.
 *
 * Plan/trace arrays are mutated in place; run totals are returned as deltas
 * for the orchestrator to fold into its counters.
 */
import { Effect, Option } from "effect";
import type { LLMService } from "@reactive-agents/llm-provider";
import type { PlanStoreService } from "@reactive-agents/memory";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import { publishReasoningStep } from "../../kernel/utils/service-utils.js";
import type { StrategyServices } from "../../kernel/utils/service-utils.js";
import { makeStep, type KernelPause } from "../../kernel/capabilities/sense/step-utils.js";
import type { CompletionEnvelope } from "../../kernel/state/completion-envelope.js";
import type { ReasoningStep } from "../../types/index.js";
import type { Plan, PlanStep } from "../../types/plan.js";
import type { PlanExecuteInput } from "../plan-execute.js";
import { patchPlan } from "../planning/plan-mutation.js";
import type { StepRunResult } from "./step-run.js";

export interface ApplyWaveDeps {
  readonly plan: Plan;
  readonly input: PlanExecuteInput;
  readonly llm: LLMService["Type"];
  readonly eventBus: StrategyServices["eventBus"];
  readonly planStoreOpt: Option.Option<PlanStoreService["Type"]>;
  /** The run's reasoning-step trace (appended in place). */
  readonly steps: ReasoningStep[];
  /** Completed steps so far (appended in place). */
  readonly completedSteps: PlanStep[];
  /** Sub-kernel envelopes of accepted steps (appended in place). */
  readonly contributingEnvelopes: CompletionEnvelope[];
  /** Spend before this wave (the planner helpers see base + this wave's running spend). */
  readonly totalTokens: number;
}

/** What applying the wave changed in the run's totals. */
export interface WaveApplyDelta {
  tokens: number;
  cost: number;
  llmCalls: number;
  /** Latest sub-kernel raw terminator seen in this wave, if any. */
  lastRawTerminatedBy: string | undefined;
  /** Set when a step stopped at an approval gate (terminal for the plan). */
  pause: KernelPause | undefined;
  /** Set when an inline patch rewrote the plan — the wave scheduler must recompute waves. */
  waveFailed: boolean;
}

export const applyWaveResults = (
  deps: ApplyWaveDeps,
  waveResults: readonly StepRunResult[],
): Effect.Effect<WaveApplyDelta, never, LLMService> =>
  Effect.gen(function* () {
    const { plan, input, llm, eventBus, planStoreOpt, steps, completedSteps, contributingEnvelopes } = deps;
    const acc: WaveApplyDelta = {
      tokens: 0,
      cost: 0,
      llmCalls: 0,
      lastRawTerminatedBy: undefined,
      pause: undefined,
      waveFailed: false,
    };

    for (const result of waveResults) {
      const { step, stepIndex } = result;
      acc.tokens += result.tokens;
      const totalTokens = deps.totalTokens + acc.tokens;
      // Durable pause (Phase D) — TERMINAL for the whole plan. Record it and
      // stop applying: the remaining steps must not run around a gated call
      // no human has approved yet, and no refinement/synthesis pass may
      // narrate a completion. Resume replays from the durable checkpoint.
      const stepPause = (result as { pause?: KernelPause }).pause;
      if (stepPause !== undefined) {
        acc.pause = stepPause;
        break;
      }
      acc.llmCalls += (result as { llmCalls?: number }).llmCalls ?? 0;
      acc.cost += result.cost;
      // Track the most recent composite sub-kernel termination reason —
      // surfaced on the strategy result so runtime can propagate it to
      // AgentCompleted.terminationReason. Tool-dispatch and analysis
      // steps omit this field, so it only updates when a real sub-kernel
      // ran. Sequential update mirrors execution order; the final value
      // reflects the last step's kernel.
      const stepRawTerminatedBy = (result as { rawTerminatedBy?: string })
        .rawTerminatedBy;
      if (stepRawTerminatedBy !== undefined) {
        acc.lastRawTerminatedBy = stepRawTerminatedBy;
      }

      // #40: accepted step ⇒ its envelope contributes to the aggregate
      // (worst-of join at the result boundary). Failure results carry no
      // envelope and are handled by the patch/refine machinery.
      const stepEnvelope = (result as { envelope?: CompletionEnvelope }).envelope;
      if (result.success && stepEnvelope !== undefined) {
        contributingEnvelopes.push(stepEnvelope);
      }

      if (result.success) {
        step.status = "completed";
        step.result = result.output;
        // Preserve the full uncompressed tool result (tool_call steps only)
        // so synthesis can render every item past the preview cutoff.
        const stepFullResult = (result as { fullResult?: string }).fullResult;
        if (stepFullResult !== undefined) {
          step.fullResult = stepFullResult;
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
      const stepLedger = (result as { ledgerSteps?: readonly ReasoningStep[] })
        .ledgerSteps;
      if (stepLedger && stepLedger.length > 0) {
        steps.push(
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
        steps.push(
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
