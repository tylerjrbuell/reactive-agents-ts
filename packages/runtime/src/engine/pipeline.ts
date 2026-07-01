/**
 * Pipeline runner — composes Phase values into a sequential execution pipeline.
 *
 * This file hoists the previously-inlined `runPhase`, `runObservablePhase`, and
 * `checkLifecycle` helpers from `execution-engine.ts` into a standalone module.
 * Behavior is preserved exactly:
 *
 *   - Lifecycle guard (kill-switch + pause) before every phase
 *   - Hook firing (before / after / on-error) via `LifecycleHookRegistry`
 *   - Cancellation check (returns `ExecutionError` if task was cancelled)
 *   - Observability span wrapping
 *   - `ExecutionPhase{Entered,Completed}` event emission
 *   - Phase-duration histogram + counter
 *
 * The runner is the single owner of all phase-boundary side effects. Phases
 * implement only their domain logic; they never publish ExecutionPhase events
 * or wrap themselves in spans.
 */
import { Effect, Ref } from "effect";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import {
  ExecutionError,
  KillSwitchTriggeredError,
  type RuntimeErrors,
} from "../errors.js";
import type { ExecutionContext } from "../types.js";
import type { Phase } from "./phase.js";
import type { PhaseDeps, ObsLike, EbLike } from "./runtime-context.js";

/**
 * Lifecycle guard — fails fast with `KillSwitchTriggeredError` when the agent has
 * been signalled to stop or terminate. Mirrors `execution-engine.ts:checkLifecycle`.
 *
 * Returns `void` on the happy path. Callers must `pipe(Effect.zipRight(...))` the
 * actual phase work after this guard.
 */
export const checkLifecycle = (
  taskId: string,
  deps: Pick<PhaseDeps, "config" | "ks" | "eb">,
): Effect.Effect<void, RuntimeErrors> =>
  Effect.gen(function* () {
    const ks = deps.ks as {
      readonly waitIfPaused: (agentId: string, taskId: string) => Effect.Effect<"ok" | "stopping", unknown>;
      readonly isTriggered: (agentId: string) => Effect.Effect<{ triggered: boolean; reason?: string }, unknown>;
    } | null;
    if (!ks) return;

    const status = yield* ks
      .waitIfPaused(deps.config.agentId, taskId)
      .pipe(Effect.catchAll(() => Effect.succeed("ok" as const)));

    if (status === "stopping") {
      if (deps.eb) {
        yield* deps.eb
          .publish({ _tag: "AgentStopping", agentId: deps.config.agentId, taskId, reason: "stop() requested" })
          .pipe(
            Effect.catchAll((err) =>
              emitErrorSwallowed({ site: "runtime/src/engine/pipeline.ts:checkLifecycle-stopping-publish", tag: errorTag(err) }),
            ),
          );
        yield* deps.eb
          .publish({ _tag: "AgentStopped", agentId: deps.config.agentId, taskId, reason: "stop() requested" })
          .pipe(
            Effect.catchAll((err) =>
              emitErrorSwallowed({ site: "runtime/src/engine/pipeline.ts:checkLifecycle-stopped-publish", tag: errorTag(err) }),
            ),
          );
      }
      return yield* Effect.fail(
        new KillSwitchTriggeredError({
          message: `Agent ${deps.config.agentId} stopping gracefully`,
          taskId,
          agentId: deps.config.agentId,
          reason: "stop() requested",
        }),
      );
    }

    const ksStatus = (yield* ks
      .isTriggered(deps.config.agentId)
      .pipe(Effect.catchAll(() => Effect.succeed({ triggered: false })))) as {
      triggered: boolean;
      reason?: string;
    };
    if (ksStatus.triggered) {
      if (deps.eb) {
        yield* deps.eb
          .publish({
            _tag: "AgentTerminated",
            agentId: deps.config.agentId,
            taskId,
            reason: ksStatus.reason ?? "terminated",
          })
          .pipe(
            Effect.catchAll((err) =>
              emitErrorSwallowed({ site: "runtime/src/engine/pipeline.ts:checkLifecycle-terminated-publish", tag: errorTag(err) }),
            ),
          );
      }
      return yield* Effect.fail(
        new KillSwitchTriggeredError({
          message: `Kill switch triggered for agent ${deps.config.agentId}: ${ksStatus.reason ?? "no reason"}`,
          taskId,
          agentId: deps.config.agentId,
          reason: ksStatus.reason ?? "no reason",
        }),
      );
    }
  });

