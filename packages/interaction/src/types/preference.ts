import { Schema } from "effect";

export const ApprovalAction = Schema.Literal("auto-approve", "auto-reject", "ask");
export type ApprovalAction = typeof ApprovalAction.Type;

export const ApprovalPatternSchema = Schema.Struct({
  id: Schema.String,
  taskType: Schema.String,
  costThreshold: Schema.optional(Schema.Number),
  action: ApprovalAction,
  confidence: Schema.Number,
  occurrences: Schema.Number,
  lastSeen: Schema.DateFromSelf,
});
export type ApprovalPattern = typeof ApprovalPatternSchema.Type;

export const InterruptionTolerance = Schema.Literal("low", "medium", "high");
export type InterruptionTolerance = typeof InterruptionTolerance.Type;

export const UserPreferenceSchema = Schema.Struct({
  userId: Schema.String,
  learningEnabled: Schema.Boolean,
  interruptionTolerance: InterruptionTolerance,
  preferredMode: Schema.optional(Schema.String),
  approvalPatterns: Schema.Array(ApprovalPatternSchema),
  lastUpdated: Schema.DateFromSelf,
});
export type UserPreference = typeof UserPreferenceSchema.Type;
