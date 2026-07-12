import { Data } from "effect";

/**
 * Thrown when an unexpected error occurs during a lifecycle phase.
 *
 * This is the most general execution error — it wraps any exception that
 * propagates out of the ExecutionEngine during bootstrap, strategy selection,
 * reasoning, or completion phases.
 */
export class ExecutionError extends Data.TaggedError("ExecutionError")<{
  /** Human-readable error description */
  readonly message: string;
  /** Task ID of the failing execution */
  readonly taskId: string;
  /** Phase in which the error occurred (e.g., "bootstrap", "think", "act") */
  readonly phase: string;
  /** Original cause (wrapped exception or Effect failure) */
  readonly cause?: unknown;
}> {}

/**
 * Thrown when a lifecycle hook handler throws or returns a failed Effect.
 *
 * Hooks registered via `.withHook()` that fail propagate as `HookError`.
 * The `phase` and `timing` fields identify which hook failed.
 */
export class HookError extends Data.TaggedError("HookError")<{
  /** Human-readable error description */
  readonly message: string;
  /** Phase the hook was registered on (e.g., "think", "act") */
  readonly phase: string;
  /** When the hook fired: "before" or "after" the phase */
  readonly timing: string;
  /** Original cause thrown by the hook handler */
  readonly cause?: unknown;
}> {}

/**
 * Thrown when the agent reaches `maxIterations` without producing a final answer.
 *
 * Means the agent ran `maxIterations` reasoning loops without calling the
 * `final-answer` tool or producing a `FINAL ANSWER:` marker. Increase
 * `maxIterations` or simplify the task to avoid this.
 */
export class MaxIterationsError extends Data.TaggedError("MaxIterationsError")<{
  /** Human-readable error description */
  readonly message: string;
  /** Task ID that exceeded the iteration limit */
  readonly taskId: string;
  /** Number of iterations completed */
  readonly iterations: number;
  /** Configured limit that was exceeded */
  readonly maxIterations: number;
}> {}

/**
 * Thrown when a guardrail detector blocks the task.
 *
 * Raised when prompt injection, PII, toxicity, or a custom blocklist is triggered.
 * Requires `.withGuardrails()` to be enabled on the builder.
 */
export class GuardrailViolationError extends Data.TaggedError(
  "GuardrailViolationError",
)<{
  /** Human-readable description of the violation */
  readonly message: string;
  /** Task ID of the blocked execution */
  readonly taskId: string;
  /** Which guardrail was triggered (e.g., "injection", "pii", "toxicity") */
  readonly violation: string;
}> {}

/**
 * Thrown when the kill switch stops or terminates an agent.
 *
 * Raised when `agent.stop()` or `agent.terminate()` is called during execution.
 * Requires `.withKillSwitch()` to be enabled on the builder.
 */
export class KillSwitchTriggeredError extends Data.TaggedError(
  "KillSwitchTriggeredError",
)<{
  /** Human-readable error description */
  readonly message: string;
  /** Task ID that was stopped */
  readonly taskId: string;
  /** Agent ID that was stopped */
  readonly agentId: string;
  /** Reason for triggering the kill switch (e.g., "user_requested", "timeout") */
  readonly reason: string;
}> {}

/**
 * Thrown when a behavioral contract rule is violated.
 *
 * Raised when the agent attempts to use a forbidden tool, exceeds an iteration
 * contract, or violates an output pattern constraint. Requires
 * `.withBehavioralContracts()` to be enabled.
 */
export class BehavioralContractViolationError extends Data.TaggedError(
  "BehavioralContractViolationError",
)<{
  /** Human-readable error description */
  readonly message: string;
  /** Task ID of the violating execution */
  readonly taskId: string;
  /** Name of the contract rule that was violated */
  readonly rule: string;
  /** Description of how the rule was violated */
  readonly violation: string;
}> {}

/**
 * Thrown when token or cost spend exceeds a configured budget limit.
 *
 * Raised by the cost tracking layer when a pre-flight or per-iteration budget
 * check fails. Requires `.withCostTracking()` with budget options to be enabled.
 */
