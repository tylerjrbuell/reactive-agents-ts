/**
 * Think phase — the one recoverable-LLM-failure seam.
 *
 * A think call (stream init or mid-stream) that fails used to end the run with
 * `terminatedBy: "llm_error"`, whatever the cause. Many causes are transient: a
 * model emitted malformed output (a fresh sample fixes it), the request was too
 * large (a compacted one fits), a rate limit or a dropped connection (a short
 * wait fixes it). This seam owns the think gateway call (prepare + consume) and
 * retries a failed call in the same turn, picking the recovery from the
 * provider's error class:
 *
 *   - `resample` — re-issue the same request (a fresh sample).
 *   - `shrink`   — re-project the thread through `project()` compaction at
 *                  0.7x the reported prompt size, capped by a per-minute token
 *                  budget when that was the limit (Plan 9 2d,
 *                  `context-overflow-retry.ts`), then re-send. Once per run: a
 *                  run whose history outgrows the window twice is failing.
 *                  An output-side budget failure (OTPM) instead halves the
 *                  turn's `max_tokens` and re-sends the prompt unchanged.
 *   - `backoff`  — wait (the provider's `retryAfterMs`, else 1s, 2s, ...; at
 *                  most 10s) and re-send.
 *   - `fatal`    — no retry; the failure returns as-is (honest `llm_error`).
 *
 * ONE RETRY LAYER PER FAILURE: the provider's stream retry (`retryPolicy`, 3
 * retries) re-sends a retryable failure raised before the stream's first
 * event. The kernel does not run `backoff`/`resample` again on such a failure
 * (`providerSpentRetries`, stop reason `provider-retried`); it recovers what
 * the provider cannot: failures after the stream emitted, init failures, and
 * `shrink` (a different request).
 *
 * BUDGET (per run, on a run slot; a sub-agent gets its own): at most
 * `llmRecoveryBudget` kernel recoveries (default 2, `harness-config.ts`), and
 * never the same class retried three times in a row. Each recovery is one more
 * think request; provider-level re-sends are not counted against it. A spent
 * budget returns the failure as-is. Outside a run scope there is no run to
 * budget, so each call gets a fresh budget. Within a turn, a lowered output
 * budget (`maxOutputTokensOverride`) carries into every later attempt.
 *
 * ACCOUNTING: the retry happens inside the one think call, so the turn is one
 * iteration, one thought step and one entropy score. A failed attempt adds no
 * step and is not a loop or no-progress observation. Each attempt is its own
 * `llm-exchange` in the trace (observable-llm.ts).
 *
 * STREAMED TEXT: a failed attempt's accumulated text, thinking and tool calls
 * are dropped (`consumeThinkStream`'s accumulators are per attempt). Text it
 * already forwarded to the text-delta sink is void: the `llm-recovery` signal
 * carries `streamedTextVoid: true` and the discarded counts so a consumer can
 * drop it.
 *
 * Trace facts (`HarnessSignalInjectedEmitted`, trace-only): `llm-recovery`
 * (`redirect`) before every retry and (`block`, `exhausted: true`) when a
 * recoverable failure is not retried; the compaction outcome facts
 * `context-overflow-recovered` / `context-overflow` (`exhausted: true`) as
 * before.
 */
import { Duration, Effect } from "effect";
import { isLLMErrorClass, recoveryFor, type LLMErrorClass, type LLMMessage, type LLMRecovery } from "@reactive-agents/llm-provider";
import { currentRunContext, getRunSlot, runSlot, type RunSlot } from "@reactive-agents/core/internal/run-scope";
import { emitHarnessSignalInjected } from "../../utils/diagnostics.js";
import { describeLlmFailure } from "../../utils/llm-failure.js";
import { llmRecoveryBudgetOf } from "../../../harness-config.js";
import { prepareThinkGatewayCall, type PrepareThinkGatewayCallParams } from "./prepare-think-gateway-call.js";
import { consumeThinkStream } from "./consume-think-stream.js";
import {
  CONTEXT_OVERFLOW_ERROR_TAG,
  contextOverflowOf,
  overflowRetryWindow,
  TOKEN_RATE_EXCEEDED_CLASS,
  UNSTATED_OVERFLOW,
} from "./context-overflow-retry.js";
import { transitionState } from "../../state/kernel-state.js";

/** The same error class is retried at most this many times in a row. */
export const MAX_SAME_CLASS_STREAK = 2;

