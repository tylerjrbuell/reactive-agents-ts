/**
 * iterate-guard-seams.ts — three small per-pass guard seams decomposed
 * VERBATIM from iterate-pass.ts (quality program Task 9 / GH #222):
 *   - runAutoCheckpointStep  — context-pressure auto-checkpoint (lines 1033-1050)
 *   - applyExecutionLane     — gather-vs-synthesize lane stamp (lines 1333-1345)
 *   - runIcsNudgeStep        — Intelligent Context Synthesis steering nudge
 *     (lines 1477-1491)
 * Bodies byte-identical modulo destructured params.
 */
import { Effect } from "effect";
import type { LogEvent } from "@reactive-agents/observability";
import { checkpointStoreRef } from "@reactive-agents/tools";
import type { ContextProfile } from "../../context/context-profile.js";
import type { KernelInput } from "../state/kernel-state.js";
import { coordinateICS } from "../utils/ics-coordinator.js";
import { shouldAutoCheckpoint, autoCheckpoint } from "./auto-checkpoint.js";
import { decideExecutionLane, type LaneDecision } from "../utils/lane-controller.js";
import { getLastErrors } from "./runner-helpers/state-queries.js";
import { transitionState, type KernelState } from "../../kernel/state/kernel-state.js";

/** Auto-save best observations when approaching the context-pressure gate. */
export function runAutoCheckpointStep(args: {
  readonly state: KernelState;
  readonly profile: ContextProfile;
  autoCheckpointed: boolean;
  readonly emitLog: (event: LogEvent) => Effect.Effect<void, never>;
}): Effect.Effect<{ autoCheckpointed: boolean }, never, never> {
  return Effect.gen(function* () {
    let autoCheckpointed = args.autoCheckpointed;
    const { state, profile, emitLog } = args;

      // ── Auto-checkpoint before context pressure gate ────────────────────
      // When approaching the hard pressure gate (within 5%), auto-save best
      // observations to the checkpoint store so they survive compaction.
      if (
        !autoCheckpointed &&
        shouldAutoCheckpoint({
          estimatedTokens: state.tokens,
          maxTokens: profile.maxTokens ?? Number.MAX_SAFE_INTEGER,
          tier: profile.tier,
          alreadyCheckpointed: autoCheckpointed,
        })
      ) {
        const saved = yield* autoCheckpoint(checkpointStoreRef, state.steps);
        if (saved) {
          autoCheckpointed = true;
          yield* emitLog({ _tag: "warning", message: `[auto-checkpoint] Saved best observations before context pressure gate (tokens=${state.tokens})`, timestamp: new Date() });
        }
      }
    return { autoCheckpointed };
  });
}

/** Decide + stamp this pass's execution lane (gather vs synthesize). */
export function applyExecutionLane(args: {
  state: KernelState;
  readonly currentInput: KernelInput;
}): { state: KernelState; laneDecision: LaneDecision } {
  let state = args.state;
  const { currentInput } = args;

      // ── Lane controller (gather vs synthesize) ───────────────────────────
      const laneDecision = decideExecutionLane({
        requiredTools: currentInput.requiredTools ?? [],
        requiredToolQuantities: currentInput.requiredToolQuantities,
        steps: state.steps,
      });
      state = transitionState(state, {
        meta: {
          ...state.meta,
          executionLane: laneDecision.lane,
          missingRequiredTools: laneDecision.missingRequiredTools,
        },
      });
  return { state, laneDecision };
}

/** Intelligent Context Synthesis — append-only steering nudge (never replaces the FC thread). */
export function runIcsNudgeStep(args: {
  state: KernelState;
  readonly currentInput: KernelInput;
  readonly effectiveToolsUsed: ReadonlySet<string>;
  readonly profile: ContextProfile;
  readonly shouldAllowIcsNudge: boolean;
}): Effect.Effect<KernelState, never, never> {
  return Effect.gen(function* () {
    let state = args.state;
    const { currentInput, effectiveToolsUsed, profile, shouldAllowIcsNudge } = args;

      if (shouldAllowIcsNudge) {
        const icsResult = yield* coordinateICS(state, {
          task: currentInput.task,
          requiredTools: currentInput.requiredTools ?? [],
          toolsUsed: effectiveToolsUsed,
          availableTools: (currentInput.availableToolSchemas ?? []) as readonly { name: string; description: string; parameters: unknown[] }[],
          tier: profile.tier ?? "mid",
          iteration: state.iteration,
          maxIterations: (state.meta.maxIterations as number) ?? 10,
          lastErrors: getLastErrors(state),
        });
        if (icsResult.steeringNudge) {
          state = transitionState(state, { pendingGuidance: { icsGuidance: icsResult.steeringNudge } });
        }
      }
    return state;
  });
}
