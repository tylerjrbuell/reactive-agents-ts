/**
 * "Why it ended" for a finished run: the framework's own trace diagnosis
 * (`analyzeCause` + `attributeFailure` from `@reactive-agents/trace`, the engine
 * behind `rax-diagnose cause`) over the run's recorded JSONL trace. Cortex adds
 * only what the UI needs on top: a plain-words headline per cause, and the
 * kernel loop each evidence event belongs to so the run view can link it to its
 * trace row. Computed lazily and cached per run until the trace file changes.
 */
import { statSync } from "node:fs";
import { Effect } from "effect";
import {
  analyzeCause,
  attributeFailure,
  loadTrace,
  type AttributionVerdict,
  type CauseConfidence,
  type CauseEvidence,
  type FailureCause,
  type Trace,
} from "@reactive-agents/trace";
import { CortexError } from "../errors.js";
import { findRunTraceFile, traceDirs } from "./run-trace-file.js";

/**
 * Plain words for each framework failure cause. Typed over the framework's
 * closed `FailureCause` union, so a new cause is a type error here until it has
 * words. The framework ships no descriptions of its own (gap reported to the
 * trace owner); the raw cause id is always sent beside this headline.
 */
export const CAUSE_HEADLINES: Readonly<Record<FailureCause, string>> = {
  "direct-chat": "A direct model call, not an agent run",
  timeout: "The run hit its time limit",
  "user-stop": "Stopped by the user",
  aborted: "The run was aborted",
  "incomplete-trace": "The trace ends without the run finishing (process killed or crashed)",
  "provider-error": "The model provider returned an error",
  "satisfiability-abstain": "The agent declined up front: the task could not be done with what it had",
  "terminal-mislabel": "The final status contradicts how the run actually ended",
  "plan-posture-veto": "The plan posture limited the tools, and the result did not cover the task",
  "never-engaged": "The model never called a tool it needed",
  "tool-protocol": "The model's tool calls could not be resolved",
  "tool-failure": "Tool calls kept failing",
  "wrong-tool-arg": "A tool call failed on its arguments before a different call worked",
  "stall-after-work": "The harness ended the run as stalled after real work was done",
  "stall-no-progress": "The run stalled without making progress",
  "loop-after-work": "The harness ended a repeating loop after real work was done",
  "bookkeeping-loop": "The agent spent its loops on bookkeeping tools instead of the task",
  "verifier-reject": "The verifier rejected the final answer",
  "budget-cap": "The run used up its iteration budget",
  unexplained: "The run did not succeed, and no diagnosis rule explains why",
  "wrong-answer": "The run finished, but the grader marked the answer wrong",
  "success-with-warning": "Succeeded, with a warning",
  none: "Finished normally",
  undetermined: "The trace is too thin to tell why the run ended",
};

/** One trace event that supports a verdict, with the kernel loop it belongs to. */
export interface RunCauseEvidence {
  readonly eventKind: string;
  readonly seq: number;
  readonly detail: string;
  /** 1-based kernel loop (the run view's trace row), or `null` for run-level events. */
  readonly loop: number | null;
}

/** `GET /api/runs/:runId/cause` response. */
export type RunCauseReport =
  | { readonly available: false; readonly reason: "no-trace" | "not-a-run" }
  | {
      readonly available: true;
      readonly runId: string;
      readonly cause: FailureCause;
      readonly subCause?: string;
      readonly headline: string;
      readonly confidence: CauseConfidence;
      readonly outcomeStatus: string;
      readonly authority?: string;
      readonly evidence: readonly RunCauseEvidence[];
      /** Trace signals that would have made the verdict decisive. */
      readonly missing: readonly string[];
      readonly attribution: {
        readonly verdict: AttributionVerdict;
        readonly reason: string;
        readonly confidence: CauseConfidence;
        /** 1-based loop whose output produced the failing artifact or answer. */
        readonly divergenceLoop?: number;
        readonly target?: { readonly kind: "file" | "answer"; readonly ref: string };
        readonly evidence: readonly RunCauseEvidence[];
        readonly missing: readonly string[];
        readonly alsoMatched: readonly string[];
      };
    };

