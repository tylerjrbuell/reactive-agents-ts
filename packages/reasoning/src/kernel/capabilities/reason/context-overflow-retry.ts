/**
 * Think phase — context-overflow compact-and-retry (Plan 9 Phase 2, item 2d).
 *
 * A provider that rejects the prompt as too long (`LLMContextOverflowError`:
 * `context_overflow` or `request_too_large`) used to end the run at once with
 * `terminatedBy: "llm_error"`. Re-sending the same request cannot succeed, but
 * a smaller one can. This seam owns the gateway call (prepare + consume) and,
 * on an overflow failure only, re-projects the conversation through the
 * canonical `project()` compaction (deterministic, no LLM summary) at 0.7x the
 * prompt size the provider reported and retries.
 *
 * Latched ONCE PER RUN on a run slot (advisor design, architecture-convergence
 * program "2d design"): a run whose history outgrows the window twice is not
 * rescued by compacting again, it is failing. Every later overflow in the run,
 * and a failed retry, end the run on the unchanged `llm_error` path.
 *
 * Trace facts (origin, all trace-only): `context-overflow-recovered` when the
 * compacted retry succeeded; `context-overflow` (`exhausted: true`) when the
 * retry failed or the run's one recovery was already spent.
 */
import { Effect } from "effect";
import type { LLMMessage } from "@reactive-agents/llm-provider";
import { currentRunContext, getRunSlot, runSlot, type RunSlot } from "@reactive-agents/core/internal/run-scope";
import { emitHarnessSignalInjected } from "../../utils/diagnostics.js";
import { resolveEffectiveNumCtx, type ContextProfile } from "../../../context/context-profile.js";
import { prepareThinkGatewayCall, type PrepareThinkGatewayCallParams } from "./prepare-think-gateway-call.js";
import { consumeThinkStream } from "./consume-think-stream.js";

/** The provider's typed overflow error tag (`@reactive-agents/llm-provider` errors.ts). */
export const CONTEXT_OVERFLOW_ERROR_TAG = "LLMContextOverflowError";

/** The retry projects at this fraction of the prompt size the provider reported. */
export const OVERFLOW_RETRY_WINDOW_FRACTION = 0.7;

/** Window the projection assumes when the profile states none (from-kernel-state.ts). */
const DEFAULT_PROJECTION_WINDOW = 32_768;

/** The run's one context-overflow recovery. A sub-agent gets its own. */
export interface OverflowRecoveryLatch {
  spent: boolean;
}

/** Run slot latching the compact-and-retry to once per run (reset for sub-agents). */
export const overflowRecoverySlot: RunSlot<OverflowRecoveryLatch> = runSlot<OverflowRecoveryLatch>(
  "reasoning.contextOverflowRecovery",
  { child: "reset", fresh: () => ({ spent: false }) },
);

/**
 * The latch for this run. Outside a run scope there is no run to latch on, and
 * the slot's process fallback would be shared by every unscoped kernel in the
 * process, so an unscoped call gets a latch of its own (one retry per call).
 */
const runLatch: Effect.Effect<OverflowRecoveryLatch> = Effect.flatMap(currentRunContext, (run) =>
  run === null ? Effect.succeed({ spent: false }) : getRunSlot(overflowRecoverySlot),
);

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
 * The window the retry re-projects at: 0.7x the prompt size the provider
 * reported (`tokenCount`), or 0.7x the projected window when the provider did
 * not state it. Never wider than 0.7x the projected window, so the retry always
 * compacts below what overflowed. Deterministic.
 */
export function overflowRetryWindow(profile: ContextProfile, overflow: ContextOverflowFacts): number {
  const projected = resolveEffectiveNumCtx(profile) ?? DEFAULT_PROJECTION_WINDOW;
  const base = overflow.tokenCount > 0 ? Math.min(overflow.tokenCount, projected) : projected;
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
 * Prepare + consume the think call. On the run's first context overflow,
 * re-project at a tighter window and retry; any other failure, a failed
 * retry, or a later overflow returns as-is (honest `llm_error`). Same result
 * shape as `consumeThinkStream`.
 */
export function callThinkWithOverflowRetry(params: ThinkCallParams) {
  return Effect.gen(function* () {
    const { prepare } = params;
    const first = yield* prepareThinkGatewayCall(prepare);
    const stream = yield* consumeThinkStream({ state: first.state, llmStreamEffect: first.llmStreamEffect, context: prepare.context });
    if (stream._tag !== "failed") return stream;
    const overflow = contextOverflowOf(stream.cause);
    if (overflow === undefined) return stream;

    const { taskId, iteration } = first.state;
    // `block` = the run fails on llm_error (`context-overflow`); `redirect` = recovered.
    const signal = (signalKind: "block" | "redirect", content: string, metadata: Record<string, unknown>) =>
      emitHarnessSignalInjected({
        taskId,
        iteration,
        signalKind,
        origin: signalKind === "block" ? "context-overflow" : "context-overflow-recovered",
        content,
        metadata,
      });
    const latch = yield* runLatch;
    if (latch.spent) {
      yield* signal("block", "context overflow again after this run's one compaction: run failed", {
        ...overflow,
        latched: true,
        exhausted: true,
      });
      return stream;
    }
    latch.spent = true;

    const window = overflowRetryWindow(prepare.context.profile, overflow);
    const messages = [...params.reproject(window), ...params.requestTail];
    const compaction = {
      ...overflow,
      retryWindow: window,
      messagesBefore: prepare.messagesForRequest.length,
      messagesAfter: messages.length,
    };
    const second = yield* prepareThinkGatewayCall({ ...prepare, state: first.state, messagesForRequest: messages });
    const retried = yield* consumeThinkStream({ state: second.state, llmStreamEffect: second.llmStreamEffect, context: prepare.context });
    if (retried._tag === "failed") {
      const again = contextOverflowOf(retried.cause);
      yield* signal(
        "block",
        again ? "context overflow repeated after compaction: run failed" : "compaction retry failed: run failed",
        { ...compaction, ...(again ? { retryTokenCount: again.tokenCount } : {}), latched: false, exhausted: true },
      );
      return retried;
    }
    yield* signal("redirect", `context overflow recovered: compacted to a ${window}-token window and retried once`, compaction);
    return retried;
  });
}
