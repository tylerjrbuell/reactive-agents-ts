/**
 * Think phase — stream init + consumption stage.
 *
 * `handleThinking`'s stream stage, moved verbatim from `think.ts` (#219 /
 * HS-249 decomposition). Initializes the gateway stream (provider failure
 * → explained `ExecutionError` → `terminatedBy: "llm_error"`, unchanged);
 * then consumes it — the one closure that owns text/thinking/usage/
 * logprobs/tool-call/stop-reason accumulation, the FiberRef text-delta
 * callback (W1.3 thinking-channel rules preserved verbatim), and the
 * consumed stream record the normalization stage hydrates. Both failure
 * shapes return `_tag: "failed"` with the failed state; the success shape
 * returns `_tag: "consumed"` with the accumulated record.
 */
import { Effect, Either, Option, Stream, FiberRef } from "effect";
import { emitErrorSwallowed, errorTag, StreamingTextCallback } from "@reactive-agents/core";
import { ExecutionError } from "../../../errors/errors.js";
import { explainProviderError } from "./provider-error-explain.js";
import { gatewayStream } from "../../llm-gateway.js";
import { transitionState, type KernelState, type KernelContext } from "../../../kernel/state/kernel-state.js";

/** Locals {@link consumeThinkStream} needs from `handleThinking`. */
export interface ConsumeThinkStreamParams {
  /** The prepared request state (`buildThinkRequest` payload). */
  readonly state: KernelState
  /** The prepared, unexecuted gateway stream effect (`buildThinkRequest`). */
  readonly llmStreamEffect: ReturnType<typeof gatewayStream>
  readonly context: KernelContext
}

/**
 * Initialize and consume the LLM stream. Single failure path for both the
 * init and consume phases (`terminatedBy: "llm_error"`); single termination
 * ownership is preserved — no other stage may finalize here.
 */
