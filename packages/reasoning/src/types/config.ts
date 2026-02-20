// File: src/types/config.ts
import { Schema } from "effect";
import { ReasoningStrategy } from "./reasoning.js";

// ─── Per-Strategy Configuration ───

export const ReactiveConfigSchema = Schema.Struct({
  maxIterations: Schema.Number.pipe(Schema.int(), Schema.positive()),
  temperature: Schema.Number,
});
export type ReactiveConfig = typeof ReactiveConfigSchema.Type;

export const PlanExecuteConfigSchema = Schema.Struct({
  maxRefinements: Schema.Number.pipe(Schema.int(), Schema.positive()),
  reflectionDepth: Schema.Literal("shallow", "deep"),
});
export type PlanExecuteConfig = typeof PlanExecuteConfigSchema.Type;

export const TreeOfThoughtConfigSchema = Schema.Struct({
  breadth: Schema.Number.pipe(Schema.int(), Schema.positive()),
  depth: Schema.Number.pipe(Schema.int(), Schema.positive()),
  pruningThreshold: Schema.Number,
});
export type TreeOfThoughtConfig = typeof TreeOfThoughtConfigSchema.Type;

export const ReflexionConfigSchema = Schema.Struct({
  maxRetries: Schema.Number.pipe(Schema.int(), Schema.positive()),
  selfCritiqueDepth: Schema.Literal("shallow", "deep"),
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
    reactive: { maxIterations: 10, temperature: 0.7 },
    planExecute: { maxRefinements: 2, reflectionDepth: "deep" },
    treeOfThought: { breadth: 3, depth: 3, pruningThreshold: 0.5 },
    reflexion: { maxRetries: 3, selfCritiqueDepth: "deep" },
  },
};
