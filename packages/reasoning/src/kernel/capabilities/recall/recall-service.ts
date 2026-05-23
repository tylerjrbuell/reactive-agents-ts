/**
 * recall/recall-service.ts — Per-iter memory/skill/profile recall seam (Phase 1).
 *
 * The 10-capability kernel model declares `recall` as the per-iter point where
 * the kernel pulls relevant context BEFORE reasoning fires. Prior to this file,
 * recall happened only UPSTREAM in the runtime engine bootstrap
 * (packages/runtime/src/engine/bootstrap/skill-postprocess.ts +
 * reasoning-think.ts) — the kernel CONSUMED pre-loaded context
 * (`input.priorContext`, `input.briefResolvedSkills`) but never recalled
 * per-iter. This is the per-iter seam (Issue #129 / North Star §4.3 /
 * Audit G-C / Optimal Execution Algorithm step 4).
 *
 * After HS-120 Phase 1 (learn/), this file completes the 8→10 directory-count
 * audit gap.
 *
 * Phase 1 ships ONLY:
 *   1. The `RecallService` Effect Context.Tag definition (3 methods)
 *   2. A `NoopRecallServiceLayer` so the kernel runs cleanly when no recall
 *      implementation is provided
 *   3. The per-iter call site in runner.ts (iter-start, BEFORE the think
 *      phase dispatches) — wires `recallMemoryContext` + `findSkills`
 *
 * Phase 2 (separate dispatches, NOT in this file's authority):
 *   - MemoryStore-backed recall Layer (memory-warden)
 *   - SkillStore-backed findSkills Layer (RI-warden)
 *   - CalibrationStore-backed loadProfile Layer (runtime-warden)
 *   - Engine-bootstrap recall migration (runtime-warden) — moves the
 *     currently-upstream recall through this seam
 *   - `.withRecall()` builder method (runtime-warden)
 *
 * Mirrors the precedent set by HS-120 (learn/learning-pipeline.ts):
 *   kernel-warden ships the helper + hook; consumers added by parent agent
 *   dispatch.
 *
 * Mirrors the canonical Context.Tag class-pattern at
 * `kernel/utils/service-utils.ts:33` (PromptServiceTag).
 */

import { Context, Effect, Layer } from "effect";
import type { KernelState } from "../../state/kernel-state.js";
import type { TaskClassification } from "../comprehend/task-classification.js";

/**
 * Recalled memory context. Returned by `recallMemoryContext`.
 *
 * `semanticContext` is the free-form distilled context the consumer wants the
 * model to see (e.g. summarized prior runs, retrieved-document excerpts).
 * `episodic` is an optional list of timestamped episodic entries — used by
 * M10 memory recall when episodic retrieval is enabled.
 *
 * Phase 1 callers (runner.ts iter-start) store this in a per-iter LOCAL
 * variable. KernelState mutation is deferred to Phase 2.
 */
export type MemoryRecallResult = {
  readonly semanticContext: string;
  readonly episodic?: readonly { readonly content: string; readonly timestamp: number }[];
};

/**
 * A skill discovered by `findSkills`. Phase 1 shape mirrors what
 * `state.briefResolvedSkills` carries today (name + purpose). Phase 2 may
 * widen this once the SkillStore writer Layer (RI-warden) ships.
 */
export type FoundSkill = {
  readonly name: string;
  readonly purpose: string;
};

/**
 * A pre-execution profile snapshot. Today this is loaded UPSTREAM in
 * `packages/runtime/src/engine/bootstrap/` and threaded through KernelInput
 * (`calibration`, `agentProfile`). Phase 2 (runtime-warden) migrates that
 * load through this method so the kernel becomes the single source of
 * pre-iter recall.
 *
 * `calibration` is the M7 model calibration (steeringCompliance,
 * parallelCallCapability, etc.). `agentProfile` is the runtime-resolved
 * agent identity/role. Both typed as `unknown` here to keep Phase 1's
 * kernel-warden authority decoupled from `@reactive-agents/llm-provider` /
 * runtime — Phase 2 will narrow these with the concrete types when the
 * caller exists.
 */
export type ProfileSnapshot = {
  readonly calibration?: unknown;
  readonly agentProfile?: unknown;
};

