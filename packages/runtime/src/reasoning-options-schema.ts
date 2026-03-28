/**
 * JSON-serializable `.withReasoning()` shape (no `synthesisStrategy` function).
 * @see ReasoningOptions in types.ts — encoded row + optional runtime strategy
 */
import { Schema } from "effect";
import {
  ReactiveConfigSchema,
  PlanExecuteConfigSchema,
  TreeOfThoughtConfigSchema,
  ReflexionConfigSchema,
  ReasoningStrategy,
} from "@reactive-agents/reasoning";

const StrategyIcsOverlaySchema = Schema.Struct({
  synthesis: Schema.optional(Schema.Literal("auto", "fast", "deep", "custom", "off")),
  synthesisModel: Schema.optional(Schema.String),
  synthesisProvider: Schema.optional(Schema.String),
  synthesisTemperature: Schema.optional(Schema.Number),
});

export const ReactiveStrategyBundleSchema = Schema.extend(ReactiveConfigSchema, StrategyIcsOverlaySchema);
export const PlanExecuteStrategyBundleSchema = Schema.extend(PlanExecuteConfigSchema, StrategyIcsOverlaySchema);
export const TreeOfThoughtStrategyBundleSchema = Schema.extend(TreeOfThoughtConfigSchema, StrategyIcsOverlaySchema);
export const ReflexionStrategyBundleSchema = Schema.extend(ReflexionConfigSchema, StrategyIcsOverlaySchema);

export const ReasoningStrategiesJsonSchema = Schema.partial(
  Schema.Struct({
    reactive: ReactiveStrategyBundleSchema,
    planExecute: PlanExecuteStrategyBundleSchema,
    treeOfThought: TreeOfThoughtStrategyBundleSchema,
    reflexion: ReflexionStrategyBundleSchema,
  }),
);

export const ReasoningOptionsJsonSchema = Schema.Struct({
  defaultStrategy: Schema.optional(ReasoningStrategy),
  strategies: Schema.optional(ReasoningStrategiesJsonSchema),
  adaptive: Schema.optional(
    Schema.Struct({
      enabled: Schema.optional(Schema.Boolean),
      learning: Schema.optional(Schema.Boolean),
    }),
  ),
  enableStrategySwitching: Schema.optional(Schema.Boolean),
  maxStrategySwitches: Schema.optional(Schema.Number),
  fallbackStrategy: Schema.optional(Schema.String),
  maxIterations: Schema.optional(Schema.Number),
  synthesis: Schema.optional(Schema.Literal("auto", "fast", "deep", "custom", "off")),
  synthesisModel: Schema.optional(Schema.String),
  synthesisProvider: Schema.optional(Schema.String),
  synthesisTemperature: Schema.optional(Schema.Number),
});

export type ReasoningOptionsEncoded = typeof ReasoningOptionsJsonSchema.Type;
