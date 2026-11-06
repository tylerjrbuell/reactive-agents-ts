// Instrument pins (bonsai-2:27b H3, 2026-11-05). Zero-token: the deterministic
// "test" provider stalls past the cell timeout, so the run is aborted mid-LLM-call.
//
// 1. A timed-out cell must still point at its partial trace. Before the fix only
//    StreamCompleted carried the run id, so all 12 timed-out cells read
//    `no-trace` in run-h3.ts and were never diagnosed.
// 2. An aborted trace must hold each event once. It currently holds every
//    pre-abort event twice (8 + 8 + run-aborted here; 228 + 228 + 1 on bonsai rw-7).
//    Root cause was outside benchmarks: TraceRecorder.flush in
//    packages/trace/src/recorder.ts read `pending`, awaited appendFile, and only
//    then cleared it, so an interrupted or overlapping flush rewrote the batch.
//    Fixed by an atomic take (Ref.modify) + uninterruptible flush.
import { describe, expect, it } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadTrace } from "@reactive-agents/trace"
import { runSession } from "../src/runner.js"
import type { BenchmarkSession, BenchmarkTask } from "../src/types.js"

const stallTask: BenchmarkTask = {
  id: "to-stall", tier: "trivial", name: "stall", prompt: "Say hi.",
  successCriteria: { type: "regex", pattern: "hi" },
}

/** Run one stalled cell into a fresh trace dir; hand the run row + trace file to `check`. */
async function withTimedOutCell(
  check: (run: { status: string; traceId?: string }, traceFile: string | null) => Promise<void>,
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "h3-timeout-"))
  try {
    const session: BenchmarkSession = {
      id: "timeout-trace", name: "timeout trace", version: "1", taskIds: [stallTask.id], tasks: [stallTask],
      models: [{ id: "test", provider: "test", model: "test", contextTier: "standard", scenarios: { [stallTask.id]: [{ text: "hi", delayMs: 8_000 }] } }],
      harnessVariants: [{ type: "internal", id: "ra-plain", label: "RA plain", config: {} }],
      runs: 1, concurrency: 1, timeoutMs: 1_500, logLevel: "silent", traceDir: dir,
    }
    const report = await runSession(session)
    const run0 = report.taskReports?.[0]?.runs[0]
    expect(run0).toBeDefined()
    await check(run0!, run0?.traceId ? join(dir, `${run0.traceId}.jsonl`) : null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe("timed-out cell trace", () => {
  it("a timed-out run reports the traceId of its partial (aborted) trace", () =>
    withTimedOutCell(async (run, file) => {
      expect(run.status).toBe("error")
      expect(file).not.toBeNull()
      expect(existsSync(file!)).toBe(true)
      const kinds = (await loadTrace(file!)).events.map((e) => e.kind)
      expect(kinds).toContain("run-started")
      expect(kinds).toContain("run-aborted")
    }), 30_000)

  it("an aborted run's trace has no duplicate seq", () =>
    withTimedOutCell(async (_run, file) => {
      expect(file).not.toBeNull()
      // Raw lines, not loadTrace: loadTrace dedupes on read and would hide the double write.
      const seqs = readFileSync(file!, "utf8").trim().split("\n").map((l) => (JSON.parse(l) as { seq: number }).seq)
      expect(new Set(seqs).size).toBe(seqs.length)
    }), 30_000)
})
