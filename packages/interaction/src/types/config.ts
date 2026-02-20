import { Schema } from "effect";
import { InteractionModeType } from "./mode.js";
import { CheckpointConfigSchema } from "./checkpoint.js";
import { ReportingConfigSchema } from "./notification.js";
import { InterruptRuleSchema } from "./interrupt.js";

// ─── Escalation / De-escalation rules ───

export const EscalationConditionType = Schema.Literal(
  "uncertainty",
  "cost",
  "duration",
  "user-active",
  "confidence",
  "consecutive-approvals",
);
export type EscalationConditionType = typeof EscalationConditionType.Type;

export const EscalationConditionSchema = Schema.Struct({
  type: EscalationConditionType,
  threshold: Schema.Number,
});
export type EscalationCondition = typeof EscalationConditionSchema.Type;

export const ModeTransitionRuleSchema = Schema.Struct({
  from: InteractionModeType,
  to: InteractionModeType,
  conditions: Schema.Array(EscalationConditionSchema),
});
export type ModeTransitionRule = typeof ModeTransitionRuleSchema.Type;

// ─── Full Interaction Config ───

export const InteractionConfigSchema = Schema.Struct({
  defaultMode: InteractionModeType,
  interruptRules: Schema.Array(InterruptRuleSchema),
  reporting: ReportingConfigSchema,
  checkpoints: Schema.optional(CheckpointConfigSchema),
  escalationRules: Schema.Array(ModeTransitionRuleSchema),
  deescalationRules: Schema.Array(ModeTransitionRuleSchema),
  learningEnabled: Schema.Boolean,
});
export type InteractionConfig = typeof InteractionConfigSchema.Type;

// ─── Default Config ───

export const defaultInteractionConfig: InteractionConfig = {
  defaultMode: "autonomous",
  interruptRules: [
    { trigger: "error", severity: "high", enabled: true },
    { trigger: "uncertainty", severity: "medium", threshold: 0.3, enabled: true },
    { trigger: "high-cost", severity: "medium", threshold: 10.0, enabled: true },
    { trigger: "critical-decision", severity: "critical", enabled: true },
  ],
  reporting: {
    frequency: "milestone",
    channel: "event-bus",
    detail: "summary",
    streaming: false,
  },
  escalationRules: [
    {
      from: "autonomous",
      to: "supervised",
      conditions: [{ type: "uncertainty", threshold: 0.3 }],
    },
    {
      from: "supervised",
      to: "collaborative",
      conditions: [
        { type: "uncertainty", threshold: 0.5 },
        { type: "user-active", threshold: 1 },
      ],
    },
  ],
  deescalationRules: [
    {
      from: "collaborative",
      to: "autonomous",
      conditions: [
        { type: "confidence", threshold: 0.9 },
        { type: "consecutive-approvals", threshold: 3 },
      ],
    },
  ],
  learningEnabled: true,
};