/**
 * The RecallService service surface. Three methods, all `Effect<R, never>`:
 *
 *   - `recallMemoryContext` — per-iter memory recall (semantic + optional
 *     episodic). Wired at runner.ts iter-start, Phase 1.
 *
 *   - `findSkills` — per-iter relevant-skill lookup. Wired at runner.ts
 *     iter-start, Phase 1.
 *
 *   - `loadProfile` — pre-execution profile/calibration load. NO CALLER
 *     this commit. Phase 2 (runtime-warden) migrates the existing
 *     `packages/runtime/src/engine/bootstrap/` profile load through this
 *     method. Defined here so the seam shape is stable across the
 *     8→10 capability transition; consumer to be added by runtime-warden
 *     dispatch.
 *
 * Contract decisions:
 *
 *   (a) `state` — current KernelState snapshot. Passed by value; recall
 *       implementations MUST NOT mutate.
 *
 *   (b) `taskClassification` — optional. KernelInput doesn't carry it
 *       today (the canonical classifier lives in
 *       `kernel/capabilities/comprehend/task-classification.ts` and is
 *       called UPSTREAM by the execution engine). Phase 1 wire passes
 *       `undefined`; Phase 2 may plumb it once runtime-warden threads
 *       the classification result through KernelInput.
 *
 *   (c) Results are ADVISORY, not authoritative. Strategies still consume
 *       `input.priorContext` / `input.briefResolvedSkills` as today —
 *       Phase 2 decides whether to merge recall results into the prompt
 *       directly or expose them via a new KernelState field.
 *
 *   (d) Error channel is `never`. Recall failures (vector-store down,
 *       SkillStore disk error, calibration parse failure) MUST be
 *       swallowed by implementations. Mirrors the
 *       `emitErrorSwallowed` pattern used by diagnostics.ts /
 *       service-utils.ts:252 and HS-120 LearningPipeline.
 */
export type RecallServiceMethods = {
  /**
   * Recall memory context relevant to the current task/iter. Called at
   * iter-start BEFORE the think phase fires so the result is available to
   * Phase 2 consumers that thread it into the model prompt. Implementations
   * SHOULD return quickly (consumer runs synchronously in the kernel hot
   * path) — long-running vector searches should be bounded internally.
   */
  readonly recallMemoryContext: (
    state: KernelState,
    taskClassification?: TaskClassification,
  ) => Effect.Effect<MemoryRecallResult, never>;

  /**
   * Find skills relevant to the current task/iter. Returns the list of
   * matched skills (name + purpose). Called at iter-start alongside
   * `recallMemoryContext`. Phase 1 result is stored in a per-iter local;
   * Phase 2 (RI-warden) will decide whether to merge into
   * `state.briefResolvedSkills` or expose via a new field.
   */
  readonly findSkills: (
    state: KernelState,
    taskClassification?: TaskClassification,
  ) => Effect.Effect<readonly FoundSkill[], never>;

  /**
   * Load pre-execution profile/calibration. NO CALLER in Phase 1 — this
   * method exists so the seam surface is stable for Phase 2
   * (runtime-warden) migration of the existing
   * `packages/runtime/src/engine/bootstrap/` profile-load path through
   * this seam.
   */
  readonly loadProfile: (
    state: KernelState,
  ) => Effect.Effect<ProfileSnapshot, never>;
};

/**
 * Effect Context.Tag for the RecallService. Resolved via
 * `Effect.serviceOption(RecallService)` at the kernel call site so the
 * kernel runs unchanged when no recall layer is provided.
 *
 * Mirrors the canonical class-based Context.Tag pattern at
 * `kernel/utils/service-utils.ts:33-36` (PromptServiceTag) and
 * `kernel/capabilities/learn/learning-pipeline.ts:100` (LearningPipeline).
 *
 * Call-site contract:
 *   - Fires per-iter at iter-start, BEFORE the think phase dispatches.
 *   - Results are advisory, NOT authoritative — strategies still consume
 *     `input.priorContext` / `input.briefResolvedSkills`.
 *   - Error channel is `never` — recall failures MUST be swallowed by
 *     implementations.
 */
export class RecallService extends Context.Tag("RecallService")<
  RecallService,
  RecallServiceMethods
>() {}

/**
 * No-op default Layer. Satisfies the RecallService tag and returns empty
 * results for every method. The kernel works without any recall
 * implementation — this layer exists so consumers that want to opt into
 * the seam without supplying real implementations can do so trivially.
 *
 * Default kernel runs do NOT auto-provide this layer; the kernel's call
 * site uses `Effect.serviceOption` and no-ops when the tag is absent. This
 * layer is provided for callers that want explicit "recall-enabled but
 * empty" semantics (e.g. tests asserting the tag is wired).
 */
export const NoopRecallServiceLayer: Layer.Layer<RecallService> =
  Layer.succeed(RecallService, {
    recallMemoryContext: () =>
      Effect.succeed<MemoryRecallResult>({ semanticContext: "", episodic: [] }),
    findSkills: () => Effect.succeed<readonly FoundSkill[]>([]),
    loadProfile: () => Effect.succeed<ProfileSnapshot>({}),
  });
