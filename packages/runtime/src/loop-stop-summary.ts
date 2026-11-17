/**
 * loop-stop-summary.ts — the host-facing view of a loop-guard stop.
 *
 * The kernel leaves a `LoopStopRecord` (reasoning `kernel/loop/loop-stop.ts`)
 * on a run that a loop guard ended. This leaf module owns the small, stable
 * summary the runtime surfaces on `AgentResult.loopStop`, the durable
 * `RunRecord.loopStop` column, and the chat failure note. Pure data, no
 * services: `RunStore`, the result surface and chat all import it.
 */
import type { LoopStopRecord } from "@reactive-agents/reasoning";

/**
 * Why a durable run did not complete. `loop` is a loop-guard stop; the rest
 * are interruptions a host can show and continue with `agent.resumeRun`.
 */
export type RunStopKind = "user-paused" | "user-stopped" | "error" | "crash" | "loop" | "budget" | "timeout";

/** Every {@link RunStopKind}, for parsers and exhaustive checks. */
export const RUN_STOP_KINDS: readonly RunStopKind[] = ["user-paused", "user-stopped", "error", "crash", "loop", "budget", "timeout"];

/**
 * Why a run stopped and what it had already done. Plain JSON. The one stop
 * record of every non-completed run: a loop-guard stop is the `loop` kind
 * (rows written before `kind` existed read as `loop`).
 */
export interface LoopStopSummary {
  /** What kind of stop this is (absent on a row from before kinds existed: `loop`). */
  readonly kind?: RunStopKind;
  /** The terminal reason (`loop_graceful`, `loop_detected:*`, `dispatcher-early-stop`, a failure message, `user-stopped`, ...). */
  readonly reason: string;
  /** The tool the run kept repeating, when the trailing actions repeat one call. */
  readonly repeatedTool?: string;
  /** Tools that already returned substantive results (not re-run on resume), with call counts. */
  readonly toolsDone: readonly { readonly tool: string; readonly calls: number }[];
  /** Titles of checklist rows still open at the stop. */
  readonly unfinished: readonly string[];
  /** The iteration the run stopped at. */
  readonly iteration: number;
}

/** The generic stop record of any non-completed run (see {@link LoopStopSummary}). */
export type RunStopSummary = LoopStopSummary;

/** The kind of a stop summary; a summary from before kinds existed is a loop stop. */
export const stopKindOf = (summary: LoopStopSummary): RunStopKind => summary.kind ?? "loop";

/** Project the kernel's stop record onto the host-facing summary. */
export const summarizeLoopStop = (record: LoopStopRecord): LoopStopSummary => ({
  reason: record.reason,
  ...(record.repeatedTool !== undefined ? { repeatedTool: record.repeatedTool } : {}),
  toolsDone: record.toolsDone.map((t) => ({ tool: t.tool, calls: t.calls })),
  unfinished: [...record.unfinished],
  iteration: record.iteration,
});

/** Parse a stored summary; `undefined` for absent or unreadable JSON. */
export const parseLoopStopSummary = (json: string | null | undefined): LoopStopSummary | undefined => {
  if (!json) return undefined;
  try {
    const v: unknown = JSON.parse(json);
    if (typeof v !== "object" || v === null) return undefined;
    const reason = Reflect.get(v, "reason");
    const iteration = Reflect.get(v, "iteration");
    const toolsDone: unknown = Reflect.get(v, "toolsDone");
    const unfinished: unknown = Reflect.get(v, "unfinished");
    const repeatedTool = Reflect.get(v, "repeatedTool");
    const rawKind: unknown = Reflect.get(v, "kind");
    const kind = RUN_STOP_KINDS.find((k) => k === rawKind);
    if (typeof reason !== "string" || typeof iteration !== "number") return undefined;
    if (!Array.isArray(toolsDone) || !Array.isArray(unfinished)) return undefined;
    return {
      ...(kind !== undefined ? { kind } : {}),
      reason,
      ...(typeof repeatedTool === "string" ? { repeatedTool } : {}),
      toolsDone: toolsDone.flatMap((t: unknown) => {
        const tool = typeof t === "object" && t !== null ? Reflect.get(t, "tool") : undefined;
        const calls = typeof t === "object" && t !== null ? Reflect.get(t, "calls") : undefined;
        return typeof tool === "string" && typeof calls === "number" ? [{ tool, calls }] : [];
      }),
      unfinished: unfinished.filter((u: unknown): u is string => typeof u === "string"),
      iteration,
    };
  } catch {
    return undefined;
  }
};

/** One line saying what the stopped run did and why it stopped (for the chat failure note). */
export const loopStopNote = (summary: LoopStopSummary): string => {
  const done = summary.toolsDone.slice(0, 6).map((t) => `${t.tool} x${t.calls}`).join(", ");
  return (
    `Stopped by ${summary.reason}` +
    (summary.repeatedTool !== undefined ? ` (repeating ${summary.repeatedTool})` : "") +
    (done.length > 0 ? `; already done: ${done}` : "")
  );
};