export function consumeThinkStream(params: ConsumeThinkStreamParams) {
  return Effect.gen(function* () {
    const { llmStreamEffect, context } = params;
    let state = params.state;
    const { input } = context;
    const strategy = state.strategy;
    const streamInit = yield* Effect.either(
      llmStreamEffect.pipe(
        Effect.mapError(
          (err) => {
            const rawMessage =
              err && typeof err === "object" && "message" in err
                ? (err as { message: string }).message
                : String(err);
            const explained = explainProviderError(
              rawMessage,
              input.providerName,
              input.modelId,
            );
            return new ExecutionError({
              strategy,
              message: `LLM stream failed at iteration ${state.iteration}: ${explained}`,
              step: state.iteration,
              cause: err,
            });
          },
        ),
      ),
    );

    if (Either.isLeft(streamInit)) {
      return { _tag: "failed" as const, state: transitionState(state, {
        status: "failed" as const,
        error: streamInit.left.message,
        output: null,
        meta: {
          ...state.meta,
          terminatedBy: "llm_error",
        },
      }) };
    }

    const llmStream = streamInit.right;

    // Accumulate content + emit text deltas via FiberRef callback
    let accumulatedContent = "";
    // W1.3 thinking-channel consumption: accumulate the provider's internal
    // reasoning (StreamEvent `thinking_delta` chunks, or the full accumulated
    // text reported once on `content_complete.thinking`). Presence is NOT
    // consent (W1.2 ruling): on thinking-capable models this channel flows
    // even with no thinking config, so it is always-possible input here.
    // Zero new parsing — the value is handed untouched to
    // `thoughtResponse.thinking`, where the existing providerThinking /
    // rescueFromThinking / lastThinking machinery below consumes it.
    let accumulatedThinking = "";
    let accumulatedUsage = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCost: 0,
    };
    let accumulatedLogprobs: { token: string; logprob: number; topLogprobs?: readonly { token: string; logprob: number }[] }[] = [];
    // Native FC: accumulate tool_use blocks from stream events
    let accumulatedToolCalls: { id: string; name: string; input: string }[] = [];
    let accumulatedStopReason: string = "end_turn";

    const textDeltaCb = yield* FiberRef.get(StreamingTextCallback);

    let streamConsumeError: string | undefined;
    yield* Stream.runForEach(llmStream, (event) =>
      Effect.gen(function* () {
        if (event.type === "text_delta") {
          accumulatedContent += event.text;
          if (textDeltaCb) {
            yield* textDeltaCb(event.text).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "reasoning/src/kernel/capabilities/reason/think.ts:342", tag: errorTag(err) })));
          }
        } else if (event.type === "thinking_delta") {
          // W1.3 — internal-reasoning chunk (qwen3 `thinking` stream under
          // Ollama, Anthropic extended-thinking blocks). Accumulated verbatim;
          // never forwarded to the user-facing textDeltaCb.
          accumulatedThinking += event.thinking;
        } else if (event.type === "content_complete") {
          accumulatedContent = event.content;
          // Providers that report the full accumulated thinking once here
          // (streaming symmetry with CompletionResponse.thinking) overwrite
          // the delta-sum — they are the authoritative copy. Absent → keep
          // whatever the deltas accumulated.
          if (event.thinking !== undefined && event.thinking.length > 0) {
            accumulatedThinking = event.thinking;
          }
          // Extract stop reason from content_complete event if present
          if ("stopReason" in event && typeof (event as Record<string, unknown>).stopReason === "string") {
            accumulatedStopReason = (event as Record<string, unknown>).stopReason as string;
          }
        } else if (event.type === "usage") {
          accumulatedUsage = event.usage;
        } else if (event.type === "logprobs") {
          accumulatedLogprobs = [...accumulatedLogprobs, ...event.logprobs];
        } else if (event.type === "tool_use_start") {
          // Native FC: start accumulating a new tool call
          accumulatedToolCalls.push({ id: event.id, name: event.name, input: "" });
          accumulatedStopReason = "tool_use";
        } else if (event.type === "tool_use_delta") {
          // Native FC: accumulate JSON input for the current tool call
          const currentTC = accumulatedToolCalls[accumulatedToolCalls.length - 1];
          if (currentTC) {
            currentTC.input += event.input;
          }
        } else if (event.type === "error") {
          streamConsumeError = event.error;
        }
      }),
    ).pipe(
      // Providers (packages/llm-provider/src/providers/local.ts) implement
      // retry-on-timeout by re-forking a fresh `Stream.async` producer per
      // attempt (see `retryStreamBeforeFirstEmission`). Effect's own fiber
      // bookkeeping logs "Fiber terminated with an unhandled error" for
      // EVERY forked producer fiber that fails — including ones a *later*
      // retry attempt recovers from, and ones the `catchAll` below already
      // observes and converts into `streamConsumeError`/`terminatedBy:
      // "llm_error"`. That duplicate print reads as a crash even when the
      // run ultimately succeeds. Scoped to just this stream's pull (not a
      // global suppression), since every real failure is already surfaced
      // through the catchAll immediately below.
      Effect.withUnhandledErrorLogLevel(Option.none()),
      Effect.catchAll((streamErr) => {
        streamConsumeError =
          streamErr && typeof streamErr === "object" && "message" in streamErr
            ? (streamErr as { message: string }).message
            : String(streamErr);
        return Effect.void;
      }),
    );

    if (streamConsumeError !== undefined) {
      const explained = explainProviderError(
        streamConsumeError,
        input.providerName,
        input.modelId,
      );
      return { _tag: "failed" as const, state: transitionState(state, {
        status: "failed" as const,
        error: `LLM stream failed at iteration ${state.iteration}: ${explained}`,
        output: null,
        meta: {
          ...state.meta,
          terminatedBy: "llm_error",
        },
      }) };
    }

    // Payload seam — the accumulated stream record for the normalize stage.
    return {
      _tag: "consumed" as const,
      state,
      accumulatedContent,
      accumulatedThinking,
      accumulatedUsage,
      accumulatedLogprobs,
      accumulatedToolCalls,
      accumulatedStopReason,
    };
  });
}
