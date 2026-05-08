/**
 * Phase 7 MEMORY_FLUSH dispatch.
 *
 * Computes task complexity from iteration count, latest entropy reading,
 * and tool-call log length, then dispatches the memoryFlush phase in one
 * of three modes: trivial (skip, mark agentState="flushing"), moderate
 * (fork daemon, fire-and-forget), complex (run blocking).
 *
 * Lifted from execution-engine.ts post-W24-A-step-1 (~2328-LOC checkpoint).
 *
 * The caller passes a `runMemoryFlush` callback so this module doesn't
 * need access to the engine's `deps: PhaseDeps` bundle. Complexity
 * classification is currently imported from execution-engine.ts pending
 * T10 hoist.
 */
import { Effect } from "effect";
import type { ExecutionContext } from "../../types.js";
import { classifyComplexity } from "../../execution-engine.js";

export interface MemoryFlushDispatchArgs {
  readonly ctx: ExecutionContext;
  readonly entropyLog: readonly { composite: number }[];
  readonly toolCallLog: readonly unknown[];
  readonly runMemoryFlush: (ctx: ExecutionContext) => Effect.Effect<ExecutionContext, never>;
}

export const dispatchMemoryFlush = (
  args: MemoryFlushDispatchArgs,
): Effect.Effect<ExecutionContext, never> => {
  const { entropyLog, toolCallLog, runMemoryFlush } = args;
  return Effect.gen(function* () {
    let ctx = args.ctx;
    const rrForComplexity = ctx.metadata.reasoningResult as { metadata?: { terminatedBy?: string; llmCalls?: number } } | undefined;
    const terminatedByForComplexity = (rrForComplexity?.metadata?.terminatedBy ?? "end_turn") as string;
    const latestEntropy = entropyLog.length > 0 ? entropyLog[entropyLog.length - 1] : undefined;
    const complexity = classifyComplexity(
      ctx.iteration,
      latestEntropy,
      toolCallLog.length,
      terminatedByForComplexity,
    );
    ctx = { ...ctx, metadata: { ...ctx.metadata, taskComplexity: complexity } };

    if (complexity === "trivial") {
      ctx = { ...ctx, agentState: "flushing" as const };
    } else if (complexity === "moderate") {
      yield* Effect.forkDaemon(runMemoryFlush(ctx));
    } else {
      ctx = yield* runMemoryFlush(ctx);
    }
    return ctx;
  });
};
