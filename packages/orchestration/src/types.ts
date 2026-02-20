import { Schema } from "effect";

// ─── Workflow ───

export const WorkflowIdSchema = Schema.String.pipe(Schema.brand("WorkflowId"));
export type WorkflowId = typeof WorkflowIdSchema.Type;

export const WorkflowPattern = Schema.Literal(
  "sequential", "parallel", "map-reduce", "pipeline", "orchestrator-workers",
);
export type WorkflowPattern = typeof WorkflowPattern.Type;

export const WorkflowState = Schema.Literal(
  "pending", "running", "paused", "completed", "failed", "recovering",
);
export type WorkflowState = typeof WorkflowState.Type;

export const WorkflowStepSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  agentId: Schema.optional(Schema.String),
  input: Schema.Unknown,
  output: Schema.optional(Schema.Unknown),
  status: Schema.Literal("pending", "running", "completed", "failed", "skipped"),
  startedAt: Schema.optional(Schema.DateFromSelf),
  completedAt: Schema.optional(Schema.DateFromSelf),
  error: Schema.optional(Schema.String),
  retryCount: Schema.Number,
  maxRetries: Schema.Number,
});
export type WorkflowStep = typeof WorkflowStepSchema.Type;

export const WorkflowSchema = Schema.Struct({
  id: WorkflowIdSchema,
  name: Schema.String,
  pattern: WorkflowPattern,
  steps: Schema.Array(WorkflowStepSchema),
  state: WorkflowState,
  createdAt: Schema.DateFromSelf,
  updatedAt: Schema.DateFromSelf,
  completedAt: Schema.optional(Schema.DateFromSelf),
  metadata: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
});
export type Workflow = typeof WorkflowSchema.Type;

// ─── Domain Events ───

export type DomainEvent =
  | { type: "WorkflowCreated"; workflowId: WorkflowId; timestamp: Date; payload: Workflow }
  | { type: "StepStarted"; workflowId: WorkflowId; timestamp: Date; payload: { stepId: string; agentId: string } }
  | { type: "StepCompleted"; workflowId: WorkflowId; timestamp: Date; payload: { stepId: string; output: unknown } }
  | { type: "StepFailed"; workflowId: WorkflowId; timestamp: Date; payload: { stepId: string; error: string } }
  | { type: "WorkflowCompleted"; workflowId: WorkflowId; timestamp: Date; payload: { result: unknown } }
  | { type: "WorkflowFailed"; workflowId: WorkflowId; timestamp: Date; payload: { error: string } }
  | { type: "WorkflowPaused"; workflowId: WorkflowId; timestamp: Date; payload: { reason: string } }
  | { type: "WorkflowResumed"; workflowId: WorkflowId; timestamp: Date; payload: Record<string, never> };

// ─── Checkpoint ───

export const CheckpointSchema = Schema.Struct({
  id: Schema.String,
  workflowId: WorkflowIdSchema,
  timestamp: Schema.DateFromSelf,
  state: WorkflowSchema,
  eventIndex: Schema.Number,
});
export type Checkpoint = typeof CheckpointSchema.Type;

// ─── Worker Agent ───

export const WorkerAgentSchema = Schema.Struct({
  agentId: Schema.String,
  specialty: Schema.String,
  status: Schema.Literal("idle", "busy", "failed", "draining"),
  currentWorkflowId: Schema.optional(WorkflowIdSchema),
  currentStepId: Schema.optional(Schema.String),
  completedTasks: Schema.Number,
  failedTasks: Schema.Number,
  avgLatencyMs: Schema.Number,
});
export type WorkerAgent = typeof WorkerAgentSchema.Type;