/** Ceiling on one backoff wait. */
export const MAX_BACKOFF_MS = 10_000;

const BASE_BACKOFF_MS = 1_000;


/** The class a typed provider error implies when it carries no `errorClass`. */
const CLASS_BY_TAG: Readonly<Record<string, LLMErrorClass>> = {
  [CONTEXT_OVERFLOW_ERROR_TAG]: "context_overflow",
  LLMRateLimitError: "rate_limit",
  LLMTimeoutError: "timeout",
};

/** A failed think call's error class and the recovery it gets. */
export interface FailureRecovery {
  readonly errorClass: string;
  readonly recovery: LLMRecovery;
}

const asRecord = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === "object" && v !== null ? (v as Record<string, unknown>) : undefined;

const stringField = (rec: Record<string, unknown> | undefined, key: string): string | undefined => {
  const v = rec?.[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
};

/**
 * Classify the raw failure of a think call. Structural (reads `errorClass`,
 * `_tag`, `retryable`), like `describeLlmFailure`: the kernel never depends on
 * a provider class identity. The policy is the provider's `recoveryFor` (a
 * non-retryable resample/backoff class, e.g. an exhausted quota, is fatal).
 * A typed error with no `errorClass` takes the class its `_tag` implies; any
 * other failure (incl. an in-band stream error, which has no typed cause) is
 * fatal.
 */
export function recoveryOfFailure(cause: unknown): FailureRecovery {
  const rec = asRecord(cause);
  const stated = stringField(rec, "errorClass");
  const tag = stringField(rec, "_tag");
  const errorClass = stated ?? describeLlmFailure(cause).errorClass;
  const policyClass = stated !== undefined && isLLMErrorClass(stated) ? stated : tag !== undefined ? CLASS_BY_TAG[tag] : undefined;
  if (policyClass === undefined) return { errorClass, recovery: "fatal" };
  const retryable = typeof rec?.["retryable"] === "boolean" ? rec["retryable"] : undefined;
  return { errorClass, recovery: recoveryFor(policyClass, retryable) };
}

/**
 * The wait before a `backoff` retry: the provider's `retryAfterMs` when it
 * stated one, else 1s doubling per attempt; never more than 10s.
 */
export function backoffMs(cause: unknown, attempt: number): number {
  const stated = asRecord(cause)?.["retryAfterMs"];
  const ms =
    typeof stated === "number" && Number.isFinite(stated) && stated >= 0
      ? stated
      : BASE_BACKOFF_MS * 2 ** Math.max(0, attempt - 1);
  return Math.min(MAX_BACKOFF_MS, Math.floor(ms));
}

/** An output-side shrink asks for this fraction of the output budget the failed request sent. */
export const OUTPUT_SHRINK_FRACTION = 0.5;

/** Floor on a shrunk output budget. */
export const MIN_SHRUNK_OUTPUT_BUDGET = 256;

/** Output budget assumed when the failed request's budget is unknown. */
const UNKNOWN_OUTPUT_BUDGET = 4_096;

/**
 * Whether a `shrink` failure is output-side: a `token_rate_exceeded` (OTPM)
 * that is NOT the typed overflow error. The provider sends the input-side
 * budget (TPM / ITPM) as `LLMContextOverflowError` and the output-side one as a
 * plain error, so the prompt is compacted only when the prompt was the problem.
 */
export function isOutputSideShrink(failure: FailureRecovery, cause: unknown): boolean {
  return failure.errorClass === TOKEN_RATE_EXCEEDED_CLASS && contextOverflowOf(cause) === undefined;
}

/** The lowered `max_tokens` for an output-side shrink retry. Deterministic. */
export function shrunkOutputBudget(sent: number | undefined): number {
  const base = sent !== undefined && Number.isFinite(sent) && sent > 0 ? sent : UNKNOWN_OUTPUT_BUDGET;
  return Math.max(MIN_SHRUNK_OUTPUT_BUDGET, Math.floor(base * OUTPUT_SHRINK_FRACTION));
}

/**
 * Whether the provider's own retry schedule already re-sent this failure.
 * Built-in providers wrap every stream in `retryStreamBeforeFirstEmission`
 * (llm-provider `retry.ts`): a retryable error raised on the stream before its
 * first event is re-sent up to 3 times with backoff (malformed output with no
 * delay) before it reaches the kernel. Re-running `backoff`/`resample` on top
 * of that multiplies the calls (one turn could make ~12 and wait ~40s).
 * Mirrors the provider's retry predicate structurally: the `retryable` flag
 * when present, else the rate-limit tag. An init failure, or a failure after
 * the stream emitted, was never re-sent. `shrink` sends a different request,
 * so the provider never retries it and it is never "already spent".
 */
export function providerSpentRetries(
  failure: FailureRecovery,
  cause: unknown,
  failedBeforeFirstEvent: boolean,
): boolean {
  if (!failedBeforeFirstEvent) return false;
  if (failure.recovery !== "backoff" && failure.recovery !== "resample") return false;
  const rec = asRecord(cause);
  const retryable = rec?.["retryable"];
  return retryable === true || (retryable === undefined && stringField(rec, "_tag") === "LLMRateLimitError");
}

/** The run's recovery ledger. A sub-agent gets its own. */
export interface LlmRecoveryLedger {
  /** Recoveries this run has spent (every class). */
  used: number;
  /** The run's one `shrink` compaction is spent. */
  shrinkSpent: boolean;
}

const freshLedger = (): LlmRecoveryLedger => ({ used: 0, shrinkSpent: false });

/** Run slot holding the run's recovery ledger (reset for sub-agents). */
export const llmRecoverySlot: RunSlot<LlmRecoveryLedger> = runSlot<LlmRecoveryLedger>("reasoning.llmRecovery", {
  child: "reset",
  fresh: freshLedger,
});

/**
 * The ledger for this run. Outside a run scope the slot's process fallback
 * would be shared by every unscoped kernel in the process, so an unscoped call
 * gets a ledger of its own.
 */
const runLedger: Effect.Effect<LlmRecoveryLedger> = Effect.flatMap(currentRunContext, (run) =>
  run === null ? Effect.succeed(freshLedger()) : getRunSlot(llmRecoverySlot),
);

/** Why a recoverable failure is not retried. */
export type RecoveryStop = "fatal" | "budget" | "streak" | "shrink-spent" | "provider-retried";

/** Decide whether a failure is retried. Pure. */
export function recoveryStop(
  failure: FailureRecovery,
  ledger: Readonly<LlmRecoveryLedger>,
  budget: number,
  streak: { readonly errorClass: string; readonly count: number },
  /** An output-side shrink lowers `max_tokens`; the once-per-run latch is the prompt compaction's. */
  outputSide = false,
): RecoveryStop | undefined {
  if (failure.recovery === "fatal") return "fatal";
  if (ledger.used >= budget) return "budget";
  if (streak.errorClass === failure.errorClass && streak.count >= MAX_SAME_CLASS_STREAK) return "streak";
  if (failure.recovery === "shrink" && !outputSide && ledger.shrinkSpent) return "shrink-spent";
  return undefined;
}

/** Inputs for {@link callThinkWithRecovery}. */
export interface ThinkCallParams {
  /** The first attempt's gateway preflight inputs. */
  readonly prepare: PrepareThinkGatewayCallParams;
  /** Re-project the conversation thread through `project()` at `window` tokens. */
  readonly reproject: (window: number) => LLMMessage[];
  /** Request-only messages that ride after the projected thread (the guidance tail). */
  readonly requestTail: readonly LLMMessage[];
}

/**
 * Prepare + consume the think call; on a recoverable failure, recover and
 * retry within the run's budget. A fatal failure, a spent budget, or a failure
 * after the last allowed retry returns as-is (honest `llm_error`). Same result
 * shape as `consumeThinkStream`.
 */
export function callThinkWithRecovery(params: ThinkCallParams) {
  return Effect.gen(function* () {
    const { prepare } = params;
    const { context } = prepare;
    const first = yield* prepareThinkGatewayCall(prepare);
    const consume = (call: typeof first) =>
      consumeThinkStream({ state: call.state, llmStreamEffect: call.llmStreamEffect, context });
    let stream = yield* consume(first);
    if (stream._tag !== "failed") return stream;

    const { taskId, iteration } = first.state;
    const signal = (signalKind: "block" | "redirect", origin: string, content: string, metadata: Record<string, unknown>) =>
      emitHarnessSignalInjected({ taskId, iteration, signalKind, origin, content, metadata });
    const budget = llmRecoveryBudgetOf(prepare.h);
    const ledger = yield* runLedger;
    let call = first;
    // The request's thread: compacted by a prompt-side shrink, kept by every other retry.
    let messagesForRequest = prepare.messagesForRequest;
    // The request's state: an output-side shrink lowers `max_tokens` on it, and
    // every later retry in this turn keeps that (a prompt-side shrink too).
    let attemptState = first.state;
    let attempt = 0;
    let streak = { errorClass: "", count: 0 };
    // Set once this call compacted (the shrink outcome facts below).
    let compaction: Record<string, unknown> | undefined;

    while (stream._tag === "failed") {
      const failure = recoveryOfFailure(stream.cause);
      const outputSide = failure.recovery === "shrink" && isOutputSideShrink(failure, stream.cause);
      const stop = providerSpentRetries(failure, stream.cause, stream.failedBeforeFirstEvent)
        ? "provider-retried"
        : recoveryStop(failure, ledger, budget, streak, outputSide);
      if (stop !== undefined) {
        const overflow = contextOverflowOf(stream.cause);
        if (compaction !== undefined) {
          yield* signal(
            "block",
            "context-overflow",
            overflow ? "context overflow repeated after compaction: run failed" : "compaction retry failed: run failed",
            { ...compaction, ...(overflow ? { retryTokenCount: overflow.tokenCount } : {}), latched: false, exhausted: true },
          );
        } else if (failure.recovery === "shrink" && !outputSide) {
          const why =
            stop === "shrink-spent"
              ? "context overflow again after this run's one compaction: run failed"
              : `context overflow not retried (${stop}): run failed`;
          yield* signal("block", "context-overflow", why, {
            ...(overflow ?? UNSTATED_OVERFLOW),
            latched: stop === "shrink-spent",
            exhausted: true,
          });
        }
        if (stop !== "fatal") {
          yield* signal("block", "llm-recovery", `${failure.errorClass}: not retried (${stop}): run failed`, {
            iteration,
            errorClass: failure.errorClass,
            recovery: failure.recovery,
            reason: stop,
            recoveriesUsed: ledger.used,
            budget,
            exhausted: true,
          });
        }
        return stream;
      }

      attempt++;
      ledger.used++;
      streak = { errorClass: failure.errorClass, count: streak.errorClass === failure.errorClass ? streak.count + 1 : 1 };
      const { discarded } = stream;
      const waitMs = failure.recovery === "backoff" ? backoffMs(stream.cause, attempt) : 0;
      yield* signal("redirect", "llm-recovery", `${failure.errorClass}: ${failure.recovery} and retry (attempt ${attempt})`, {
        iteration,
        errorClass: failure.errorClass,
        recovery: failure.recovery,
        attempt,
        recoveriesUsed: ledger.used,
        budget,
        // The failed attempt's streamed text is void: consumers drop it.
        streamedTextVoid: discarded.textChars > 0,
        discarded,
        ...(failure.recovery === "backoff" ? { waitMs } : {}),
        ...(failure.recovery === "shrink" ? { shrinkTarget: outputSide ? "output" : "prompt" } : {}),
      });

      if (outputSide) {
        // Output-side per-minute budget (OTPM): the prompt is fine, the asked
        // `max_tokens` is not. Lower it for this turn (normalize clears the
        // override after the turn); the prompt is re-sent unchanged.
        const budgetTokens = shrunkOutputBudget(call.outputBudgetSent);
        attemptState = transitionState(first.state, { maxOutputTokensOverride: budgetTokens });
        call = yield* prepareThinkGatewayCall({ ...prepare, state: attemptState, messagesForRequest });
      } else if (failure.recovery === "shrink") {
        ledger.shrinkSpent = true;
        const overflow = contextOverflowOf(stream.cause) ?? UNSTATED_OVERFLOW;
        const window = overflowRetryWindow(context.profile, overflow, failure.errorClass);
        messagesForRequest = [...params.reproject(window), ...params.requestTail];
        compaction = {
          ...overflow,
          retryWindow: window,
          messagesBefore: prepare.messagesForRequest.length,
          messagesAfter: messagesForRequest.length,
        };
        call = yield* prepareThinkGatewayCall({ ...prepare, state: attemptState, messagesForRequest });
      } else if (waitMs > 0) {
        yield* Effect.sleep(Duration.millis(waitMs));
      }
      // resample / backoff re-issue the prepared request: a fresh sample.
      stream = yield* consume(call);
    }

    if (compaction !== undefined) {
      yield* signal(
        "redirect",
        "context-overflow-recovered",
        `context overflow recovered: compacted to a ${String(compaction["retryWindow"])}-token window and retried once`,
        compaction,
      );
    }
    return stream;
  });
}
