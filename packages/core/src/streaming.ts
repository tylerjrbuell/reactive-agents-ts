import { FiberRef, Effect } from "effect";

/**
 * FiberRef carrying an optional text-delta callback for streaming agent runs.
 *
 * When set, the `react-kernel.ts` reasoning kernel reads this FiberRef on each
 * LLM streaming call and invokes it for every incoming text token. The FiberRef
 * is fiber-local — concurrent agent executions each get their own independent
 * copy with no risk of cross-contamination.
 *
 * Used by:
 * - `react-kernel.ts` (reads it; emits each token via the callback)
 * - `ExecutionEngine.executeStream()` (sets it to offer TextDelta events to a Queue)
 *
 * @example
 * ```typescript
 * import { FiberRef } from "effect";
 * import { StreamingTextCallback } from "@reactive-agents/core";
 *
 * // Set the callback before running execution:
 * await Effect.runPromise(
 *   FiberRef.locally(StreamingTextCallback, (text) =>
 *     Queue.offer(myQueue, { _tag: "TextDelta", text })
 *   )(myExecutionEffect)
 * );
 * ```
 */
export const StreamingTextCallback = FiberRef.unsafeMake<
  ((text: string) => Effect.Effect<void, never>) | null
>(null);
