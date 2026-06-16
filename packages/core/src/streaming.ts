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
   * Optional durable-checkpoint observer. The kernel invokes it at each
   * iteration boundary (same point as checkpoint()) with a LOSSLESS serialized
   * snapshot of kernel state (produced by the kernel's codec) plus the
   * iteration number. The string is opaque to core; a durable controller
   * persists it (e.g. every-N-iterations to a RunStore) and Phase C's resume()
   * rehydrates it. Must not throw and must not block the loop — fire-and-forget
   * persistence belongs inside the implementation. Absent on the default
   * in-process controller, so the kernel pays zero cost unless durability is
   * enabled.
   */
  onCheckpoint?(serializedState: string, iteration: number): void;
}

/**
 * FiberRef carrying the per-call RunController for runStream() executions.
 *
 * Set by ExecutionEngine.executeStream() before execute(task) runs.
 * Read by runner.ts at each iteration boundary to implement pause/stop verbs.
 * Null for run() calls (no control plane needed).
 */
export const RunControllerRef = FiberRef.unsafeMake<RunControllerLike | null>(null);

/**
 * FiberRef carrying a durable-resume checkpoint as an opaque serialized string.
 *
 * Set by `ReactiveAgent.resume(runId)` (via `Effect.locally`) before re-running
 * the normal execute path. Read by the reasoning THINK phase
 * (`reasoning-think.ts`), which deserializes it with the kernel codec and places
 * the restored `KernelState` on `resumeState` so the kernel continues mid-stream
 * instead of starting fresh. The string is opaque to core (same contract as
 * `onCheckpoint`'s serialized snapshot) — no dependency on the reasoning layer.
 * Null for normal runs, so non-resume executions pay zero cost.
 */
export const ResumeStateRef = FiberRef.unsafeMake<string | null>(null);

/**
 * A human's approval decision for a paused durable run, carried into a resumed
 * pipeline by `ReactiveAgent.approveRun`/`denyRun` (via `Effect.locally`). Read
 * by the reasoning THINK phase (`reasoning-think.ts`) and forwarded as
 * `KernelInput.approvalDecision`, where the runner applies it at the gate instead
 * of re-thinking. Null on every normal run, so non-resume executions pay zero
 * cost. Mirrors `ResumeStateRef`. Durable HITL (Phase D).
 */
export interface ApprovalDecision {
  readonly gateId: string;
  readonly status: "approved" | "denied";
  readonly reason?: string;
}

export const ApprovalDecisionRef = FiberRef.unsafeMake<ApprovalDecision | null>(
  null,
);
