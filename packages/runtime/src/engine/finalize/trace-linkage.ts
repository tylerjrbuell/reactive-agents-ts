// packages/runtime/src/engine/finalize/trace-linkage.ts
/**
 * W0.5 result→trace linkage (Local-Tier Reliability program).
 *
 * Mints the `{ runId, tracePath }` pair that the finalize seam writes onto
 * `TaskResult.metadata`, so every `agent.run()` result is self-describing:
 * consumers (Lift Protocol captures, `rax diagnose replay`, eval tooling)
 * reach the run's JSONL trace file from the RESULT object instead of
 * directory-mtime guessing.
 *
 * Honesty law (the program's fake-green enemy, applied to this plumbing):
 * the pair is emitted ONLY when the trace file demonstrably exists on disk
 * after a settle-flush. Tracing disabled, recorder absent, or zero events
 * for this run => `null` => the metadata fields stay absent. A path to a
 * non-existent file would poison `rax diagnose` usage worse than silence.
 *
 * Path derivation mirrors the recorder's own convention
 * (`packages/trace/src/recorder.ts` `flush`: `join(dir, `${runId}.jsonl`)`).
 * The trace event `runId` IS the engine `taskId` (packages/trace/src/
 * normalize.ts maps `runId: raw.taskId`), and task ids are ULIDs
 * (`@reactive-agents/core` `generateTaskId`), matching the `ULID_RUN_FILE`
 * retention pattern. No new path registry.
 *
 * Flush-before-publish: EventBus.publish awaits all handlers
 * (core/services/event-bus.ts:1505-1512), so events already published by
 * the run are in the recorder's pending buffer by the time the finalize
 * seam mints the result. The direct `recorder.flush(runId)` here settles
 * whatever is pending (no-op if the bridge already flushed on
 * AgentCompleted) before the existence check; the mint never promises an
 * unwritten file.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import { TraceRecorderService } from "@reactive-agents/trace";

/** The metadata pair minted when (and only when) a run's trace file exists. */
export interface TraceLinkage {
  readonly runId: string;
  readonly tracePath: string;
}

/**
 * Settle-flush the run's buffered trace events, then return the linkage pair
 * iff `<traceDir>/<taskId>.jsonl` exists. Returns `null` (fields absent) for
 * any un-recorded run; never fails.
 */
export function mintTraceLinkage(
  traceDir: string | null | undefined,
  taskId: string,
): Effect.Effect<TraceLinkage | null, never> {
  if (!traceDir) return Effect.succeed(null);
  const tracePath = join(traceDir, `${taskId}.jsonl`);
  return Effect.gen(function* () {
    // Recorder is only in context when tracing was composed (tracing-layer.ts);
    // serviceOption keeps the disabled/config-mismatch path non-fatal.
    const recorderOpt = yield* Effect.serviceOption(TraceRecorderService);
    if (recorderOpt._tag === "Some") {
      yield* recorderOpt.value.flush(taskId);
    }
    return existsSync(tracePath) ? { runId: taskId, tracePath } : null;
  });
}
