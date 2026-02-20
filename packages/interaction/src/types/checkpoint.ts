import { Schema } from "effect";

// ─── Checkpoint Status ───

export const CheckpointStatus = Schema.Literal(
  "pending",
  "approved",
  "rejected",
  "auto-approved",
  "expired",
);
export type CheckpointStatus = typeof CheckpointStatus.Type;

// ─── Checkpoint ───

export const CheckpointSchema = Schema.Struct({
  id: Schema.String,
  agentId: Schema.String,
  taskId: Schema.String,
  milestoneName: Schema.String,
  description: Schema.String,
  status: CheckpointStatus,
  createdAt: Schema.DateFromSelf,
  resolvedAt: Schema.optional(Schema.DateFromSelf),
  userComment: Schema.optional(Schema.String),
});
export type Checkpoint = typeof CheckpointSchema.Type;

// ─── Checkpoint Config ───

export const CheckpointFrequency = Schema.Literal("milestone", "time-based");
export type CheckpointFrequency = typeof CheckpointFrequency.Type;

export const AutoApproveAction = Schema.Literal("approve", "reject", "pause");
export type AutoApproveAction = typeof AutoApproveAction.Type;

export const CheckpointConfigSchema = Schema.Struct({
  frequency: CheckpointFrequency,
  intervalMs: Schema.optional(Schema.Number),
  milestones: Schema.optional(Schema.Array(Schema.String)),
  autoApprove: Schema.Struct({
    enabled: Schema.Boolean,
    timeoutMs: Schema.Number,
    defaultAction: AutoApproveAction,
  }),
});
export type CheckpointConfig = typeof CheckpointConfigSchema.Type;
