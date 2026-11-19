import { Schema } from "effect";

/** A tree-of-thought node as explored by the strategy. */
export const TotNodeStepDataSchema = Schema.Struct({
  kind: Schema.Literal("tot-node"),
  /** Stable node id, unique within one tree-of-thought run. */
  nodeId: Schema.String,
  /** Parent node id; `null` for a root node. */
  parentId: Schema.NullOr(Schema.String),
  /** Depth in the tree (root = 0). */
  depth: Schema.Number,
  /** Strategy-assigned score for this node. */
  score: Schema.Number,
  /** True when the node was pruned from further expansion. */
  pruned: Schema.Boolean,
  /** True when the node lies on the selected (best) path. */
  selected: Schema.Boolean,
  /** The node's thought content. */
  content: Schema.String,
});

/** The node path tree-of-thought selected to execute. */
export const TotPathStepDataSchema = Schema.Struct({
  kind: Schema.Literal("tot-path"),
  /** Node ids from root to leaf, in order. */
  nodeIds: Schema.Array(Schema.String),
});

/** One code-action turn: generated code and its sandbox result. */
export const CodeActionStepDataSchema = Schema.Struct({
  kind: Schema.Literal("code-action"),
  /** The code the model produced (language is strategy-defined). */
  code: Schema.String,
  /** Captured standard output; absent when the code did not run or printed nothing. */
  stdout: Schema.optional(Schema.String),
  /** Captured standard error; absent when none. */
  stderr: Schema.optional(Schema.String),
  /** Verification outcome; absent when the strategy did not verify this turn. */
  verify: Schema.optional(
    Schema.Struct({
      /** Verdict label (e.g. "pass", "fail"). */
      verdict: Schema.String,
      /** Short human-readable summary of the verification. */
      summary: Schema.String,
    }),
  ),
});

/** One reflexion critique round. */
export const ReflexionStepDataSchema = Schema.Struct({
  kind: Schema.Literal("reflexion"),
  /** The critique the model produced of its previous attempt. */
  critique: Schema.String,
  /** True when the critique accepted the attempt (loop ends). */
  accepted: Schema.Boolean,
});

/** Adaptive strategy's choice of sub-strategy. */
export const StrategyChoiceStepDataSchema = Schema.Struct({
  kind: Schema.Literal("strategy-choice"),
  /** Name of the strategy adaptive selected (e.g. "reactive", "plan-execute"). */
  selected: Schema.String,
  /**
   * Why it was selected. Known values: `heuristic`, `classifier`, `classifier-skip`,
   * `cost-downgrade`, `fallback`, `explicit`. Open string: consumers must tolerate new values.
   */
  reason: Schema.String,
  /** Free-form human-readable detail; absent when there is none. */
  note: Schema.optional(Schema.String),
});

/** Lifecycle states of one plan step. */
export const PlanStepLifecycleSchema = Schema.Literal(
  "started",
  "done",
  "failed",
  "retry",
  "patched",
  "reflected",
);

/** One lifecycle transition of a plan-execute / blueprint step. */
export const PlanStepEventDataSchema =Schema.Struct({
  kind: Schema.Literal("plan-step"),
  /** Zero-based or strategy-defined index of the step within the plan; stable across retries. */
  stepIndex: Schema.Number,
  /** Lifecycle transition this event records. */
  status: PlanStepLifecycleSchema,
  /** Attempt number (1-based) for `retry` transitions; absent otherwise. */
  attempt: Schema.optional(Schema.Number),
  /** Free-form human-readable detail (error, patch summary, reflection); absent when none. */
  note: Schema.optional(Schema.String),
});

/**
 * Strategy-specific structured payload carried by `ReasoningStepCompleted.structured`.
 * Discriminated on `kind`. Consumers must ignore unknown kinds (the union may widen).
 */
export const ReasoningStepDataSchema = Schema.Union(
  TotNodeStepDataSchema,
  TotPathStepDataSchema,
  CodeActionStepDataSchema,
  ReflexionStepDataSchema,
  StrategyChoiceStepDataSchema,
  PlanStepEventDataSchema,
);

/** Structured payload for a reasoning step; see {@link ReasoningStepDataSchema}. */
export type ReasoningStepData = Schema.Schema.Type<typeof ReasoningStepDataSchema>;
