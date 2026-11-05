/**
 * Think phase — context-overflow compact-and-retry (Plan 9 Phase 2, item 2d).
 *
 * A provider that rejects the prompt as too long (`LLMContextOverflowError`:
 * `context_overflow` or `request_too_large`) used to end the run at once with
 * `terminatedBy: "llm_error"`. Re-sending the same request cannot succeed, but
 * a smaller one can. This seam owns the gateway call (prepare + consume) and,
 * on an overflow failure only, re-projects the conversation once through the
 * canonical `project()` compaction at a tighter window and retries. A second
 * failure of any kind ends the run on the unchanged `llm_error` path. Exactly
 * one retry per think call; every decision is a `context-overflow` trace signal.
 */
import { Effect } from "effect";
import type { LLMMessage } from "@reactive-agents/llm-provider";
import { emitHarnessSignalInjected } from "../../utils/diagnostics.js";
import { resolveEffectiveNumCtx, type ContextProfile } from "../../../context/context-profile.js";
import { prepareThinkGatewayCall, type PrepareThinkGatewayCallParams } from "./prepare-think-gateway-call.js";
import { consumeThinkStream } from "./consume-think-stream.js";

/** The provider's typed overflow error tag (`@reactive-agents/llm-provider` errors.ts). */
export const CONTEXT_OVERFLOW_ERROR_TAG = "LLMContextOverflowError";

/** The retry projects at this fraction of the window that overflowed. */
export const OVERFLOW_RETRY_WINDOW_FRACTION = 0.5;

/** Window the projection assumes when the profile states none (from-kernel-state.ts). */
const DEFAULT_PROJECTION_WINDOW = 32_768;

/** Overflow facts read off the provider error. Zero = the provider did not state it. */
export interface ContextOverflowFacts {
  readonly tokenCount: number;
  readonly maxTokens: number;
}

const numberField = (rec: Record<string, unknown>, key: string): number => {
  const v = rec[key];
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
};

/**
 * Read a context-overflow failure off the raw stream failure value, or
 * `undefined` for any other failure. Structural (reads `_tag`), like
 * `describeLlmFailure`: the kernel never depends on a provider class identity.
 */
export function contextOverflowOf(cause: unknown): ContextOverflowFacts | undefined {
  if (typeof cause !== "object" || cause === null) return undefined;
  const rec = cause as Record<string, unknown>;
  if (rec["_tag"] !== CONTEXT_OVERFLOW_ERROR_TAG) return undefined;
  return { tokenCount: numberField(rec, "tokenCount"), maxTokens: numberField(rec, "maxTokens") };
}

/**
 * The tighter window the retry re-projects at: half of the smaller of the
 * window the projection used and the limit the provider stated. Deterministic.
 */
export function overflowRetryWindow(profile: ContextProfile, statedMaxTokens: number): number {
  const current = resolveEffectiveNumCtx(profile) ?? DEFAULT_PROJECTION_WINDOW;
  const base = statedMaxTokens > 0 ? Math.min(statedMaxTokens, current) : current;
  return Math.max(1, Math.floor(base * OVERFLOW_RETRY_WINDOW_FRACTION));
}

/** Inputs for {@link callThinkWithOverflowRetry}. */
export interface ThinkCallParams {
  /** The first attempt's gateway preflight inputs. */
  readonly prepare: PrepareThinkGatewayCallParams;
  /** Re-project the conversation thread through `project()` at `window` tokens. */
  readonly reproject: (window: number) => LLMMessage[];
  /** Request-only messages that ride after the projected thread (the guidance tail). */
  readonly requestTail: readonly LLMMessage[];
}

/**
 * Prepare + consume the think call. On a context overflow, re-project once at
 * a tighter window and retry; any second failure returns as-is (honest
 * `llm_error`). Same result shape as `consumeThinkStream`.
 */
export function callThinkWithOverflowRetry(params: ThinkCallParams) {
  return Effect.gen(function* () {
    const { prepare } = params;
    const first = yield* prepareThinkGatewayCall(prepare);
    const stream = yield* consumeThinkStream({ state: first.state, llmStreamEffect: first.llmStreamEffect, context: prepare.context });
    if (stream._tag !== "failed") return stream;
    const overflow = contextOverflowOf(stream.cause);
    if (overflow === undefined) return stream;

    const window = overflowRetryWindow(prepare.context.profile, overflow.maxTokens);
    const messages = [...params.reproject(window), ...params.requestTail];
    const { taskId, iteration } = first.state;
    yield* emitHarnessSignalInjected({
      taskId,
      iteration,
      signalKind: "redirect",
      origin: "context-overflow",
      content: `context overflow: compact to a ${window}-token window and retry once`,
      metadata: {
        ...overflow,
        retryWindow: window,
        messagesBefore: prepare.messagesForRequest.length,
        messagesAfter: messages.length,
        attempt: 1,
        exhausted: false,
      },
    });

    const second = yield* prepareThinkGatewayCall({ ...prepare, state: first.state, messagesForRequest: messages });
    const retried = yield* consumeThinkStream({ state: second.state, llmStreamEffect: second.llmStreamEffect, context: prepare.context });
    if (retried._tag === "failed") {
      const again = contextOverflowOf(retried.cause);
      yield* emitHarnessSignalInjected({
        taskId,
        iteration,
        signalKind: "block",
        origin: "context-overflow",
        content: again
          ? "context overflow repeated after compaction: run failed"
          : "compaction retry failed: run failed",
        metadata: { ...(again ?? {}), retryWindow: window, attempt: 2, exhausted: true },
      });
    }
    return retried;
  });
}