/** Trace `iter` is 0-based (-1 before the first loop); the run view numbers loops from 1. */
const loopOfIter = (iter: number | undefined): number | null =>
  typeof iter === "number" && iter >= 0 ? iter + 1 : null;

/**
 * Diagnose a loaded trace. Pure: the same trace always gives the same report.
 * A trace with no run lifecycle (a direct model call) reports `not-a-run`.
 */
export function diagnoseTrace(trace: Trace): RunCauseReport {
  const iterBySeq = new Map<number, number>();
  for (const e of trace.events) iterBySeq.set(e.seq, e.iter);
  const withLoop = (list: readonly CauseEvidence[]): RunCauseEvidence[] =>
    list.map((e) => ({ eventKind: e.eventKind, seq: e.seq, detail: e.detail, loop: loopOfIter(iterBySeq.get(e.seq)) }));
  const c = analyzeCause(trace);
  if (c.cause === "direct-chat") return { available: false, reason: "not-a-run" };
  const a = attributeFailure(trace);
  const divergenceLoop = a.divergenceTurn ? loopOfIter(a.divergenceTurn.iter) : null;
  return {
    available: true,
    runId: c.runId,
    cause: c.cause,
    ...(c.subCause ? { subCause: c.subCause } : {}),
    headline: CAUSE_HEADLINES[c.cause],
    confidence: c.confidence,
    outcomeStatus: c.outcomeStatus,
    ...(c.authority ? { authority: c.authority } : {}),
    evidence: withLoop(c.evidence),
    missing: c.missing,
    attribution: {
      verdict: a.verdict,
      reason: a.reason,
      confidence: a.confidence,
      ...(divergenceLoop !== null ? { divergenceLoop } : {}),
      ...(a.target ? { target: { kind: a.target.kind, ref: a.target.ref } } : {}),
      evidence: withLoop(a.evidence),
      missing: a.missing,
      alsoMatched: a.alsoMatched,
    },
  };
}

/** Reads and caches run diagnoses. One per server (see `runsRouter`). */
export interface RunCauseReader {
  /** The run's diagnosis, recomputed only when its trace file changed since the last read. */
  readonly causeOf: (runId: string) => Effect.Effect<RunCauseReport, CortexError>;
}

interface CacheEntry {
  readonly stamp: string;
  readonly report: RunCauseReport;
}

/**
 * Build a {@link RunCauseReader} over `dirs` (default: the tracer's directories).
 * The cache key is the trace file's size and mtime, so a run still writing its
 * trace is re-diagnosed on the next read; at most `maxEntries` runs are kept.
 */
export function makeRunCauseReader(opts: { readonly dirs?: () => readonly string[]; readonly maxEntries?: number } = {}): RunCauseReader {
  const dirs = opts.dirs ?? traceDirs;
  const maxEntries = opts.maxEntries ?? 200;
  const cache = new Map<string, CacheEntry>();
  const remember = (runId: string, entry: CacheEntry): void => {
    cache.delete(runId);
    cache.set(runId, entry);
    while (cache.size > maxEntries) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  };
  return {
    causeOf: (runId) =>
      Effect.gen(function* () {
        const file = findRunTraceFile(runId, dirs());
        if (file === undefined) return { available: false, reason: "no-trace" } as const;
        const st = yield* Effect.try({
          try: () => statSync(file),
          catch: (cause) => new CortexError({ message: `Could not read the trace for ${runId}`, cause }),
        });
        const stamp = `${st.size}:${st.mtimeMs}`;
        const hit = cache.get(runId);
        if (hit && hit.stamp === stamp) return hit.report;
        const trace = yield* Effect.tryPromise({
          try: () => loadTrace(file),
          catch: (cause) => new CortexError({ message: `Could not read the trace for ${runId}`, cause }),
        });
        const report = yield* Effect.try({
          try: () => diagnoseTrace(trace),
          catch: (cause) => new CortexError({ message: `Could not diagnose run ${runId}`, cause }),
        });
        remember(runId, { stamp, report });
        return report;
      }),
  };
}