export class BudgetExceededError extends Data.TaggedError(
  "BudgetExceededError",
)<{
  /** Human-readable error description */
  readonly message: string;
  /** Task ID of the execution that was halted */
  readonly taskId: string;
  /** Which budget was exceeded: "perRequest", "perSession", "daily", or "monthly" */
  readonly budgetType: string;
  /** Budget limit (USD) */
  readonly limit: number;
  /** Current spend at the time of failure (USD) */
  readonly current: number;
}> {}

/**
 * Thrown by `agent.resume(runId)` when no run / no checkpoint exists for `runId`.
 *
 * Either the run id is unknown to the durable store, or the run was created but
 * never checkpointed (nothing to rehydrate). Durable execution Phase C.
 */
export class DurableRunNotFoundError extends Data.TaggedError(
  "DurableRunNotFoundError",
)<{
  /** The run id that could not be resumed. */
  readonly runId: string;
}> {}

/**
 * Thrown by `agent.resume(runId)` when the resuming agent's config hash differs
 * from the hash stored when the run was created.
 *
 * Resume rehydrates a `KernelState` (data) but re-materializes services, tools,
 * and the system prompt from the live builder config. If that config drifted,
 * continuing the run would silently mix two contracts — so resume is refused.
 * Durable execution Phase C.
 */
export class DurableConfigMismatchError extends Data.TaggedError(
  "DurableConfigMismatchError",
)<{
  /** The run id whose stored config no longer matches. */
  readonly runId: string;
  /** Config hash recorded when the run was first created. */
  readonly storedHash: string;
  /** Config hash of the agent attempting the resume. */
  readonly currentHash: string;
}> {}

/**
 * Thrown by `agent.approveRun`/`denyRun` when the target run is not awaiting an
 * approval decision (no pending approval row) — e.g. already decided, already
 * completed, or never paused. Durable HITL (Phase D).
 */
export class ApprovalStateError extends Data.TaggedError("ApprovalStateError")<{
  /** The run id whose approval could not be applied. */
  readonly runId: string;
  /** Human-readable reason (e.g. "no pending approval"). */
  readonly detail: string;
}> {}

/**
 * Thrown by `agent.respondToInteraction` when the target run is not awaiting a
 * user interaction (no pending interaction row) — e.g. already answered, already
 * completed, or never paused. Agentic-UI durable interaction rail (Task 10).
 * Mirrors {@link ApprovalStateError}.
 */
export class InteractionStateError extends Data.TaggedError("InteractionStateError")<{
  /** The run id whose interaction could not be applied. */
  readonly runId: string;
  /** Human-readable reason (e.g. "no pending interaction"). */
  readonly detail: string;
}> {}

/**
 * Union of all runtime error types that can be thrown by `agent.run()`.
 *
 * Use this as the error type in Effect pipelines or when calling `agent.run()`
 * to exhaustively handle all possible failures.
 */
export type RuntimeErrors =
  | ExecutionError
  | HookError
  | MaxIterationsError
  | GuardrailViolationError
  | KillSwitchTriggeredError
  | BehavioralContractViolationError
  | BudgetExceededError
  | ApprovalStateError
  | InteractionStateError;

/** Context and remediation suggestion for a runtime error. */
export interface ErrorContext {
  suggestion: string;
  taskId?: string;
  phase?: string;
  details?: Record<string, unknown>;
}

/**
 * Extract actionable context and remediation suggestion from a runtime error.
 * Works with all Data.TaggedError types in the framework.
 *
 * @param error - Any error (runtime errors get specific suggestions, others get generic)
 * @returns ErrorContext with a human-readable suggestion
 */
