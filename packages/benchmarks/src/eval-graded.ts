// File: src/eval-graded.ts
//
// Grader-in-trace (2026-11-03). The bench's deterministic grader verdict used to
// live only in the results JSON, so `rax diagnose cause` read a trace that said
// HOW a run ended but never WHETHER its answer was right: a clean-ending wrong
// answer was labelled `none`. These helpers append that verdict to the run's own
// trace as an `eval-graded` event, which `analyzeCause` reads to label such runs
// `wrong-answer`.

import { appendFileSync, existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { EvalGradedEvent, TraceEventBase } from "@reactive-agents/trace"
import { diagnoseRun } from "./diagnose.js"
import type { BenchDimensionScore, RunDiagnosis } from "./types.js"

/** An `eval-graded` event before the trace base fields (runId/seq/iter/timestamp) are stamped. */
export type EvalGradedPayload = Omit<EvalGradedEvent, keyof TraceEventBase>

/** Deterministic graders share one solve bar: `isSolved` requires `score >= 1`. */
const DETERMINISTIC_THRESHOLD = 1

/**
 * Build the `eval-graded` payload for a scored run.
 *
 * Returns `undefined` when there is no deterministic verdict to record: no
 * accuracy dimension, an inconclusive accuracy (never measured), a judge-scored
 * accuracy (an LLM opinion, not a grader), or a score with no `grader` stamp.
 *
 * @param dimensions The run's scored dimensions (from `scoreTask`).
 * @param ctx Task id, optional suite fingerprint, and where the grade came from.
 */
export function buildEvalGraded(
  dimensions: ReadonlyArray<BenchDimensionScore>,
  ctx: { readonly taskId: string; readonly suiteHash?: string; readonly source: "bench" | "trace-regrade" },
): EvalGradedPayload | undefined {
  const acc = dimensions.find((d) => d.dimension === "accuracy")
  if (acc === undefined || acc.scoreState === "inconclusive" || acc.judgeScored === true || acc.grader === undefined) {
    return undefined
  }
  return {
    kind: "eval-graded",
    score: acc.score,
    passed: acc.score >= DETERMINISTIC_THRESHOLD,
    threshold: DETERMINISTIC_THRESHOLD,
    checks: acc.checks ?? [],
    grader: acc.grader,
    taskId: ctx.taskId,
    ...(ctx.suiteHash !== undefined ? { suiteHash: ctx.suiteHash } : {}),
    source: ctx.source,
  }
}

/** Outcome of {@link appendEvalGraded}. Never thrown: a failed append must not fail a bench cell. */
export type AppendEvalGradedResult =
  | { readonly appended: true; readonly event: EvalGradedEvent }
  | { readonly appended: false; readonly reason: string }

/**
 * Append an `eval-graded` event to a JSONL trace file. The event takes the
 * trace's `runId`, `seq` one past the highest existing `seq`, and `iter: -1`
 * (it is recorded after the run, outside any iteration).
 *
 * @param traceFile Absolute path to the run's `.jsonl` trace.
 * @param payload The grade from {@link buildEvalGraded}.
 * @param now Clock (injectable for tests).
 */
export function appendEvalGraded(
  traceFile: string,
  payload: EvalGradedPayload,
  now: () => number = Date.now,
): AppendEvalGradedResult {
  try {
    if (!existsSync(traceFile)) return { appended: false, reason: `trace not found: ${traceFile}` }
    const raw = readFileSync(traceFile, "utf8")
    let runId: string | undefined
    let maxSeq = -1
    for (const line of raw.split("\n")) {
      if (line.trim() === "") continue
      let parsed: unknown
      try { parsed = JSON.parse(line) } catch { continue }
      if (typeof parsed !== "object" || parsed === null) continue
      const rec = parsed as Record<string, unknown>
      if (runId === undefined && typeof rec.runId === "string") runId = rec.runId
      if (typeof rec.seq === "number" && rec.seq > maxSeq) maxSeq = rec.seq
    }
    if (runId === undefined) return { appended: false, reason: "trace has no event with a runId" }
    const event: EvalGradedEvent = { runId, timestamp: now(), iter: -1, seq: maxSeq + 1, ...payload }
    const sep = raw.length > 0 && !raw.endsWith("\n") ? "\n" : ""
    appendFileSync(traceFile, `${sep}${JSON.stringify(event)}\n`, "utf8")
    return { appended: true, event }
  } catch (e) {
    const message = typeof e === "object" && e !== null && "message" in e ? String(e.message) : String(e)
    return { appended: false, reason: message }
  }
}

/**
 * The runner's post-scoring step: append the run's deterministic grade to its
 * trace (when there is one to record), THEN diagnose the trace, so the
 * diagnosis already sees the grade. A failed append never fails the cell; it
 * is reported on stderr and the trace can be backfilled by `h3/regrade.ts`.
 *
 * @param traceDir Session trace dir (`undefined` = tracing off: no grade, no diagnosis).
 * @param traceId Run trace id (`<traceDir>/<traceId>.jsonl`).
 * @param dimensions The run's scored dimensions.
 * @param taskId Bench task id.
 * @param suiteHash Frozen-suite fingerprint, when the session declares one.
 */
export async function gradeThenDiagnose(
  traceDir: string | undefined,
  traceId: string | undefined,
  dimensions: ReadonlyArray<BenchDimensionScore>,
  taskId: string,
  suiteHash?: string,
): Promise<RunDiagnosis | undefined> {
  if (!traceDir || !traceId) return undefined
  const grade = buildEvalGraded(dimensions, { taskId, source: "bench", ...(suiteHash !== undefined ? { suiteHash } : {}) })
  if (grade) {
    const r = appendEvalGraded(join(traceDir, `${traceId}.jsonl`), grade)
    if (!r.appended) process.stderr.write(`[bench] eval-graded not appended for ${taskId}: ${r.reason}\n`)
  }
  return diagnoseRun(traceDir, traceId)
}
