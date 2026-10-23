/**
 * Completion observability block.
 *
 * Owns: the "Execution completed" structured log, the compact `◉ [complete]`
 * line (normal verbosity), the Task 21 calibration-provenance rendering
 * (best-effort try/catch around loadObservations + renderCalibrationProvenance),
 * and the final dashboard gauges (tokens_used, total_duration, iteration,
 * success — the Stage-5 metric that replaced the phase-health inference — and
 * the model_name counter).
 *
 * Moved verbatim from execution-engine.ts (GH #221 W26 decomposition, former
 * completion-logs + provenance + gauges blocks, lines 1649-1714). `obs`
 * arrives nullable exactly as before; each block keeps its own null/flag
 * guard.
 */
import { Effect } from "effect";
import type { Task, TaskResult } from "@reactive-agents/core";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import { renderCalibrationProvenance } from "@reactive-agents/observability";
import { loadObservations } from "@reactive-agents/reactive-intelligence";
import type { ModelCalibration } from "@reactive-agents/llm-provider";
import type { ExecutionContext, ReactiveAgentsConfig } from "../types.js";
import type { ObsLike } from "./runtime-context.js";

export interface CompletionObsDeps {
  readonly obs: ObsLike | null;
  readonly isNormal: boolean;
  readonly ctx: ExecutionContext;
  readonly task: Task;
  readonly config: ReactiveAgentsConfig;
  readonly result: TaskResult;
  readonly executionSucceeded: boolean;
  readonly resolvedCalibration: ModelCalibration | undefined;
}

export const emitCompletionObservability = (
  deps: CompletionObsDeps,
): Effect.Effect<void, never> => {
  const {
    obs,
    isNormal,
    ctx,
    task,
    config,
    result,
    executionSucceeded,
    resolvedCalibration,
  } = deps;

  return Effect.gen(function* () {
    if (obs) {
      yield* obs.info("Execution completed", {
        taskId: task.id,
        success: executionSucceeded,
        tokensUsed: ctx.tokensUsed,
        cost: ctx.cost,
        duration: result.metadata.duration,
      }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/execute-completion-obs.ts:58", tag: errorTag(err) })));
    }

    if (obs && isNormal) {
      const durationSec = (result.metadata.duration / 1000).toFixed(1);
      const costStr = `$${result.metadata.cost.toFixed(4)}`;
      const toks = ctx.tokensUsed.toLocaleString();
      yield* obs.info(
        `◉ [complete]   ✓ ${task.id} | ${toks} tok | ${costStr} | ${durationSec}s`,
      ).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/execute-completion-obs.ts:67", tag: errorTag(err) })));
    }

    // Calibration provenance (Task 21)
    if (obs && resolvedCalibration) {
      try {
        const modelId = String(ctx.selectedModel ?? config.defaultModel ?? "unknown");
        const localObs = loadObservations(modelId, {
          baseDir: process.env["REACTIVE_AGENTS_OBSERVATIONS_DIR"],
        });
        const sources: ("prior" | "community" | "local")[] = ["prior"];
        if (localObs.sampleCount > 0) sources.push("local");
        const provenance = renderCalibrationProvenance({
          modelId,
          sources,
          localSamples: localObs.sampleCount,
          summary: {
            parallelCallCapability: resolvedCalibration.parallelCallCapability,
            classifierReliability: resolvedCalibration.classifierReliability,
          },
        });
        yield* obs.info(`◉ [calibration] ${provenance}`).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/execute-completion-obs.ts:88", tag: errorTag(err) })));
      } catch {
        // Provenance rendering is best-effort
      }
    }

    // Record final metrics for dashboard
    if (obs) {
      yield* obs.setGauge("execution.tokens_used", ctx.tokensUsed, { taskId: ctx.taskId })
        .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/execute-completion-obs.ts:97", tag: errorTag(err) })));
      yield* obs.setGauge("execution.total_duration", result.metadata.duration, { taskId: ctx.taskId })
        .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/execute-completion-obs.ts:99", tag: errorTag(err) })));
      yield* obs.setGauge("execution.iteration", ctx.iteration, { taskId: ctx.taskId })
        .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/execute-completion-obs.ts:101", tag: errorTag(err) })));
      // Stage 5 quality fix: expose actual task success as a metric
      // so the console exporter can display the correct status.
      // Prior: exporter inferred success from phase health (always
      // succeeded for verifier-rejected runs), causing the
      // "Status: Success" lie when the task actually failed.
      yield* obs.setGauge("execution.success", executionSucceeded ? 1 : 0, { taskId: ctx.taskId })
        .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/execute-completion-obs.ts:execution.success", tag: errorTag(err) })));

      // Record model used (updated to actual model from LLM provider response)
      const modelName = String(ctx.selectedModel ?? "unknown");
      const provider = String(config.provider ?? "unknown");

      yield* obs.incrementCounter("execution.model_name", 0, { model: modelName, provider, taskId: ctx.taskId })
        .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/execute-completion-obs.ts:115", tag: errorTag(err) })));
    }
  });
};