export function errorContext(error: unknown): ErrorContext {
  if (error && typeof error === "object" && "_tag" in error) {
    const e = error as Record<string, unknown>;
    switch (e._tag) {
      case "MaxIterationsError": {
        const maxIter = e.maxIterations as number;
        return {
          suggestion: `Agent reached ${maxIter} iterations without completing. Consider: (1) simpler prompt, (2) increase maxIterations via .withMaxIterations(${maxIter + 5}), (3) enable adaptive strategy via .withReasoning({ defaultStrategy: "adaptive" })`,
          taskId: e.taskId as string,
          details: { iterations: e.iterations, maxIterations: maxIter },
        };
      }
      case "BudgetExceededError": {
        const budgetType = e.budgetType as string;
        const limit = e.limit as number;
        return {
          suggestion: `Budget limit exceeded: ${budgetType}=${limit} (current: ${e.current}). Increase via .withCostTracking({ ${budgetType}: ${limit * 2} })`,
          taskId: e.taskId as string,
          details: { budgetType, limit, current: e.current },
        };
      }
      case "GuardrailViolationError": {
        const violation = e.violation as string;
        return {
          suggestion: `Input blocked by ${violation} guardrail. Options: (1) rephrase input to avoid trigger, (2) disable this detector via .withGuardrails({ ${violation}: false })`,
          taskId: e.taskId as string,
          phase: "guardrail",
          details: { violation },
        };
      }
      case "KillSwitchTriggeredError": {
        const reason = e.reason as string;
        return {
          suggestion: `Agent stopped by kill switch (reason: ${reason}). The kill switch was triggered ${reason === "manual" ? "manually" : "by policy"}. Call agent.resume() to continue.`,
          taskId: e.taskId as string,
          details: { agentId: e.agentId, reason },
        };
      }
      case "BehavioralContractViolationError":
        return {
          suggestion: `Behavioral contract violation: ${e.rule} (${e.violation}). Adjust via .withBehavioralContracts() or remove the constraint.`,
          taskId: e.taskId as string,
          details: { rule: e.rule, violation: e.violation },
        };
      case "HookError": {
        const cause = e.cause instanceof Error ? e.cause.message : String(e.cause ?? "unknown");
        return {
          suggestion: `Hook failed at phase "${e.phase}" (timing: ${e.timing}). Check your .withHook() handler for the "${e.phase}" phase. Cause: ${cause}`,
          phase: e.phase as string,
          details: { timing: e.timing },
        };
      }
      case "ExecutionError": {
        const rootCause = e.cause instanceof Error ? e.cause.message : String(e.cause ?? "");
        return {
          suggestion: `Execution failed at phase "${e.phase}". ${rootCause ? `Root cause: ${rootCause}` : 'Enable .withObservability({ verbosity: "debug" }) for detailed logs.'}`,
          taskId: e.taskId as string,
          phase: e.phase as string,
          details: { cause: rootCause },
        };
      }
    }
  }

  const msg = error instanceof Error ? error.message : String(error);
  return {
    suggestion: `Unexpected error: ${msg}. Enable .withObservability({ verbosity: "debug" }) for detailed diagnostics.`,
  };
}

const KNOWN_TAGS = new Set([
  "ExecutionError",
  "HookError",
  "MaxIterationsError",
  "GuardrailViolationError",
  "KillSwitchTriggeredError",
  "BehavioralContractViolationError",
  "BudgetExceededError",
]);

/**
 * Attach the original tagged-error value to an `Error` instance so callers
 * (e.g. `unwrapErrorWithSuggestion`) can recover the original for context
 * lookup after the message has been cleaned.
 *
 * Concentrates the narrow widening cast in one place — see
 * `packages/runtime/test/as-unknown-as-ceiling.test.ts` for the §5.5 anti-
 * regression ceiling that feeds off this consolidation.
 */
function setOriginalTaggedError(err: Error, original: unknown): void {
  (err as unknown as Record<string, unknown>)._originalTaggedError = original;
}

/**
 * Read the original tagged-error value previously attached via
 * `setOriginalTaggedError`. Returns `undefined` if no original is attached.
 */
function getOriginalTaggedError(base: Error): unknown {
  return (base as unknown as Record<string, unknown>)._originalTaggedError;
}

