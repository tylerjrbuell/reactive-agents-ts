import { Data } from "effect";

export class MockError extends Data.TaggedError("MockError")<{
  readonly message: string;
}> {}
