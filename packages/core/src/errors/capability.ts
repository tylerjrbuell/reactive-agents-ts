import { Data } from "effect";

/**
 * Capability failure — the model or tool cannot perform the requested
 * operation. NOT retryable; retry is pointless because the capability gap
 * is structural (e.g. asking a text-only model to process images).
 *
 * @see isRetryable — returns false
 */
export class CapabilityError extends Data.TaggedError("CapabilityError")<{
  readonly message: string;
  readonly capability?: string;
}> {}

/**
 * The model lacks a specific capability required for the requested
 * operation. Used by runtime checks that inspect `Capability` fields
 * (vision, thinking-mode, prompt-caching, etc.) before issuing requests.
 */
export class ModelCapabilityError extends Data.TaggedError("ModelCapabilityError")<{
  readonly provider: string;
  readonly model: string;
  readonly required: string;
  readonly message: string;
}> {}
