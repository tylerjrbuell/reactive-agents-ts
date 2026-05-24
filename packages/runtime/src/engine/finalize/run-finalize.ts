/**
 * Run Finalization block.
 *
 * Owns: AgentCompleted/TaskCompleted event emission, entropy trace attach,
 * token/cost metrics emission, completion event emission, non-live mode
 * console summary.
 *
 * Lifted from execution-engine.ts post-W23-6a-8 (2358-LOC checkpoint).
 */
import { Effect } from "effect";
import type { ExecutionContext, ReactiveAgentsConfig } from "../../types.js";
import type { Task, TaskResult } from "@reactive-agents/core";
import { ObservableLogger } from "@reactive-agents/observability";
import type { RunSummary } from "@reactive-agents/observability";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import type { EbLike } from "../runtime-context.js";

// ─── Deps interface ───────────────────────────────────────────────────────────

export interface RunFinalizeDeps {
  readonly ctx: ExecutionContext;
  readonly task: Task;
  readonly config: ReactiveAgentsConfig;
  readonly eb: EbLike | null;
  readonly result: TaskResult;
  readonly executionStartMs: number;
  readonly entropyLog: readonly { composite: number }[];
  readonly executionSucceeded: boolean;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export const finalizeRun = (
  deps: RunFinalizeDeps,
): Effect.Effect<void, never> => {
  const { ctx, task, config, eb, result, executionStartMs, entropyLog, executionSucceeded } = deps;

  return Effect.gen(function* () {
    // Phase 0.2: Lifecycle completion events (aligned with TaskResult.success)
    if (eb) {
      // Raw termination reason from ctx.metadata.terminatedBy. Carries the
      // dynamic killswitch reason (e.g. "budget-limit:tokens:1000/512") OR
      // the enumerable TerminateReason value for kernel-driven termination
      // paths. Distinct from result.metadata.terminatedBy which is
      // normalized to the closed TerminatedBy enum.
      const terminationReason = (
        ctx as unknown as { metadata?: { terminatedBy?: string } }
      ).metadata?.terminatedBy;

      yield* eb.publish({
        _tag: "AgentCompleted",
        taskId: ctx.taskId,
        agentId: config.agentId,
        success: executionSucceeded,
        totalIterations: ctx.iteration,
        totalTokens: ctx.tokensUsed,
        durationMs: Date.now() - executionStartMs,
        ...(!executionSucceeded && result.error ? { error: result.error } : {}),
        ...(terminationReason ? { terminationReason } : {}),
      }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/finalize/run-finalize.ts:agent-completed-event", tag: errorTag(err) })));
      yield* eb.publish({
        _tag: "TaskCompleted",
        taskId: task.id,
        success: executionSucceeded,
      }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/finalize/run-finalize.ts:task-completed-event", tag: errorTag(err) })));
    }

    // Attach entropy trace to result metadata for dashboard consumption
    if (entropyLog.length > 0) {
      (result.metadata as Record<string, unknown>).entropyTrace = entropyLog;
    }

    // Emit token and cost metrics for status renderer
    yield* Effect.serviceOption(ObservableLogger).pipe(
      Effect.tap((loggerOpt) => {
        if (loggerOpt._tag === "Some") {
          return Effect.all([
            loggerOpt.value.emit({
              _tag: "metric",
              name: "tokens_used",
              value: result.metadata.tokensUsed ?? 0,
              unit: "tokens",
              timestamp: new Date(),
            }),
            loggerOpt.value.emit({
              _tag: "metric",
              name: "cost_usd",
              value: result.metadata.cost ?? 0,
              unit: "usd",
              timestamp: new Date(),
            }),
          ], { concurrency: "unbounded" }).pipe(Effect.asVoid);
        }
        return Effect.void;
      }),
      Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/finalize/run-finalize.ts:token-cost-metrics", tag: errorTag(err) })),
    );

    // Emit completion event
    const executionDuration = Date.now() - executionStartMs;
    yield* Effect.serviceOption(ObservableLogger).pipe(
      Effect.tap((loggerOpt) => {
        if (loggerOpt._tag === "Some") {
          return loggerOpt.value.emit({
            _tag: "completion",
            success: result.success === true,
            summary: `Task ${result.success ? "completed" : "failed"} in ${(executionDuration / 1000).toFixed(1)}s with ${result.metadata.tokensUsed} tokens`,
            timestamp: new Date(),
          });
        }
        return Effect.void;
      }),
      Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/finalize/run-finalize.ts:completion-event", tag: errorTag(err) })),
    );

    // Handle non-live mode output
    const loggerConfig = config.logging ?? { live: true };
    if (!loggerConfig.live) {
      yield* Effect.serviceOption(ObservableLogger).pipe(
        Effect.tap((loggerOpt) => {
          if (loggerOpt._tag === "Some") {
            return loggerOpt.value.flush().pipe(
              Effect.tap((summary: RunSummary) =>
                Effect.gen(function* () {
                  console.log("\n═══ Run Summary ═══");
                  console.log(`Status:   ${summary.status}`);
                  console.log(`Duration: ${(summary.duration / 1000).toFixed(1)}s`);
                  console.log(`Tokens:   ${summary.totalTokens}`);
                  if (summary.warnings.length > 0) {
                    console.log(`Warnings: ${summary.warnings.length}`);
                  }
                  if (summary.errors.length > 0) {
                    console.log(`Errors: ${summary.errors.length}`);
                  }
                }),
              ),
            );
          }
          return Effect.void;
        }),
        Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/finalize/run-finalize.ts:non-live-console-summary", tag: errorTag(err) })),
      );
    }
  });
};
