/**
 * Provider streaming helpers — shared emit patterns for tool-call events.
 *
 * Each provider's `stream()` implementation emits `tool_use_start` and
 * `tool_use_delta` events as native tool calls arrive. The emit patterns
 * diverge by transport:
 *
 *   - **Anthropic** (`anthropic.ts`) — raw `streamEvent` listener; `start`
 *     fires on `content_block_start`, `delta` on `content_block_delta`.
 *     Separate sites; uses {@link emitToolUseStart} + {@link emitToolUseDelta}.
 *
 *   - **OpenAI** (`openai.ts`) — per-chunk SSE accumulator; `start` fires
 *     on the first chunk for a given tool index, `delta` on every chunk
 *     carrying argument fragments. Separate sites; uses both helpers.
 *
 *   - **Gemini / Local (Ollama)** — whole `args` arrive in a single chunk
 *     (no progressive streaming of arguments). Co-emit `start` + `delta`
 *     back-to-back via {@link emitToolCallComplete}.
 *
 * Centralizing these here gives type-safe construction, removes the
 * `as const` / `as StreamEvent` casts previously scattered across
 * providers, and provides a single grep target when adding a new
 * provider or changing the StreamEvent shape.
 *
 * Closes wiki HS-22 (audit: original "65 duplicated lines" count was
 * inflated — actual emit sites total 9 across 4 providers; co-emit pairs
 * collapse from 6 lines to 3).
 */

import type { StreamEvent } from "./types.js";

/**
 * Minimal structural type for the `emit` argument supplied by
 * `Stream.async<StreamEvent, _>`. Effect's full `Stream.Emit.Emit` type
 * is broader; we only need `.single()` here, and using a structural
 * subset keeps these helpers usable across Effect minor versions.
 */
export type StreamEventEmit = {
  readonly single: (event: StreamEvent) => unknown;
};

/**
 * Emit a `tool_use_start` event — signals that a tool invocation has
 * begun and announces its `id` and `name` to downstream consumers.
 */
export function emitToolUseStart(
  emit: StreamEventEmit,
  id: string,
  name: string,
): void {
  emit.single({ type: "tool_use_start", id, name });
}

/**
 * Emit a `tool_use_delta` event carrying a JSON-argument fragment.
 * `input` is the raw partial-JSON chunk as it arrived from the provider;
 * downstream accumulators concatenate fragments into the full argument
 * object.
 */
export function emitToolUseDelta(
  emit: StreamEventEmit,
  input: string,
): void {
  emit.single({ type: "tool_use_delta", input });
}

/**
 * Emit `tool_use_start` + `tool_use_delta` back-to-back for providers
 * whose transport delivers a complete tool call in a single chunk
 * (Gemini, Ollama). `args` is either a pre-stringified JSON payload or
 * a plain object — auto-stringified when not already a string.
 */
export function emitToolCallComplete(
  emit: StreamEventEmit,
  id: string,
  name: string,
  args: string | unknown,
): void {
  emitToolUseStart(emit, id, name);
  const input = typeof args === "string" ? args : JSON.stringify(args);
  emitToolUseDelta(emit, input);
}
