/**
 * COMPLETE phase — final phase of the execution pipeline. Marks the agent
 * state as `completed`. That's it.
 *
 * IMPORTANT: This phase does NOT include TaskResult assembly, debrief synthesis,
 * telemetry/RunReport publishing, calibration updates, bandit updates, skill
 * store writes, or AgentCompleted/Failed lifecycle event emission. Those are
 * post-pipeline orchestrator work that transforms ExecutionContext → TaskResult
 * + side effects, which is a different shape change than the phase pipeline
 * (ctx → ctx). They stay in `execution-engine.ts` for now.
 *
 * Future waves may extract those orchestrator helpers as standalone modules
 * (not phases). They probably don't belong in `engine/phases/`.
 *
 * Extracted from `execution-engine.ts:3281-3285` (Phase 10: COMPLETE).
 */
import { Effect } from "effect";
import type { Phase } from "../phase.js";

export const complete: Phase = {
  name: "complete",

  run: (ctx, _deps) =>
    Effect.succeed({ ...ctx, agentState: "completed" as const }),
};
