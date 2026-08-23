/**
 * StrategySelectorService — bandit-driven reasoning-strategy selection.
 *
 * Wiring context (2026-08-21 gap fix): `learning-engine.ts` already writes
 * per-(model, taskCategory, strategy) reward stats into the shared
 * `BanditStore` via `updateArm` on every completed run. But nothing ever
 * called `selectArm` to read those stats back — the bandit recorded outcomes
 * for a decision it never actually made. `packages/runtime`'s
 * `strategy-select.ts` Phase already declares an ad-hoc
 * `Context.GenericTag<{select}>("StrategySelector")` seam and falls back to
 * `config.defaultStrategy` when no implementation is provided — this module
 * is the adapter that fills that seam using the SAME bandit store the write
 * side uses.
 *
 * Context-bucket parity: the read side here MUST derive the context bucket
 * string using the exact same `${modelId}:${taskCategory}` format and the
 * same `classifyTaskCategory` classifier as `learning-engine.ts:105,126`,
 * otherwise `selectArm` would query a bucket the write side never populates
 * and Thompson sampling degenerates to permanent cold-start (uniform
 * random) forever.
 *
 * OPT-IN ONLY. See `ReactiveIntelligenceConfig.learning.banditStrategySelection`
 * in `../types.ts` — defaults to `undefined`/disabled. Do NOT flip the
 * default to enabled without a cross-tier ablation-warden pass first (this
 * project's lift rule: ≥3pp lift AND ≤15% token overhead across ≥2 model
 * tiers before any default-on change to runtime decision-making).
 */
import { Context, Effect, Layer } from "effect";
import { selectArm } from "./bandit.js";
import type { BanditStore } from "./bandit-store.js";
import { classifyTaskCategory } from "./task-classifier.js";

/** Minimal shape of the selection context the runtime `strategy-select.ts`
 *  Phase passes into `.select(selCtx, memCtx)`. Duck-typed (not imported
 *  from `@reactive-agents/runtime`) to avoid a package-layering dependency
 *  from reactive-intelligence -> runtime. */
export type StrategySelectionContext = {
  readonly taskDescription: string;
  readonly taskType?: string;
  readonly complexity?: number;
  readonly urgency?: number;
  /** Resolved model id, threaded by runtime's strategy-select.ts Phase.
   *  Falls back to "unknown" when absent so the bucket format stays stable. */
  readonly modelId?: string;
};

// NOTE: identifier string MUST be exactly "StrategySelector" — Effect's
// `Context.Tag`/`Context.GenericTag` resolve services by this string id
// (via `Symbol.for`), and `packages/runtime/src/engine/phases/strategy-select.ts`
// resolves an ad-hoc `Context.GenericTag<...>("StrategySelector")` under that
// exact id. Renaming the identifier here breaks cross-package resolution
// silently (the Phase would just see `Effect.serviceOption` return `None`
// and fall back to `defaultStrategy`, no error).
/**
 * Default candidate arms when `armIds` is omitted from config. Mirrors the
 * core registered strategy names in
 * `packages/reasoning/src/services/strategy-registry.ts` (excludes literature
 * aliases "react"/"rewoo" which are duplicate registrations of
 * "reactive"/"blueprint", and "reflexion"/"direct"/"code-action" which are
 * narrower special-purpose strategies not meant as general bandit arms).
 */
export const DEFAULT_BANDIT_ARM_IDS: readonly string[] = [
  "reactive",
  "plan-execute-reflect",
  "tree-of-thought",
  "adaptive",
  "blueprint",
];

export class StrategySelectorService extends Context.Tag(
  "StrategySelector",
)<
  StrategySelectorService,
  {
    readonly select: (
      selCtx: StrategySelectionContext,
      memCtx: unknown,
    ) => Effect.Effect<string>;
  }
>() {}

/**
 * Build the bandit-context-bucket string for a given selection context,
 * using the identical format the write side (`learning-engine.ts:126`)
 * uses: `${modelId}:${taskCategory}`.
 */
export const deriveContextBucket = (selCtx: StrategySelectionContext): string => {
  const taskCategory = classifyTaskCategory(selCtx.taskDescription ?? "");
  const modelId = selCtx.modelId ?? "unknown";
  return `${modelId}:${taskCategory}`;
};

/**
 * Construct a `StrategySelectorService` Layer backed by `banditStore` —
 * the SAME instance `createReactiveIntelligenceLayer` shares with
 * `LearningEngineServiceLive`, so reads reflect what the write side wrote.
 *
 * @param armIds candidate strategy names to select between (the framework's
 *   registered strategy names — see `strategy-registry.ts`).
 * @param banditStore shared store instance (not a fresh one).
 */
export const StrategySelectorServiceLive = (
  armIds: readonly string[],
  banditStore: BanditStore,
): Layer.Layer<StrategySelectorService> =>
  Layer.succeed(StrategySelectorService, {
    select: (selCtx) =>
      Effect.sync(() => {
        if (armIds.length === 0) {
          return "reactive";
        }
        const contextBucket = deriveContextBucket(selCtx);
        return selectArm(contextBucket, armIds, banditStore);
      }),
  });
