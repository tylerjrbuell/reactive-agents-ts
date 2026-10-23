/**
 * Lifecycle guard helper + guarded phase wrapper.
 *
 * Owns: `checkLifecycle` (kill-switch pause/stop/triggered screen that
 * publishes AgentStopping/AgentStopped/AgentTerminated and fails with
 * `KillSwitchTriggeredError`) and the `guardedPhase` wrapper that runs the
 * lifecycle check before every observable phase.
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
import { Effect } from "effect";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import type { KillSwitchValue } from "./execute-killswitch-bridge.js";
import type { ExecutionContext, ReactiveAgentsConfig } from "../types.js";
import { KillSwitchTriggeredError } from "../errors.js";
import type { RuntimeErrors } from "../errors.js";
import { runObservablePhase } from "./pipeline.js";
import type { EbLike, PhaseDeps } from "./runtime-context.js";

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

  // ── Lifecycle guard helper ──
  const checkLifecycle = (taskId: string): Effect.Effect<void, RuntimeErrors> =>
    Effect.gen(function* () {
      if (!ks) return;
      const status = yield* ks.waitIfPaused(config.agentId, taskId)
        .pipe(Effect.catchAll(() => Effect.succeed("ok" as const)));
      if (status === "stopping") {
        if (eb) yield* eb.publish({ _tag: "AgentStopping", agentId: config.agentId,
          taskId, reason: "stop() requested" }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:737", tag: errorTag(err) })));
        if (eb) yield* eb.publish({ _tag: "AgentStopped", agentId: config.agentId,
          taskId, reason: "stop() requested" }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:739", tag: errorTag(err) })));
        return yield* Effect.fail(new KillSwitchTriggeredError({
          message: `Agent ${config.agentId} stopping gracefully`,
          taskId, agentId: config.agentId, reason: "stop() requested",
        }));
      }
      const ksStatus = (yield* ks.isTriggered(config.agentId)
        .pipe(Effect.catchAll(() => Effect.succeed({ triggered: false })))) as { triggered: boolean; reason?: string };
      if (ksStatus.triggered) {
        if (eb) yield* eb.publish({ _tag: "AgentTerminated", agentId: config.agentId,
          taskId, reason: ksStatus.reason ?? "terminated" }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:749", tag: errorTag(err) })));
        return yield* Effect.fail(new KillSwitchTriggeredError({
          message: `Kill switch triggered for agent ${config.agentId}: ${ksStatus.reason ?? "no reason"}`,
          taskId, agentId: config.agentId, reason: ksStatus.reason ?? "no reason",
        }));
      }
    });

  // ── Guarded phase wrapper: lifecycle check before every phase ──
  // (W26-A step 1) Reuses runObservablePhase from engine/pipeline.ts
  // with the already-constructed PhaseDeps `deps` (line 547 above).
  const guardedPhase = <E>(
    gCtx: ExecutionContext,
    phase: ExecutionContext["phase"],
    body: (ctx: ExecutionContext) => Effect.Effect<ExecutionContext, E>,
  ): Effect.Effect<ExecutionContext, E | RuntimeErrors> =>
    checkLifecycle(gCtx.taskId).pipe(
      Effect.zipRight(runObservablePhase(gCtx, phase, body, deps)),
    );

  return { guardedPhase };
}
