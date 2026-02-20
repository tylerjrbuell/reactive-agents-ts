import { Schema } from "effect";

export const InterruptTrigger = Schema.Literal(
  "error",
  "uncertainty",
  "high-cost",
  "critical-decision",
  "user-requested",
  "custom",
);
export type InterruptTrigger = typeof InterruptTrigger.Type;

export const InterruptSeverity = Schema.Literal("low", "medium", "high", "critical");
export type InterruptSeverity = typeof InterruptSeverity.Type;

export const InterruptRuleSchema = Schema.Struct({
  trigger: InterruptTrigger,
  severity: InterruptSeverity,
  threshold: Schema.optional(Schema.Number),
  enabled: Schema.Boolean,
});
export type InterruptRule = typeof InterruptRuleSchema.Type;

export const InterruptEventSchema = Schema.Struct({
  id: Schema.String,
  trigger: InterruptTrigger,
  severity: InterruptSeverity,
  agentId: Schema.String,
  taskId: Schema.String,
  message: Schema.String,
  context: Schema.optional(Schema.Unknown),
  timestamp: Schema.DateFromSelf,
  acknowledged: Schema.Boolean,
});
export type InterruptEvent = typeof InterruptEventSchema.Type;