function isKnownTaggedError(error: unknown): boolean {
  return (
    error != null &&
    typeof error === "object" &&
    "_tag" in error &&
    KNOWN_TAGS.has((error as { _tag: string })._tag)
  );
}

function extractRootTaggedError(error: unknown): unknown {
  if (error == null || typeof error !== "object") return null;
  if (isKnownTaggedError(error)) return error;

  if (isFiberFailure(error)) {
    const cause = (error as Record<string | symbol, unknown>)[
      Symbol.for("effect/Runtime/FiberFailure/Cause")
    ];
    if (cause) return extractRootTaggedError(cause);
  }

  const tagged = error as { _tag?: string; error?: unknown; defect?: unknown };
  if (tagged._tag === "Fail" && tagged.error) return extractRootTaggedError(tagged.error);
  if (tagged._tag === "Die" && tagged.defect) return extractRootTaggedError(tagged.defect);

  return null;
}

/**
 * Like unwrapError but appends the remediation suggestion to the error message.
 * Use this at the facade level (agent.run()) for maximum user helpfulness.
 */
export function unwrapErrorWithSuggestion(error: unknown): Error {
  const base = unwrapError(error);
  const original = getOriginalTaggedError(base) ?? error;
  const ctx = errorContext(original);
  if (ctx.suggestion && !base.message.includes("Consider:") && !base.message.includes("Options:")) {
    base.message = `${base.message}\n  → ${ctx.suggestion}`;
  }
  return base;
}

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
  // If it's a known tagged error, wrap in Error with clean message and attach original
  if (isKnownTaggedError(error)) {
    const msg = (error as { message: string }).message;
    const err = new Error(cleanMessage(msg));
    setOriginalTaggedError(err, error);
    return err;
  }

  // Already a clean Error with no FiberFailure nesting
  if (error instanceof Error && !isFiberFailure(error)) {
    return error;
  }

  // Dig through FiberFailure — try to find a known tagged error inside
  const root = extractRootTaggedError(error);
  if (root && isKnownTaggedError(root)) {
    const msg = (root as { message: string }).message;
    const err = new Error(cleanMessage(msg));
    setOriginalTaggedError(err, root);
    return err;
  }

  const message = extractMessage(error);
  return new Error(message);
}

/** Collapse a possibly multi-line / oversized message to a single concise line. */
function firstMeaningfulLine(msg: string): string {
  const line = msg
    .split("\n")
    .map((s) => s.trim())
    .find((s) => s.length > 0);
  const chosen = line ?? msg.trim();
  return chosen.length > 300 ? `${chosen.slice(0, 297)}...` : chosen;
}

/**
 * Map an already-unwrapped error to the value thrown at the `agent.run()`
 * boundary. By default this is a plain `Error` with a single-line message and
 * NO internal runtime stack on the console — the full original is preserved on
 * `.cause` (with its own stack trimmed to one line so a bare
 * `console.error(err)` stays concise). Set `RA_DEBUG_ERRORS=1` (or
 * `REACTIVE_AGENTS_DEBUG=1`) to bypass this and surface the full internal stack.
 *
 * Fixes the 2026-07-01 finding where a model-typo 404 dumped duplicated
 * provider JSON plus a stack straight through `run()`.
 */
export function toRunBoundaryError(unwrapped: Error): Error {
  const debug =
    process.env.RA_DEBUG_ERRORS === "1" ||
    process.env.REACTIVE_AGENTS_DEBUG === "1" ||
    process.env.REACTIVE_AGENTS_DEBUG === "true";
  if (debug) return unwrapped;

  const oneLine = firstMeaningfulLine(unwrapped.message);
  const clean = new Error(oneLine);
  // Preserve the full error for programmatic inspection, but trim its stack to
  // a single line so the runtime's internal frames don't reach the console
  // unless debugging is explicitly requested.
  unwrapped.stack = `${unwrapped.name || "Error"}: ${oneLine}`;
  (clean as Error & { cause?: unknown }).cause = unwrapped;
  clean.stack = `${clean.name}: ${clean.message}`;
  return clean;
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
