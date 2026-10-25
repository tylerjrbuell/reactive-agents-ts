// File: src/types/config.ts
import { Schema } from "effect";
import { ReasoningStrategy } from "./reasoning.js";

// ─── Per-Strategy Configuration ───

export const ReactiveConfigSchema = Schema.Struct({
  maxIterations: Schema.Number.pipe(Schema.int(), Schema.positive()),
  /**
   * Explicitness signal (2026-10-23 explicit-cap fix). `true` ONLY when
   * `maxIterations` is a user-declared cap — set by the runtime layer
   * construction in `@reactive-agents/runtime` when the developer called
   * `.withMaxIterations()` / `.withReasoning({ maxIterations })` (or passed
   * `strategies.reactive.maxIterations` directly). Absent means the value is
   * `defaultReasoningConfig`'s fallback (10), indistinguishable from an
   * explicit 10 — so the tier context-profile hint still clamps it.
   * Precedence is applied by `resolveMaxIterationCap()` in
   * `strategies/reactive.ts`; other consumers can ignore this field.
   */
  maxIterationsExplicit: Schema.optional(Schema.Boolean),
  temperature: Schema.Number,
  toolElaboration: Schema.optional(
    Schema.Struct({
      enabled: Schema.Boolean,
      maxHintsPerTool: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())),
    }),
  ),
  nextMovesPlanning: Schema.optional(
    Schema.Struct({
      enabled: Schema.Boolean,
      maxBatchSize: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())),
      allowParallelBatching: Schema.optional(Schema.Boolean),
    }),
  ),
});
export type ReactiveConfig = typeof ReactiveConfigSchema.Type;

export const PlanExecuteConfigSchema = Schema.Struct({
  maxRefinements: Schema.Number.pipe(Schema.int(), Schema.positive()),
  reflectionDepth: Schema.Literal("shallow", "deep"),
  stepKernelMaxIterations: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())),
  planMode: Schema.optional(Schema.Literal("linear", "dag")),
  stepRetries: Schema.optional(Schema.Number.pipe(Schema.int())),
});
export type PlanExecuteConfig = typeof PlanExecuteConfigSchema.Type;

export const TreeOfThoughtConfigSchema = Schema.Struct({
  breadth: Schema.Number.pipe(Schema.int(), Schema.positive()),
  depth: Schema.Number.pipe(Schema.int(), Schema.positive()),
  pruningThreshold: Schema.Number,
  /** Maximum cost (USD) for the exploration phase before early-terminating. */
  maxCost: Schema.optional(Schema.Number),
  /**
   * HS-110 / M3 cost gate (default `true`): when the pre-execution complexity
   * classifier marks the task as trivial with confidence ≥ 0.7, skip the BFS
   * exploration entirely and delegate to the same react kernel Phase 2 would
   * have used. Set to `false` to force BFS regardless of task complexity
   * (e.g. for benchmarks or research probes that need to exercise the
   * exploration path on simple prompts).
   */
  skipBfsForTrivial: Schema.optional(Schema.Boolean),
});
export type TreeOfThoughtConfig = typeof TreeOfThoughtConfigSchema.Type;

export const ReflexionConfigSchema = Schema.Struct({
  maxRetries: Schema.Number.pipe(Schema.int(), Schema.positive()),
  selfCritiqueDepth: Schema.Literal("shallow", "deep"),
  kernelMaxIterations: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())),
});
export type ReflexionConfig = typeof ReflexionConfigSchema.Type;

// ─── Full Reasoning Config ───

export const ReasoningConfigSchema = Schema.Struct({
  defaultStrategy: ReasoningStrategy,
  adaptive: Schema.Struct({
    enabled: Schema.Boolean,
    learning: Schema.Boolean,
  }),
  strategies: Schema.Struct({
    reactive: ReactiveConfigSchema,
    planExecute: PlanExecuteConfigSchema,
    treeOfThought: TreeOfThoughtConfigSchema,
    reflexion: ReflexionConfigSchema,
  }),
});
export type ReasoningConfig = typeof ReasoningConfigSchema.Type;

// ─── Default Config ───

export const defaultReasoningConfig: ReasoningConfig = {
  defaultStrategy: "reactive",
  adaptive: { enabled: false, learning: false },
  strategies: {
    reactive: {
      maxIterations: 10,
      temperature: 0.7,
      toolElaboration: { enabled: false, maxHintsPerTool: 2 },
      nextMovesPlanning: { enabled: true, maxBatchSize: 4, allowParallelBatching: true },
    },
    planExecute: { maxRefinements: 2, reflectionDepth: "deep" },
    treeOfThought: { breadth: 3, depth: 3, pruningThreshold: 0.5 },
    reflexion: { maxRetries: 3, selfCritiqueDepth: "deep" },
  },
};
