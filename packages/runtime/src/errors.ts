import { Data } from "effect";

export class ExecutionError extends Data.TaggedError("ExecutionError")<{
  readonly message: string;
  readonly taskId: string;
  readonly phase: string;
  readonly cause?: unknown;
}> {}

export class HookError extends Data.TaggedError("HookError")<{
  readonly message: string;
  readonly phase: string;
  readonly timing: string;
  readonly cause?: unknown;
}> {}

export class MaxIterationsError extends Data.TaggedError("MaxIterationsError")<{
  readonly message: string;
  readonly taskId: string;
  readonly iterations: number;
  readonly maxIterations: number;
}> {}

export class GuardrailViolationError extends Data.TaggedError(
  "GuardrailViolationError",
)<{
  readonly message: string;
  readonly taskId: string;
  readonly violation: string;
}> {}

export class KillSwitchTriggeredError extends Data.TaggedError(
  "KillSwitchTriggeredError",
)<{
  readonly message: string;
  readonly taskId: string;
  readonly agentId: string;
  readonly reason: string;
}> {}

export class BehavioralContractViolationError extends Data.TaggedError(
  "BehavioralContractViolationError",
)<{
  readonly message: string;
  readonly taskId: string;
  readonly rule: string;
  readonly violation: string;
}> {}

export type RuntimeErrors =
  | ExecutionError
  | HookError
  | MaxIterationsError
  | GuardrailViolationError
  | KillSwitchTriggeredError
  | BehavioralContractViolationError;

/**
 * Unwrap Effect FiberFailure / Cause nesting to extract a clean error message.
 *
 * Effect's `runPromise` wraps failures in FiberFailure with nested Cause objects,
 * producing noisy output like:
 *   (FiberFailure) (FiberFailure) Error: ... effect/Runtime/FiberFailure: Symbol(...) ...
 *
 * This function digs through the nesting to find the root error message and
 * returns a plain Error with just that message.
 */
export function unwrapError(error: unknown): Error {
  // Already a clean Error with no FiberFailure nesting
  if (error instanceof Error && !isFiberFailure(error)) {
    return error;
  }

  const message = extractMessage(error);
  return new Error(message);
}

function isFiberFailure(error: unknown): boolean {
  if (error == null || typeof error !== "object") return false;
  // Effect marks FiberFailure objects with this symbol key
  return Symbol.for("effect/Runtime/FiberFailure") in (error as Record<symbol, unknown>);
}

function extractMessage(error: unknown, depth = 0): string {
  if (depth > 10) return String(error); // safety valve

  if (error == null) return "Unknown error";

  // FiberFailure — dig into the Cause
  if (typeof error === "object" && isFiberFailure(error)) {
    const cause = (error as Record<string | symbol, unknown>)[
      Symbol.for("effect/Runtime/FiberFailure/Cause")
    ];
    if (cause) return extractMessage(cause, depth + 1);
    // Fallback: FiberFailure often has a message or wraps another Error
    if (error instanceof Error && error.message) {
      return cleanMessage(error.message);
    }
  }

  // Effect Cause objects have a _tag (Fail, Die, Interrupt, etc.)
  if (typeof error === "object" && "_tag" in (error as Record<string, unknown>)) {
    const tagged = error as { _tag: string; error?: unknown; defect?: unknown; cause?: unknown };
    if (tagged._tag === "Fail" && tagged.error !== undefined) {
      return extractMessage(tagged.error, depth + 1);
    }
    if (tagged._tag === "Die" && tagged.defect !== undefined) {
      return extractMessage(tagged.defect, depth + 1);
    }
    // Sequential/Parallel causes — take the first
    if (tagged._tag === "Sequential" || tagged._tag === "Parallel") {
      const left = (tagged as unknown as { left: unknown }).left;
      if (left) return extractMessage(left, depth + 1);
    }
  }

  // Regular Error
  if (error instanceof Error) {
    return cleanMessage(error.message);
  }

  // Tagged error objects with message field (Effect Data.TaggedError)
  if (typeof error === "object" && "message" in (error as Record<string, unknown>)) {
    return cleanMessage(String((error as { message: unknown }).message));
  }

  return String(error);
}

/** Strip redundant FiberFailure prefixes from error messages */
function cleanMessage(msg: string): string {
  return msg
    .replace(/^\(FiberFailure\)\s*/g, "")
    .replace(/\s*effect\/Runtime\/FiberFailure:.*$/s, "")
    .trim();
}
