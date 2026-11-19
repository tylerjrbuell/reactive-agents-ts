/**
 * LLM calls a run started but that never reported back: the run's cost cannot
 * be complete while one exists.
 *
 * A call interrupted in flight (the run aborted, a timeout raced it) may still
 * be billed by the provider, but it never reports usage, so the run meter
 * never sees it. The observable LLM wrapper publishes `LLMRequestStarted`
 * before every traced call and `LLMRequestCompleted` when it ends (success,
 * failure, or a stream finalizer). A `complete()` / `completeStructured()`
 * call that is interrupted publishes no `LLMRequestCompleted`, so a started
 * call without its completion is exactly a call cut in flight. (An
 * interrupted stream does publish its completion, without usage; the meter
 * flags that call's cost unknown on its own.)
 *
 * {@link withInFlightLlmTracking} counts the pair for one run's taskId
 * (sub-agent runs carry their own taskId and get their own cell) for the
 * whole engine run (`execute-run-exit.ts`). The tracker lives in a run slot
 * cell, so `settleRunSpend` and the aborted-run cost read it through
 * {@link hasInFlightLlmCall} without a new FiberRef binding.
 */
import { Effect } from "effect";
import { getRunSlot, runSlot } from "@reactive-agents/core/internal/run-scope";
import type { EbLike } from "./runtime-context.js";

/** A live count of one run's started-but-unreported LLM calls. */
export interface InFlightLlmCalls {
  /** Calls started for the run with no `LLMRequestCompleted` yet. Never negative. */
  readonly pending: () => number;
  /** Stop listening. Idempotent. */
  readonly release: Effect.Effect<void>;
}

/** The run's tracker cell; `current` is `null` outside a tracked engine run. Reset for sub-agents. */
const inFlightLlmCallsSlot = runSlot<{ current: InFlightLlmCalls | null }>("runtime.inFlightLlmCalls", {
  child: "reset",
  fresh: () => ({ current: null }),
});

/** Count `LLMRequestStarted` minus `LLMRequestCompleted` for `taskId` on `eb`. */
export const trackInFlightLlmCalls = (eb: EbLike, taskId: string): Effect.Effect<InFlightLlmCalls> =>
  Effect.gen(function* () {
    let started = 0;
    let completed = 0;
    const unsubscribes = [
      yield* eb.on("LLMRequestStarted", (event) =>
        Effect.sync(() => {
          if (event.taskId === taskId) started += 1;
        }),
      ),
      yield* eb.on("LLMRequestCompleted", (event) =>
        Effect.sync(() => {
          if (event.taskId === taskId) completed += 1;
        }),
      ),
    ];
    return {
      pending: () => Math.max(0, started - completed),
      release: Effect.sync(() => {
        for (const unsubscribe of unsubscribes.splice(0)) unsubscribe();
      }),
    };
  });

/**
 * Run `self` with the run's in-flight LLM call tracker installed in the run
 * slot; released and cleared on every exit. No bus: `self` unchanged.
 */
export const withInFlightLlmTracking = <A, E, R>(
  eb: EbLike | null,
  taskId: string,
  self: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  eb === null
    ? self
    : Effect.flatMap(getRunSlot(inFlightLlmCallsSlot), (cell) =>
        Effect.acquireUseRelease(
          Effect.tap(trackInFlightLlmCalls(eb, taskId), (tracker) =>
            Effect.sync(() => {
              cell.current = tracker;
            }),
          ),
          () => self,
          (tracker) =>
            Effect.zipRight(
              tracker.release,
              Effect.sync(() => {
                if (cell.current === tracker) cell.current = null;
              }),
            ),
        ),
      );

/** Whether the current run has an LLM call cut in flight (`false` when untracked). */
export const hasInFlightLlmCall: Effect.Effect<boolean> = Effect.map(
  getRunSlot(inFlightLlmCallsSlot),
  (cell) => cell.current !== null && cell.current.pending() > 0,
);