/**
 * Run a single phase: fire before hooks, run body, fire after hooks. On error,
 * fire on-error hooks then propagate. Mirrors `execution-engine.ts:runPhase`.
 */
const runPhase = <E>(
  ctx: ExecutionContext,
  phase: ExecutionContext["phase"],
  body: (ctx: ExecutionContext) => Effect.Effect<ExecutionContext, E>,
  deps: Pick<PhaseDeps, "hooks" | "eb" | "state">,
): Effect.Effect<ExecutionContext, E | RuntimeErrors> =>
  Effect.gen(function* () {
    const ctxBefore = { ...ctx, phase };

    const ctxAfterBefore = yield* deps.hooks
      .run(phase, "before", ctxBefore)
      .pipe(Effect.catchAll(() => Effect.succeed(ctxBefore)));

    if (deps.eb) {
      yield* deps.eb
        .publish({ _tag: "ExecutionHookFired", taskId: ctx.taskId, phase: String(phase), timing: "before" })
        .pipe(
          Effect.catchAll((err) =>
            emitErrorSwallowed({ site: "runtime/src/engine/pipeline.ts:runPhase-before-publish", tag: errorTag(err) }),
          ),
        );
    }

    const cancelled = yield* Ref.get(deps.state.cancelledTasks);
    if (cancelled.has(ctx.taskId)) {
      if (deps.eb) {
        yield* deps.eb
          .publish({ _tag: "ExecutionCancelled", taskId: ctx.taskId })
          .pipe(
            Effect.catchAll((err) =>
              emitErrorSwallowed({ site: "runtime/src/engine/pipeline.ts:runPhase-cancelled-publish", tag: errorTag(err) }),
            ),
          );
      }
      return yield* Effect.fail(
        new ExecutionError({
          message: `Task ${ctx.taskId} was cancelled`,
          taskId: ctx.taskId,
          phase,
        }),
      );
    }

    const ctxAfterBody = yield* body(ctxAfterBefore).pipe(
      Effect.tapError((e) =>
        deps.hooks
          .run(phase, "on-error", {
            ...ctxAfterBefore,
            metadata: { ...ctxAfterBefore.metadata, error: e },
          })
          .pipe(
            Effect.catchAll((err) =>
              emitErrorSwallowed({ site: "runtime/src/engine/pipeline.ts:runPhase-on-error-hook", tag: errorTag(err) }),
            ),
          ),
      ),
    );

    const ctxFinal = yield* deps.hooks
      .run(phase, "after", ctxAfterBody)
      .pipe(Effect.catchAll(() => Effect.succeed(ctxAfterBody)));

    if (deps.eb) {
      yield* deps.eb
        .publish({ _tag: "ExecutionHookFired", taskId: ctx.taskId, phase: String(phase), timing: "after" })
        .pipe(
          Effect.catchAll((err) =>
            emitErrorSwallowed({ site: "runtime/src/engine/pipeline.ts:runPhase-after-publish", tag: errorTag(err) }),
          ),
        );
    }

    return ctxFinal;
  });

/**
 * Wrap `runPhase` with observability span + phase event publishing + metrics.
 * Mirrors `execution-engine.ts:runObservablePhase`.
 *
 * Exported (W26-A step 1) so the engine's inline `guardedPhase` can reuse this
 * helper instead of maintaining a duplicate closure.
 */
