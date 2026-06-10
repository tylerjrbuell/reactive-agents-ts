import { FiberRef, Effect } from "effect";
import type { KernelStateLike } from "./services/entropy-sensor-tag.js";

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
 * import { Effect } from "effect";
 * import { StreamingTextCallback } from "@reactive-agents/core";
 *
 * // Set the callback before running execution:
 * await Effect.runPromise(
 *   Effect.locally(
 *     myExecutionEffect,
 *     StreamingTextCallback,
 *     (text) => Queue.offer(myQueue, { _tag: "TextDelta", text }),
 *   )
 * );
 * ```
 */
export const StreamingTextCallback = FiberRef.unsafeMake<
  ((text: string) => Effect.Effect<void, never>) | null
>(null);

/** Minimal interface accessed by runner.ts for pause/stop control. */
export interface RunControllerLike {
  checkpoint(): Promise<{ stop: true } | undefined>;
  /**
   * Optional durable-checkpoint observer. When present, the kernel invokes it
   * at each iteration boundary (same point as checkpoint()) with a readonly
   * reference to the current kernel state. Implementations decide whether and
   * how to persist (e.g. every-N-iterations serialization to a RunStore).
   * Must not throw and must not block the loop — fire-and-forget persistence
   * belongs inside the implementation. Absent on the default in-process
   * controller, so the kernel pays zero cost unless durability is enabled.
   */
  onCheckpoint?(state: Readonly<KernelStateLike>, iteration: number): void;
}

/**
 * FiberRef carrying the per-call RunController for runStream() executions.
 *
 * Set by ExecutionEngine.executeStream() before execute(task) runs.
 * Read by runner.ts at each iteration boundary to implement pause/stop verbs.
 * Null for run() calls (no control plane needed).
 */
export const RunControllerRef = FiberRef.unsafeMake<RunControllerLike | null>(null);
