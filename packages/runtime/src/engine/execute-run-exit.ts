/**
 * Run-exit observation: the root-run error log + the `run-aborted` sentinel.
 *
 * Owns: (1) the structured `error` log line for a failed run (moved verbatim
 * from execution-engine.ts, former `Effect.tapError` block) and (2) the
 * `AgentAborted` sentinel published when the run's effect ends in failure,
 * defect or interrupt, so a trace never silently lacks a terminal event.
 *
 * Measurement only: the exit is observed and re-propagated unchanged (same
 * success value, same cause). Publishing swallows its own failures.
 */
import { Cause, Effect, Exit, Option } from "effect";
import type { RunAbortCause, RunAbortReason, Task } from "@reactive-agents/core";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import type { ObservableLoggerService } from "@reactive-agents/observability";
import type { EbLike } from "./runtime-context.js";

const ERROR_CAP = 200;

/** Classify a failed exit. Interrupt-only ⇒ `interrupt`; typed failure ⇒ `failure`; else `defect`. */
export function classifyAbort(cause: Cause.Cause<unknown>): RunAbortCause {
  if (Cause.isInterruptedOnly(cause)) return "interrupt";
  return Option.isSome(Cause.failureOption(cause)) ? "failure" : "defect";
}

/** Short, payload-free description of the cause (tag + message head), or undefined. */
export function describeAbort(cause: Cause.Cause<unknown>): string | undefined {
  if (Cause.isInterruptedOnly(cause)) return "fiber interrupted";
  const failure = Cause.failureOption(cause);
  const thing: unknown = Option.isSome(failure) ? failure.value : Option.getOrUndefined(Cause.dieOption(cause));
  if (thing === undefined) return undefined;
  const tag = errorTag(thing);
  const msg = (thing as { message?: unknown }).message;
  const text = typeof msg === "string" ? `${tag}: ${msg}` : String(tag);
  return text.length > ERROR_CAP ? `${text.slice(0, ERROR_CAP)}…` : text;
}

/**
 * What the runtime KNOWS about an abnormal end (no behavior change, label only):
 * a typed kill-switch failure is `user-stop` (graceful `stop()`) or `terminate`;
 * an interrupt after `timeoutMs` elapsed is `timeout`; any other interrupt is an
 * external `abort`. Unknown failures/defects carry no reason.
 */
export function classifyAbortReason(
  cause: Cause.Cause<unknown>,
  ctx: { readonly timeoutMs?: number; readonly durationMs: number },
): RunAbortReason | undefined {
  if (Cause.isInterruptedOnly(cause)) {
    return ctx.timeoutMs !== undefined && ctx.durationMs >= ctx.timeoutMs ? "timeout" : "abort";
  }
  const failure = Cause.failureOption(cause);
  if (Option.isSome(failure) && errorTag(failure.value) === "KillSwitchTriggeredError") {
    const reason = (failure.value as { reason?: unknown }).reason;
    return reason === "stop() requested" ? "user-stop" : "terminate";
  }
  return undefined;
}

export interface RunExitDeps {
  readonly logger: ObservableLoggerService;
  readonly eb: EbLike | null;
  readonly task: Task;
  readonly agentId: string;
  readonly executionStartMs: number;
  /** Per-execution timeout (`config.executionTimeoutMs`), used to label a timeout interrupt. */
  readonly timeoutMs?: number;
}

/**
 * Pipeable wrapper for the root run effect: logs a typed failure and, on any
 * non-success exit, publishes `AgentAborted`. The wrapped effect's success and
 * failure channels are unchanged.
 */
export const observeRunExit =
  (deps: RunExitDeps) =>
  <A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    self.pipe(
      Effect.tapError((err) => {
        // All RuntimeErrors extend Data.TaggedError which extends Error
        const asErr = err as unknown as Error & { cause?: Error };
        const message = asErr.message ?? String(err);
        const cause = asErr.cause instanceof Error ? asErr.cause : undefined;
        return deps.logger.emit({
          _tag: "error",
          message,
          error: cause ? { name: cause.name, message: cause.message, stack: cause.stack } : undefined,
          timestamp: new Date(),
        }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:4172", tag: errorTag(err) })));
      }),
      Effect.onExit((exit) => {
        if (Exit.isSuccess(exit) || deps.eb === null) return Effect.void;
        const rc = deps.task.metadata?.context?.["runContext"] as
          | { rootRunId?: string; parentRunId?: string; depth?: number }
          | undefined;
        const error = describeAbort(exit.cause);
        const durationMs = Date.now() - deps.executionStartMs;
        const reason = classifyAbortReason(exit.cause, { ...(deps.timeoutMs !== undefined ? { timeoutMs: deps.timeoutMs } : {}), durationMs });
        return deps.eb.publish({
          _tag: "AgentAborted",
          taskId: String(deps.task.id),
          agentId: deps.agentId,
          causeClass: classifyAbort(exit.cause),
          ...(error !== undefined ? { error } : {}),
          ...(reason !== undefined ? { reason } : {}),
          durationMs,
          timestamp: Date.now(),
          ...(rc?.rootRunId ? { rootRunId: rc.rootRunId } : {}),
          ...(rc?.parentRunId ? { parentRunId: rc.parentRunId } : {}),
          ...(typeof rc?.depth === "number" ? { depth: rc.depth } : {}),
        }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/execute-run-exit.ts:aborted", tag: errorTag(err) })));
      }),
    );
