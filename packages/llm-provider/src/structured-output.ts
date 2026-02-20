import { Schema } from "effect";

// ─── Common Schemas for Reasoning Strategies ───

/**
 * Schema for ReAct action parsing.
 */
export const ReActActionSchema = Schema.Struct({
  thought: Schema.String,
  action: Schema.optional(
    Schema.Struct({
      tool: Schema.String,
      input: Schema.Unknown,
    }),
  ),
  finalAnswer: Schema.optional(Schema.String),
  isComplete: Schema.Boolean,
});

export type ReActAction = Schema.Schema.Type<typeof ReActActionSchema>;

/**
 * Schema for plan generation.
 */
export const PlanSchema = Schema.Struct({
  goal: Schema.String,
  steps: Schema.Array(
    Schema.Struct({
      id: Schema.Number,
      description: Schema.String,
      tool: Schema.optional(Schema.String),
      dependsOn: Schema.optional(Schema.Array(Schema.Number)),
      estimatedDuration: Schema.optional(Schema.String),
    }),
  ),
});

export type Plan = Schema.Schema.Type<typeof PlanSchema>;

/**
 * Schema for reflection output.
 */
export const ReflectionSchema = Schema.Struct({
  taskAccomplished: Schema.Boolean,
  confidence: Schema.Number,
  strengths: Schema.Array(Schema.String),
  weaknesses: Schema.Array(Schema.String),
  needsRefinement: Schema.Boolean,
  refinementSuggestions: Schema.optional(Schema.Array(Schema.String)),
});

export type Reflection = Schema.Schema.Type<typeof ReflectionSchema>;

/**
 * Schema for strategy selection.
 */
export const StrategySelectionSchema = Schema.Struct({
  selectedStrategy: Schema.String,
  reasoning: Schema.String,
  confidence: Schema.Number,
  alternativeStrategies: Schema.Array(
    Schema.Struct({
      strategy: Schema.String,
      whyNot: Schema.String,
    }),
  ),
});

export type StrategySelection = Schema.Schema.Type<
  typeof StrategySelectionSchema
>;

/**
 * Schema for thought evaluation (Tree-of-Thought).
 */
export const ThoughtEvaluationSchema = Schema.Struct({
  score: Schema.Number,
  reasoning: Schema.String,
  strengths: Schema.Array(Schema.String),
  weaknesses: Schema.Array(Schema.String),
  shouldExpand: Schema.Boolean,
});

export type ThoughtEvaluation = Schema.Schema.Type<
  typeof ThoughtEvaluationSchema
>;

/**
 * Schema for task complexity analysis.
 */
export const ComplexityAnalysisSchema = Schema.Struct({
  score: Schema.Number,
  factors: Schema.Array(
    Schema.Struct({
      factor: Schema.String,
      weight: Schema.Number,
      reasoning: Schema.String,
    }),
  ),
  recommendedStrategy: Schema.String,
  recommendedModel: Schema.String,
});

export type ComplexityAnalysis = Schema.Schema.Type<
  typeof ComplexityAnalysisSchema
>;
