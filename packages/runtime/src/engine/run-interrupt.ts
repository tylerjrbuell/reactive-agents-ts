/**
 * run-interrupt.ts — how a durable run that did not complete is left behind.
 *
 * A durable run ends in one of three ways: it completes, it waits on a person
 * (approval / question; their own rails), or it is interrupted. An interrupted
 * run (a user stop or pause, an abort, a thrown error, a failed or loop-stopped
 * result) must stay continuable from where it was: this module owns the pure
 * decision and the one persistence step.
 *
 *   - {@link classifyEnd}: is this end an interruption, and of what kind.
 *   - {@link persistInterrupt}: write the run's LAST noted state as the final
 *     checkpoint (the state after the last finished iteration, tool results
 *     included), the typed stop record, and the status (`paused` / `stopped` /
 *     `failed`). `agent.resumeRun(runId)` then continues from that state and the
 *     effect journal keeps completed tool calls from running again.
 *
 * A run in a loop stop keeps the kernel's own final checkpoint (no snapshot is
 * written for it). A crash writes nothing (nothing runs): its row stays
 * `running` with its last per-iteration checkpoint, and resumes the same way.
 */
import { Effect } from "effect";
import { RunStoreService, type RunStatus } from "../services/run-store.js";
import {
  summarizeLoopStop,
  type LoopStopSummary,
  type RunStopKind,
  type RunStopSummary,
} from "../loop-stop-summary.js";
import { loopStopOfResult } from "./loop-stop-resume.js";
import type { AgentResult } from "../builder/agent-result.js";

/** The stop kinds a person can request on a live run (`agent.pauseRun` / `agent.stopRun`). */
export type UserStopKind = "user-paused" | "user-stopped";

/** The last state a run noted: the codec-serialized kernel state and its iteration. */
export interface RunSnapshot {
  readonly serialized: string;
  readonly iteration: number;
}

/** The run row status an interruption of this kind leaves. */
export const statusOfStop = (kind: RunStopKind): RunStatus => {
  switch (kind) {
    case "user-paused":
      return "paused";
    case "user-stopped":
    case "loop":
      return "stopped";
    case "error":
    case "crash":
    case "budget":
    case "timeout":
      return "failed";
  }
};

/** The slice of a run result the end of a durable run is classified from. */
export interface EndedRun {
  readonly success?: boolean | undefined;
  readonly terminatedBy?: string | undefined;
  readonly error?: string | undefined;
  readonly loopStop?: LoopStopSummary | undefined;
  readonly metadata?: AgentResult["metadata"] | undefined;
}

/** An interruption: its kind, a one-line reason, and the stop record when the run already carries one. */
export interface Interruption {
  readonly kind: RunStopKind;
  readonly reason: string;
  readonly stop?: RunStopSummary;
}

const USER_STOP_REASONS: ReadonlySet<string> = new Set(["stop_requested", "terminate_requested"]);

/**
 * The kernel's own terminal reason for the run, from the terminal outcome it
 * attaches to the result. A graceful stop reports `terminatedBy: "end_turn"`
 * and `success: true` on the result (the synthesized answer), so the stop is
 * only visible here: `terminalOutcome.terminatedBy` is `stop_requested`.
 */
const kernelTerminalReason = (result: EndedRun): string | undefined => {
  const outcome: unknown = result.metadata?.extensions?.["terminalOutcome"];
  const reason: unknown = typeof outcome === "object" && outcome !== null ? Reflect.get(outcome, "terminatedBy") : undefined;
  return typeof reason === "string" ? reason : undefined;
};

/** The kind a failed result ended as: a spent budget, a timeout, or an error. */
const failureKind = (terminatedBy: string | undefined): RunStopKind => {
  const reason = terminatedBy ?? "";
  if (/max_iterations|budget/.test(reason)) return "budget";
  if (/timeout|timed_out/.test(reason)) return "timeout";
  return "error";
};

/**
 * Whether a run's result is an interruption, and of what kind. `requested` is
 * the stop a person asked for on the run's controller; it only counts when the
 * run actually ended on it (a run that finished its work while the request was
 * in flight completed). Order: a requested stop, a loop-guard stop, a failed
 * result. `undefined` means the run completed.
 */
export const classifyEnd = (
  result: EndedRun,
  requested: UserStopKind | undefined,
): Interruption | undefined => {
  const ended = kernelTerminalReason(result) ?? result.terminatedBy;
  if (requested !== undefined && ended !== undefined && USER_STOP_REASONS.has(ended)) {
    return { kind: requested, reason: requested };
  }
  const loop = result.loopStop ?? summaryOfRelayedLoopStop(result);
  // A controller early stop can still ship a good answer (`success: true`): that run completed, the record only says why the loop ended.
  if (loop !== undefined && result.success !== true) return { kind: "loop", reason: loop.reason, stop: { ...loop, kind: "loop" } };
  if (result.success === false) {
    return { kind: failureKind(result.terminatedBy), reason: result.error ?? result.terminatedBy ?? "the run failed" };
  }
  return undefined;
};

const summaryOfRelayedLoopStop = (result: EndedRun) => {
  const record = result.metadata !== undefined ? loopStopOfResult({ metadata: result.metadata }) : undefined;
  return record !== undefined ? summarizeLoopStop(record) : undefined;
};

/**
 * Persist an interruption: the snapshot as the final checkpoint (one past its
 * iteration, so it always wins `latestCheckpoint`), the stop record, then the
 * status. Returns the stop record written. Never fails (a store defect is the
 * caller's swallowed-error site).
 */
export const persistInterrupt = (params: {
  readonly runId: string;
  readonly kind: RunStopKind;
  readonly reason: string;
  readonly snapshot?: RunSnapshot;
  /** A stop record the run already carries (a loop stop): written as is, no snapshot. */
  readonly stop?: RunStopSummary;
}): Effect.Effect<RunStopSummary, never, RunStoreService> =>
  Effect.gen(function* () {
    const store = yield* RunStoreService;
    const { runId, kind } = params;
    if (params.stop === undefined && params.snapshot !== undefined) {
      yield* store.putCheckpoint(runId, params.snapshot.iteration + 1, params.snapshot.serialized);
    }
    const iteration =
      params.snapshot?.iteration ?? (yield* store.latestCheckpoint(runId))?.iteration ?? 0;
    const calls = new Map<string, number>();
    for (const row of yield* store.listToolEffects(runId)) {
      if (row.status === "succeeded") calls.set(row.toolName, (calls.get(row.toolName) ?? 0) + 1);
    }
    const summary: RunStopSummary = params.stop ?? {
      kind,
      reason: params.reason,
      toolsDone: [...calls].map(([tool, n]) => ({ tool, calls: n })),
      unfinished: [],
      iteration,
    };
    yield* store.setStop(runId, summary);
    yield* store.setStatus(runId, statusOfStop(kind));
    return summary;
  });
