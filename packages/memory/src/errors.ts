import { Data } from "effect";

export class MemoryError extends Data.TaggedError("MemoryError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class MemoryNotFoundError extends Data.TaggedError(
  "MemoryNotFoundError",
)<{
  readonly memoryId: string;
  readonly message: string;
}> {}

export class DatabaseError extends Data.TaggedError("DatabaseError")<{
  readonly message: string;
  readonly operation: "read" | "write" | "delete" | "search" | "migrate";
  readonly cause?: unknown;
}> {}

export class CapacityExceededError extends Data.TaggedError(
  "CapacityExceededError",
)<{
  readonly message: string;
  readonly capacity: number;
  readonly current: number;
}> {}

export class ContextError extends Data.TaggedError("ContextError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class CompactionError extends Data.TaggedError("CompactionError")<{
  readonly message: string;
  readonly strategy: string;
  readonly cause?: unknown;
}> {}

export class SearchError extends Data.TaggedError("SearchError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class ExtractionError extends Data.TaggedError("ExtractionError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}