export const runObservablePhase = <E>(
  ctx: ExecutionContext,
  phase: ExecutionContext["phase"],
  body: (ctx: ExecutionContext) => Effect.Effect<ExecutionContext, E>,
  deps: Pick<PhaseDeps, "hooks" | "obs" | "eb" | "state">,
): Effect.Effect<ExecutionContext, E | RuntimeErrors> => {
  const obs: ObsLike | null = deps.obs;
  const eb: EbLike | null = deps.eb;
  const startMs = performance.now();

  const publishEntered = eb
    ? eb
        .publish({ _tag: "ExecutionPhaseEntered", taskId: ctx.taskId, phase })
        .pipe(
          Effect.catchAll((err) =>
            emitErrorSwallowed({ site: "runtime/src/engine/pipeline.ts:runObservablePhase-entered-publish", tag: errorTag(err) }),
          ),
        )
    : Effect.void;

  const phaseEffect = runPhase(ctx, phase, body, deps).pipe(
    Effect.tap((_result) => {
      const durationMs = performance.now() - startMs;
      const sideEffects: Effect.Effect<void, never>[] = [];

      if (obs) {
        sideEffects.push(
          obs
            .incrementCounter("execution.phase.count", 1, { phase })
            .pipe(
              Effect.catchAll((err) =>
                emitErrorSwallowed({ site: "runtime/src/engine/pipeline.ts:runObservablePhase-counter", tag: errorTag(err) }),
              ),
            ),
        );
        sideEffects.push(
          obs
            .recordHistogram("execution.phase.duration_ms", durationMs, { phase })
            .pipe(
              Effect.catchAll((err) =>
                emitErrorSwallowed({ site: "runtime/src/engine/pipeline.ts:runObservablePhase-duration", tag: errorTag(err) }),
              ),
            ),
        );
      }
      if (eb) {
        sideEffects.push(
          eb
            .publish({ _tag: "ExecutionPhaseCompleted", taskId: ctx.taskId, phase, durationMs })
            .pipe(
              Effect.catchAll((err) =>
                emitErrorSwallowed({ site: "runtime/src/engine/pipeline.ts:runObservablePhase-completed-publish", tag: errorTag(err) }),
              ),
            ),
        );
      }

      return Effect.all(sideEffects, { concurrency: "unbounded" }).pipe(Effect.asVoid);
    }),
  );

  const withEntered = publishEntered.pipe(Effect.zipRight(phaseEffect));

  if (!obs) return withEntered;

  return obs.withSpan(
    `execution.phase.${phase}`,
    withEntered.pipe(
      Effect.tap((result) =>
        obs
          .withSpan(`phase.${phase}.metrics`, Effect.void, {
            iteration: result.iteration,
            tokensUsed: result.tokensUsed,
            cost: result.cost,
          })
          .pipe(
            Effect.catchAll((err) =>
              emitErrorSwallowed({ site: "runtime/src/engine/pipeline.ts:runObservablePhase-metrics-span", tag: errorTag(err) }),
            ),
          ),
      ),
    ),
    { taskId: ctx.taskId, agentId: ctx.agentId, phase },
  ) as Effect.Effect<ExecutionContext, E | RuntimeErrors>;
};

/**
 * Run a single phase wrapped with the lifecycle guard. This is the equivalent of
 * the inline `guardedPhase` helper from the old engine.
 *
 * Honors `phase.skip` itself (not only `runPipeline`): several sites call this
 * directly — pre-loop-dispatch (guardrail/costRoute/strategySelect),
 * execution-engine (verify/costTrack/audit/complete), verification-quality-gate
 * (verify-again). A config-gated phase whose feature is off must forward the
 * context unchanged rather than run its body — otherwise a body that throws on
 * an inapplicable input becomes an Effect defect and kills the run's fiber (the
 * cost-route streaming-fiber-kill class). All skip predicates in this codebase
 * are pure config gates, so a skip that fires here is the same decision the
 * pipeline would have made.
 */
export const runGuardedPhase = (
  phase: Phase,
  ctx: ExecutionContext,
  deps: PhaseDeps,
): Effect.Effect<ExecutionContext, RuntimeErrors> =>
  phase.skip?.(ctx, deps)
    ? (Effect.succeed(ctx) as Effect.Effect<ExecutionContext, RuntimeErrors>)
    : (checkLifecycle(ctx.taskId, deps).pipe(
        Effect.zipRight(
          runObservablePhase(ctx, phase.name, (c) => phase.run(c, deps), deps),
        ),
      ) as Effect.Effect<ExecutionContext, RuntimeErrors>);

/**
 * Compose a sequence of phases into a single execution pipeline.
 *
 * For each phase:
 * 1. If `phase.skip(ctx, deps)` returns true, the context is forwarded unchanged.
 * 2. Otherwise, the phase is wrapped with the lifecycle guard + observability span
 *    + hook firing + event emission, then run.
 *
 * Both steps are owned by `runGuardedPhase` (it honors `skip`), so every call
 * site — pipeline or direct — shares one skip contract.
 *
 * The reduction stops on the first error.
 */
export const runPipeline = (
  phases: readonly Phase[],
  initialCtx: ExecutionContext,
  deps: PhaseDeps,
): Effect.Effect<ExecutionContext, RuntimeErrors> =>
  Effect.reduce(phases, initialCtx, (ctx, phase) =>
    runGuardedPhase(phase, ctx, deps),
  );
