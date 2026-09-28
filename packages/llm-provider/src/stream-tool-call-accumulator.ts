/**
 * Shared streamed-tool-call accumulator for OpenAI-compatible providers.
 *
 * `openai.ts` and `litellm.ts` both speak the OpenAI-compatible chunk
 * dialect: tool-call deltas arrive progressively, addressed by `index`,
 * with `id` + `function.name` on first sight and `function.arguments`
 * fragments thereafter. Both providers also share an adapter-normalization
 * path: when the selected adapter supplies `parseToolCalls`, per-chunk
 * `tool_use_*` emissions are suppressed and a single synthesized start+delta
 * pair is emitted at `finish_reason` from a reconstructed OpenAI-shaped
 * response.
 *
 * This module owns that shared core so the two providers cannot drift. Each
 * provider retains its own transport-specific outer loop (and, for openai,
 * its provider-local Cluster-B non-OK-finish guard).
 *
 * Emit helpers and the structural `StreamEventEmit` type come from
 * {@link ./streaming-helpers.js}.
 */

import type { ProviderAdapter } from "./adapter.js";
import type { StreamEventEmit } from "./streaming-helpers.js";
import { emitToolUseDelta, emitToolUseStart } from "./streaming-helpers.js";

/**
 * Minimal shape of a single streamed tool-call delta in the OpenAI-compatible
 * dialect. Matches `choices[i].delta.tool_calls[j]` for both openai.ts and
 * litellm.ts.
 */
export type StreamToolCallDelta = {
  readonly index: number;
  readonly id?: string;
  readonly function?: {
    readonly name?: string;
    readonly arguments?: string;
  };
};

/** Options accepted by {@link createStreamToolCallAccumulator}. */
export type StreamToolCallAccumulatorOptions = {
  /** Stream emit sink (`Stream.async` emit). */
  readonly emit: StreamEventEmit;
  /**
   * When true the accumulator suppresses per-chunk `tool_use_*` emissions and
   * relies on {@link StreamToolCallAccumulator.synthesize} at finish.
   */
  readonly useAdapterNormalization: boolean;
  /** Adapter normalization hook; required for synthesis to emit anything. */
  readonly parseToolCalls: ProviderAdapter["parseToolCalls"];
  /** Model id forwarded to `parseToolCalls`. */
  readonly model: string;
  /** Short provider id used for fallback synthetic tool-call ids. */
  readonly providerShortId: string;
  /** Returns accumulated assistant text for the synthetic response. */
  readonly getTextContent: () => string;
};

/** Returned accumulator handle. */
export type StreamToolCallAccumulator = {
  /**
   * Fold a chunk's tool-call deltas into the per-index map. Emits
   * `tool_use_start` on first sight of an index (only when not normalizing
   * and both `id` + `name` are present) and `tool_use_delta` per argument
   * fragment (only when not normalizing).
   */
  readonly accumulate: (deltas: readonly StreamToolCallDelta[] | undefined) => void;
  /**
   * Idempotent end-of-stream synthesis. Under adapter normalization, builds
   * an OpenAI-shaped synthetic response from the accumulated calls, runs
   * `parseToolCalls`, and emits one start+delta pair per normalized call.
   * Safe to call from multiple terminal branches (e.g. `finish_reason` and a
   * defensive `[DONE]`).
   */
  readonly synthesize: (finishReason: string) => void;
  /** Number of distinct tool-call indices accumulated so far. */
  readonly size: number;
};

/**
 * Create a per-stream accumulator for OpenAI-compatible tool-call deltas.
 *
 * Behavior is identical to the former inline implementations in
 * `openai.ts` and `litellm.ts`; the litellm single-shot synthesis guard is
 * retained so the `finish_reason` and defensive `[DONE]` branches cannot
 * double-emit.
 */
export function createStreamToolCallAccumulator(
  options: StreamToolCallAccumulatorOptions,
): StreamToolCallAccumulator {
  const {
    emit,
    useAdapterNormalization,
    parseToolCalls,
    model,
    providerShortId,
    getTextContent,
  } = options;

  const toolCallAccum = new Map<
    number,
    { id: string; name: string; arguments: string }
  >();
  let synthesized = false;

  const accumulate = (deltas: readonly StreamToolCallDelta[] | undefined): void => {
    if (!deltas) return;
    for (const tc of deltas) {
      const existing = toolCallAccum.get(tc.index);
      if (existing) {
        if (tc.function?.arguments) {
          existing.arguments += tc.function.arguments;
        }
      } else {
        toolCallAccum.set(tc.index, {
          id: tc.id ?? "",
          name: tc.function?.name ?? "",
          arguments: tc.function?.arguments ?? "",
        });
        // Emit tool_use_start on first chunk for this tool.
        if (!useAdapterNormalization && tc.id && tc.function?.name) {
          emitToolUseStart(emit, tc.id, tc.function.name);
        }
      }
      // Emit argument deltas for progressive parsing.
      if (!useAdapterNormalization && tc.function?.arguments) {
        emitToolUseDelta(emit, tc.function.arguments);
      }
    }
  };

  const synthesize = (finishReason: string): void => {
    if (synthesized) return;
    if (toolCallAccum.size === 0) {
      synthesized = true;
      return;
    }
    synthesized = true;

    if (!useAdapterNormalization || !parseToolCalls) return;

    const rawCalls = [...toolCallAccum.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, v]) => ({
        id: v.id,
        type: "function" as const,
        function: {
          name: v.name,
          arguments: v.arguments,
        },
      }));
    const syntheticResponse = {
      choices: [
        {
          message: {
            content: getTextContent(),
            role: "assistant",
            tool_calls: rawCalls,
          },
          finish_reason: finishReason,
        },
      ],
    };
    const normalized = parseToolCalls(syntheticResponse, model);
    if (normalized && normalized.length > 0) {
      for (let i = 0; i < normalized.length; i++) {
        const tc = normalized[i]!;
        const id = rawCalls[i]?.id || `${providerShortId}-tc-${i}`;
        emitToolUseStart(emit, id, tc.name);
        emitToolUseDelta(emit, JSON.stringify(tc.arguments));
      }
    }
  };

  return {
    accumulate,
    synthesize,
    get size() {
      return toolCallAccum.size;
    },
  };
}
