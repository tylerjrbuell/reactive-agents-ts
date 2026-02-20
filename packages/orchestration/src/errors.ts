import { Data } from "effect";

export class WorkflowError extends Data.TaggedError("WorkflowError")<{
  readonly message: string;
  readonly workflowId?: string;
  readonly cause?: unknown;
}> {}

export class WorkflowStepError extends Data.TaggedError("WorkflowStepError")<{
  readonly message: string;
  readonly workflowId: string;
  readonly stepId: string;
  readonly cause?: unknown;
}> {}

export class CheckpointError extends Data.TaggedError("CheckpointError")<{
  readonly message: string;
  readonly workflowId: string;
}> {}

export class WorkerPoolError extends Data.TaggedError("WorkerPoolError")<{
  readonly message: string;
  readonly availableWorkers: number;
  readonly requiredWorkers: number;
}> {}
