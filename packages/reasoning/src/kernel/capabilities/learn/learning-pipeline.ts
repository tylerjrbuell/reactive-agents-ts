/**
 * learn/learning-pipeline.ts — Compounding intelligence seam (Phase 1).
 *
 * The 10-capability kernel model declares `learn` as the per-iter
 * consolidation point where M6 skills, M7 calibration, and M10 memory
 * writes converge. Prior to this file, those writes were scattered across
 * packages with no single owner — making "compounding intelligence" a trait
 * with no enforcer. This is the seam (Issue #120 / North Star §4.3 / Audit G-D).
 *
 * Phase 1 ships ONLY:
 *   1. The `LearningPipeline` Effect Context.Tag service definition
 *   2. A `NoopLearningPipelineLayer` so the kernel runs cleanly when no
 *      learn implementation is provided
 *   3. The per-iter call site in runner.ts (post-iteration-snapshot)
 *
 * Phase 2 (separate dispatches, NOT in this file's authority):
 *   - SkillStore writer Layer (memory-warden / RI-warden)
 *   - CalibrationStore writer Layer (RI-warden)
 *   - MemoryStore writer Layer (memory-warden)
 *   - `.withLearning()` builder method (runtime-warden)
 *
 * Mirrors the precedent set by HS-113 step 2: kernel-warden ships the
 * helper + hook; consumers added by parent agent dispatch.
 *
 * Mirrors the canonical Context.Tag class-pattern at
 * `kernel/utils/service-utils.ts:33` (PromptServiceTag).
 */

import { Context, Effect, Layer } from "effect";
import type { ReasoningStep } from "../../../types/step.js";

/**
 * Outcome of a single kernel iteration. Passed into `write()` so consumers
 * can attribute learning signal to the iter's success/failure + resource
 * cost. Mid-loop callers pass a partial snapshot — `success` is only
 * authoritative on the terminal iter where state.status is "done"/"failed".
 */
export type LearningPipelineOutcome = {
  /**
   * Whether the iter ended with status="done". Authoritative ONLY on the
   * terminal iter. Mid-loop calls pass the current best-effort snapshot
   * (typically `false` while still iterating).
   */
  readonly success: boolean;
  /** Current state.output if any. Undefined when output has not been set yet. */
  readonly output?: string;
  /** state.tokens at the moment write() was invoked. */
  readonly tokensUsed: number;
  /** state.cost at the moment write() was invoked. */
  readonly costUsd: number;
};

/**
 * The LearningPipeline service surface. Single method: `write()`, called
 * once per kernel iteration after Verify finalizes state and BEFORE the
 * next iter dispatches.
 *
 * Contract decisions (matches mission-brief decisions a–d):
 *
 *   (a) `observations` — the NEW ReasoningSteps appended during this iter
 *       only (the runner diffs `state.steps` before/after). NOT the full
 *       step history.
 *
 *   (b) `decisions` — the `controllerDecisionLog` ADDITIONS this iter
 *       (runner diffs `state.controllerDecisionLog` before/after). NOT
 *       the full accumulated log.
 *
 *   (c) `outcome` — current snapshot from KernelState. `outcome.success`
 *       only meaningful on the terminal iter; mid-loop calls pass a
 *       partial outcome (success=false while still running).
 *
 *   (d) Errors swallowed — the `Effect<void, never>` signature means writes
 *       can fail internally (e.g. SkillStore disk write fails) but errors
 *       MUST NOT propagate to the kernel. Mirrors the `emitErrorSwallowed`
 *       pattern used by diagnostics.ts / service-utils.ts:252.
 */
export type LearningPipelineService = {
  /**
   * Write a per-iteration learning signal. Must never throw, never reject.
   * Implementations that perform slow I/O should fork internally — the
   * kernel main loop already wraps this call with `Effect.forkDaemon` to
   * keep the hot path non-blocking, but implementors should not rely on
   * that and should be prepared to be called inline.
   */
  readonly write: (
    observations: readonly ReasoningStep[],
    decisions: readonly string[],
    outcome: LearningPipelineOutcome,
  ) => Effect.Effect<void, never>;
};

/**
 * Effect Context.Tag for the LearningPipeline service. Resolved via
 * `Effect.serviceOption(LearningPipeline)` at the kernel call site so the
 * kernel runs unchanged when no learn layer is provided.
 *
 * Mirrors the canonical class-based Context.Tag pattern at
 * `kernel/utils/service-utils.ts:33-36` (PromptServiceTag).
 */
export class LearningPipeline extends Context.Tag("LearningPipeline")<
  LearningPipeline,
  LearningPipelineService
>() {}

/**
 * No-op default Layer. Satisfies the LearningPipeline tag and returns
 * `Effect.void` for every write call. The kernel works without any learn
 * implementation — this layer exists so consumers that want to opt into
 * the seam without supplying real writers can do so trivially.
 *
 * Default kernel runs do NOT auto-provide this layer; the kernel's call
 * site uses `Effect.serviceOption` and no-ops when the tag is absent. This
 * layer is provided for callers that want explicit "learn-enabled but
 * no-op" semantics (e.g. tests asserting the tag is wired).
 */
export const NoopLearningPipelineLayer: Layer.Layer<LearningPipeline> =
  Layer.succeed(LearningPipeline, {
    write: () => Effect.void,
  });
