import { Data } from "effect";

export class BudgetExceededError extends Data.TaggedError("BudgetExceededError")<{
  readonly message: string;
  readonly budgetType: "perRequest" | "perSession" | "daily" | "monthly";
  readonly limit: number;
  readonly current: number;
  readonly requested: number;
}> {}

export class CostTrackingError extends Data.TaggedError("CostTrackingError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class CacheError extends Data.TaggedError("CacheError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class RoutingError extends Data.TaggedError("RoutingError")<{
  readonly message: string;
  readonly taskComplexity?: number;
}> {}
