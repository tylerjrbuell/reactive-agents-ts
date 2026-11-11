/**
 * The terminal bus event of an aborted `runStream()`.
 *
 * Aborting a stream (its signal, `handle.terminate()`, or a consumer that
 * stops reading) interrupts the producer fiber in `execute-stream.ts`, so the
 * engine never reaches finalize and publishes no `AgentCompleted`. Without a
 * terminal event every bus consumer (Cortex run rows, trace bridges) saw the
 * run as live forever. {@link watchRunTerminal} gives the abort path one
 * `ExecutionCancelled` for the run, published only while the run is still
 * open: a run that already published a terminal, or whose producer finished
 * on its own (completed, failed, paused), gets none.
 *
 * Consumers that close aborted runs themselves (Cortex's `closeOpenRuns`)
 * stay correct: they drop a run once they see its terminal event.
 */
import { Effect } from "effect";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import type { EbLike } from "./runtime-context.js";

/** Bus events that end a run. */
const TERMINAL_TAGS = ["AgentCompleted", "TaskFailed", "ExecutionCancelled"] as const;

/** The open/settled state of one streamed run, as the abort path reads it. */
export interface RunTerminalWatch {
  /** Mark the run ended by its producer (no cancel event will follow). */
  readonly settle: Effect.Effect<void>;
  /** Drop the bus subscriptions. Safe to run more than once. */
  readonly release: Effect.Effect<void>;
  /** Publish `ExecutionCancelled` for the run unless it already ended. Runs at most once. */
  readonly publishIfOpen: Effect.Effect<void>;
}

/**
 * Watch run `taskId` on the bus for its terminal event. Subscribes to
 * `AgentCompleted`, `TaskFailed` and `ExecutionCancelled` for this taskId
 * only (sub-agent runs on the same bus are ignored).
 */
export const watchRunTerminal = (eb: EbLike, taskId: string): Effect.Effect<RunTerminalWatch> =>
  Effect.gen(function* () {
    let settled = false;
    const unsubscribes: Array<() => void> = [];
    for (const tag of TERMINAL_TAGS) {
      const unsubscribe = yield* eb.on(tag, (event) =>
        Effect.sync(() => {
          if (String(event.taskId) === taskId) settled = true;
        }),
      );
      unsubscribes.push(unsubscribe);
    }
    const release = Effect.sync(() => {
      for (const unsubscribe of unsubscribes.splice(0)) unsubscribe();
    });
    const publishIfOpen = Effect.suspend(() => {
      if (settled) return Effect.void;
      settled = true;
      return eb.publish({ _tag: "ExecutionCancelled", taskId }).pipe(
        Effect.catchAll((err) =>
          emitErrorSwallowed({
            site: "runtime/src/engine/stream-abort-terminal.ts:ExecutionCancelled",
            tag: errorTag(err),
          }),
        ),
      );
    });
    return {
      settle: Effect.sync(() => {
        settled = true;
      }),
      release,
      publishIfOpen: publishIfOpen.pipe(Effect.zipRight(release)),
    };
  });
