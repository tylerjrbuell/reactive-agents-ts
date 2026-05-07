/**
 * Phase — first-class typed value representing a single execution-engine pipeline stage.
 *
 * The execution engine composes a list of `Phase` values into a sequential pipeline.
 * Each phase receives the current `ExecutionContext` plus a shared `PhaseDeps` bundle
 * (services, refs, config) and produces an updated `ExecutionContext`.
 *
 * Design contract:
 * - Phases are pure values exported from `engine/phases/{name}.ts`.
 * - The pipeline runner (`pipeline.ts:runPipeline`) wraps every phase in:
 *   - lifecycle check (kill-switch + pause)
 *   - observability span
 *   - hook firing (before/after/on-error)
 *   - `ExecutionPhaseEntered` / `ExecutionPhaseCompleted` event publishing
 *   - duration histograms + counter metrics
 *
 *   Phases must NOT do any of the above themselves — the runner is the single owner.
 *
 * - Cross-phase mutable state lives on `PhaseDeps.state` (typed `Ref` values).
 *   No closure capture between phases. No bag-of-everything `metadata` blob.
 *
 * - `skip` is the canonical optional-phase predicate. Returning true is a no-op
 *   (context passes through unchanged). Used for `guardrail`, `cost-route`, `verify`,
 *   `cost-track`, `audit` which are config-gated.
 */
import type { Effect } from "effect";
import type { ExecutionContext } from "../types.js";
import type { RuntimeErrors } from "../errors.js";
import type { TaskError } from "@reactive-agents/core";
import type { PhaseDeps } from "./runtime-context.js";

export interface Phase {
  /** Phase identifier — must match a `LifecyclePhase` literal in `types.ts`. */
  readonly name: ExecutionContext["phase"];

  /**
   * Optional skip predicate. If returns true, the phase body is bypassed and the
   * context is forwarded unchanged. Used for config-gated optional phases.
   */
  readonly skip?: (ctx: ExecutionContext, deps: PhaseDeps) => boolean;

  /**
   * Phase body — pure transformation of `ExecutionContext` with side effects allowed
   * via `deps`. Must NOT publish `ExecutionPhase*` events — the runner handles that.
   */
  readonly run: (
    ctx: ExecutionContext,
    deps: PhaseDeps,
  ) => Effect.Effect<ExecutionContext, RuntimeErrors | TaskError>;
}

export type Phases = readonly Phase[];
