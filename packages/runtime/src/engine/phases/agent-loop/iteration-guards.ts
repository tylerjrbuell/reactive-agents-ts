/**
 * Per-iteration guards for the inline-direct-LLM agent loop.
 *
 * Runs at the top of each iteration of the `while (!isComplete &&
 * ctx.iteration <= ctx.maxIterations)` loop in the no-ReasoningService
 * direct-LLM path. Bundles 5 guards in order:
 *   1. Lifecycle check (kill-switch / pause-stop)
 *   2. Behavioral contract iteration check
 *   3. Per-iteration budget check (graceful stop on exceed)
 *   4. ExecutionLoopIteration event publish
 *   5. Iteration gauge update
 *
 * Returns `{ ctx, shouldBreak }`. The caller breaks the outer while-loop
 * if shouldBreak is true (set when budget is exceeded — the inline block
 * marks the run complete with a "budget limit exceeded" message and bails).
 *
 * Lifted from execution-engine.ts post-W24-A-step-2 checkpoint.
 */
import { Effect } from "effect";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import { BehavioralContractService } from "@reactive-agents/guardrails";
import { CostService } from "@reactive-agents/cost";
import type { RuntimeErrors } from "../../../errors.js";
import { BehavioralContractViolationError } from "../../../errors.js";
import type { ExecutionContext, ReactiveAgentsConfig } from "../../../types.js";
import type { EbLike, ObsLike } from "../../runtime-context.js";

export interface IterationGuardsArgs {
  readonly ctx: ExecutionContext;
  readonly config: ReactiveAgentsConfig;
  readonly eb: EbLike | null;
  readonly obs: ObsLike | null;
  readonly checkLifecycle: (taskId: string) => Effect.Effect<void, RuntimeErrors>;
}

export interface IterationGuardsResult {
  readonly ctx: ExecutionContext;
  /** Caller should break the outer while-loop when true (budget exceeded). */
  readonly shouldBreak: boolean;
}

export const runIterationGuards = (
  args: IterationGuardsArgs,
): Effect.Effect<IterationGuardsResult, BehavioralContractViolationError | RuntimeErrors> => {
  const { config, eb, obs, checkLifecycle } = args;
  return Effect.gen(function* () {
    let ctx = args.ctx;

    // 1. Kill switch check at top of each iteration
    yield* checkLifecycle(ctx.taskId);

    // 2. Behavioral contract: check iteration limit
    if (config.enableBehavioralContracts) {
      const bcOpt = yield* Effect.serviceOption(BehavioralContractService)
        .pipe(Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })));
      if (bcOpt._tag === "Some") {
        const violation = yield* bcOpt.value.checkIteration(ctx.iteration)
          .pipe(Effect.catchAll(() => Effect.succeed(null)));
        if (violation?.severity === "block") {
          return yield* Effect.fail(new BehavioralContractViolationError({
            message: violation.message, taskId: ctx.taskId,
            rule: violation.rule, violation: violation.message,
          }));
        }
      }
    }

    // 3. Per-iteration budget check
    if (config.enableCostTracking) {
      const iterBudgetOpt = yield* Effect.serviceOption(CostService).pipe(
        Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
      );
      if (iterBudgetOpt._tag === "Some") {
        const budgetCheck = yield* iterBudgetOpt.value
          .checkBudget(ctx.cost, ctx.agentId, ctx.sessionId)
          .pipe(
            Effect.map(() => true),
            Effect.catchAll((budgetErr) => {
              if (obs) {
                const msg = "message" in budgetErr ? String(budgetErr.message) : "Budget exceeded";
                return obs.info(`⚠ [budget] ${msg} — stopping execution`).pipe(
                  Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/phases/agent-loop/iteration-guards.ts:budget-exceeded-log", tag: errorTag(err) })),
                  Effect.map(() => false),
                );
              }
              return Effect.succeed(false);
            }),
          );
        if (!budgetCheck) {
          // Graceful stop — caller should break and finalize with what we have so far
          ctx = {
            ...ctx,
            metadata: {
              ...ctx.metadata,
              budgetExceeded: true,
              isComplete: true,
              lastResponse: ctx.metadata.lastResponse ?? "Execution stopped: budget limit exceeded.",
            },
          };
          return { ctx, shouldBreak: true };
        }
      }
    }

    // 4. Publish loop iteration event
    if (eb) {
      yield* eb.publish({
        _tag: "ExecutionLoopIteration",
        taskId: ctx.taskId,
        iteration: ctx.iteration,
      }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/phases/agent-loop/iteration-guards.ts:emit-loop-iteration", tag: errorTag(err) })));
    }
    // 5. Track iteration gauge
    if (obs) {
      yield* obs.setGauge("execution.iteration", ctx.iteration, { taskId: ctx.taskId })
        .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/phases/agent-loop/iteration-guards.ts:set-iteration-gauge", tag: errorTag(err) })));
    }

    return { ctx, shouldBreak: false };
  });
};
