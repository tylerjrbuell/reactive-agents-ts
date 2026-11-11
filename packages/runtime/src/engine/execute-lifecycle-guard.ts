/**
 * Lifecycle guard helper + guarded phase wrapper.
 *
 * Owns: `checkLifecycle` (kill-switch pause/stop/triggered screen that
 * publishes AgentStopping/AgentStopped/AgentTerminated and fails with
 * `KillSwitchTriggeredError`) and the `guardedPhase` wrapper that runs the
 * lifecycle check before every observable phase and races the phase body
 * against a stop watcher (`STOP_POLL_MS`), so stop() lands mid-phase.
 *
 * (W26-A step 1) `guardedPhase` reuses `runObservablePhase` from
 * engine/pipeline.ts with the already-constructed PhaseDeps bundle.
 *
 * Moved verbatim from execution-engine.ts (GH #221 W26 decomposition,
 * "lifecycle guard helper + guarded phase wrapper" banner, former lines
 * 627-665). `checkLifecycle` stays module-internal: its only consumer is
 * `guardedPhase`, which this factory closes over alongside `ks`, `eb`,
 * `config`, and `deps` — per-construction live reads, no module state.
 */
import { Duration, Effect, Schedule } from "effect";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import type { KillSwitchValue } from "./execute-killswitch-bridge.js";
import type { ExecutionContext, ReactiveAgentsConfig } from "../types.js";
import { KillSwitchTriggeredError } from "../errors.js";
import type { RuntimeErrors } from "../errors.js";
import { runObservablePhase } from "./pipeline.js";
import type { EbLike, PhaseDeps } from "./runtime-context.js";

/**
 * How often a guarded phase re-reads the kill-switch lifecycle while its body
 * runs. Bounds `agent.stop()` latency inside the reasoning loop: the whole
 * loop (every model call and kernel iteration) is ONE guarded "think" phase,
 * so a boundary-only check let stop() wait for the loop to finish. A stop
 * seen mid-phase interrupts the body (an in-flight model call included) and
 * ends the run exactly as a boundary stop does.
 */
export const STOP_POLL_MS = 100;

export interface LifecycleGuardDeps {
  readonly ks: KillSwitchValue | null;
  readonly eb: EbLike | null;
  readonly config: ReactiveAgentsConfig;
  readonly deps: PhaseDeps;
}

export interface LifecycleGuard {
  readonly guardedPhase: <E>(
    gCtx: ExecutionContext,
    phase: ExecutionContext["phase"],
    body: (ctx: ExecutionContext) => Effect.Effect<ExecutionContext, E>,
  ) => Effect.Effect<ExecutionContext, E | RuntimeErrors>;
}

export function makeLifecycleGuard(args: LifecycleGuardDeps): LifecycleGuard {
  const { ks, eb, config, deps } = args;

  // ── Stop outcome: one shape for a boundary stop and a mid-phase stop ──
  const failStopping = (taskId: string): Effect.Effect<never, RuntimeErrors> =>
    Effect.gen(function* () {
      if (eb) yield* eb.publish({ _tag: "AgentStopping", agentId: config.agentId,
        taskId, reason: "stop() requested" }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/execute-lifecycle-guard.ts:53", tag: errorTag(err) })));
      if (eb) yield* eb.publish({ _tag: "AgentStopped", agentId: config.agentId,
        taskId, reason: "stop() requested" }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/execute-lifecycle-guard.ts:55", tag: errorTag(err) })));
      return yield* Effect.fail(new KillSwitchTriggeredError({
        message: `Agent ${config.agentId} stopping gracefully`,
        taskId, agentId: config.agentId, reason: "stop() requested",
      }));
    });

  // ── Mid-phase stop watcher: polls the lifecycle every STOP_POLL_MS and
  // fails with the stop outcome once stop() lands. Never succeeds; raced
  // against the phase body, so a finished body interrupts it.
  const watchForStop = (k: KillSwitchValue, taskId: string): Effect.Effect<never, RuntimeErrors> =>
    k.getLifecycle(config.agentId).pipe(
      Effect.repeat({ schedule: Schedule.spaced(Duration.millis(STOP_POLL_MS)), until: (s) => s === "stopping" }),
      Effect.zipRight(failStopping(taskId)),
    );

  // ── Lifecycle guard helper ──
  const checkLifecycle = (taskId: string): Effect.Effect<void, RuntimeErrors> =>
    Effect.gen(function* () {
      if (!ks) return;
      const status = yield* ks.waitIfPaused(config.agentId, taskId)
        .pipe(Effect.catchAll(() => Effect.succeed("ok" as const)));
      if (status === "stopping") return yield* failStopping(taskId);
      const ksStatus = (yield* ks.isTriggered(config.agentId)
        .pipe(Effect.catchAll(() => Effect.succeed({ triggered: false })))) as { triggered: boolean; reason?: string };
      if (ksStatus.triggered) {
        if (eb) yield* eb.publish({ _tag: "AgentTerminated", agentId: config.agentId,
          taskId, reason: ksStatus.reason ?? "terminated" }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/execute-lifecycle-guard.ts:65", tag: errorTag(err) })));
        return yield* Effect.fail(new KillSwitchTriggeredError({
          message: `Kill switch triggered for agent ${config.agentId}: ${ksStatus.reason ?? "no reason"}`,
          taskId, agentId: config.agentId, reason: ksStatus.reason ?? "no reason",
        }));
      }
    });

  // ── Guarded phase wrapper: lifecycle check before every phase ──
  // (W26-A step 1) Reuses runObservablePhase from engine/pipeline.ts
  // with the already-constructed PhaseDeps `deps` (line 547 above).
  // With a kill switch, the body also races the stop watcher, so a stop()
  // during the phase ends it within ~STOP_POLL_MS. The race sits inside the
  // observable phase: on-error hooks and phase events see the stop failure.
  const guardedPhase = <E>(
    gCtx: ExecutionContext,
    phase: ExecutionContext["phase"],
    body: (ctx: ExecutionContext) => Effect.Effect<ExecutionContext, E>,
  ): Effect.Effect<ExecutionContext, E | RuntimeErrors> => {
    const stoppable = (c: ExecutionContext): Effect.Effect<ExecutionContext, E | RuntimeErrors> =>
      ks ? Effect.raceFirst(body(c), watchForStop(ks, gCtx.taskId)) : body(c);
    return checkLifecycle(gCtx.taskId).pipe(
      Effect.zipRight(runObservablePhase(gCtx, phase, stoppable, deps)),
    );
  };

  return { guardedPhase };
}
