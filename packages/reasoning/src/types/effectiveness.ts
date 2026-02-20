// File: src/types/effectiveness.ts
import { Schema } from "effect";
import { ReasoningStrategy } from "./reasoning.js";

// ─── Strategy Effectiveness Record ───

export const StrategyEffectivenessSchema = Schema.Struct({
  strategy: ReasoningStrategy,
  taskType: Schema.String,
  successRate: Schema.Number, // 0-1
  avgCost: Schema.Number,
  avgDuration: Schema.Number,
  avgConfidence: Schema.Number,
  executions: Schema.Number,
  lastUsed: Schema.DateFromSelf,
});
export type StrategyEffectiveness = typeof StrategyEffectivenessSchema.Type;
