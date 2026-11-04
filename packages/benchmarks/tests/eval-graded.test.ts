// Grader-in-trace (2026-11-03): the bench's deterministic grade is appended to
// the run's trace as `eval-graded`, survives loadTrace, and drives
// analyzeCause's `wrong-answer` label. Also pins the verifiable check parser
// and the H3 re-grader's idempotency + mismatch refusal.
import { describe, it, expect } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadTrace, analyzeCause } from "@reactive-agents/trace"
import { buildEvalGraded, appendEvalGraded } from "../src/eval-graded.js"
import { parseGraderChecks, scoreVerifiable, scoreTask } from "../src/judge.js"
import { regradeCell } from "../src/h3/regrade.js"
import { runSession } from "../src/runner.js"
import type { BenchDimensionScore, BenchmarkSession, BenchmarkTask } from "../src/types.js"

const withDir = async <T>(f: (dir: string) => Promise<T> | T): Promise<T> => {
  const dir = mkdtempSync(join(tmpdir(), "eval-graded-test-"))
  try { return await f(dir) } finally { rmSync(dir, { recursive: true, force: true }) }
}

/** A minimal clean-success trace (cause `none` without a grade). */
const cleanTraceLines = (runId: string): string[] => [
  { runId, iter: -1, seq: 0, timestamp: 1, kind: "run-started", task: "t", model: "m", provider: "ollama", config: {} },
  { runId, iter: 1, seq: 1, timestamp: 2, kind: "guard-fired", guard: "deliverable_decision", outcome: "pass", reason: "verified" },
  { runId, iter: 1, seq: 2, timestamp: 3, kind: "guard-fired", guard: "terminal_decision", outcome: "terminate", reason: "end_turn", metadata: { terminatedBy: "end_turn", status: "done", authority: "model-final" } },
  {
    runId, iter: -1, seq: 3, timestamp: 4, kind: "run-completed", status: "success", totalTokens: 1, totalCostUsd: 0, durationMs: 1,
    terminatedBy: "end_turn", output: "the answer is 42", outcome: { authority: "model-final", status: "completed", success: true },
  },
].map((e) => JSON.stringify(e))

const acc = (over: Partial<BenchDimensionScore>): BenchDimensionScore[] => [{ dimension: "accuracy", score: 0, ...over }]

describe("buildEvalGraded", () => {
  it("builds a graded payload from a deterministic accuracy, passed = score >= 1", () => {
    const g = buildEvalGraded(
      acc({ score: 0.5, grader: "verifiable:bun hidden-check.ts", checks: [{ name: "a", passed: false }] }),
      { taskId: "t1", suiteHash: "abc", source: "bench" },
    )
    expect(g).toEqual({
      kind: "eval-graded", score: 0.5, passed: false, threshold: 1,
      checks: [{ name: "a", passed: false }], grader: "verifiable:bun hidden-check.ts",
      taskId: "t1", suiteHash: "abc", source: "bench",
    })
    expect(buildEvalGraded(acc({ score: 1, grader: "regex" }), { taskId: "t", source: "bench" })?.passed).toBe(true)
  })

  it("records nothing for judge-scored, inconclusive, or ungraded accuracy", () => {
    const ctx = { taskId: "t", source: "bench" as const }
    expect(buildEvalGraded(acc({ score: 0.2, judgeScored: true, grader: "x" }), ctx)).toBeUndefined()
    expect(buildEvalGraded(acc({ scoreState: "inconclusive", grader: "x" }), ctx)).toBeUndefined()
    expect(buildEvalGraded(acc({ score: 0 }), ctx)).toBeUndefined()
    expect(buildEvalGraded([], ctx)).toBeUndefined()
  })
})

describe("appendEvalGraded -> loadTrace -> analyzeCause roundtrip", () => {
  it("appends with the trace runId, seq = max+1, iter -1; loadTrace keeps it; cause becomes wrong-answer", () =>
    withDir(async (dir) => {
      const p = join(dir, "run.jsonl")
      writeFileSync(p, cleanTraceLines("RUN1").join("\n") + "\n", "utf8")
      expect(analyzeCause(await loadTrace(p)).cause).toBe("none")
      const g = buildEvalGraded(
        acc({ score: 0.8, grader: "verifiable:bun hidden-check.ts", checks: [{ name: "mean.txt correct", passed: false }] }),
        { taskId: "h3-x", source: "bench" },
      )!
      const r = appendEvalGraded(p, g, () => 99)
      expect(r.appended).toBe(true)
      const t = await loadTrace(p)
      const ev = t.events.at(-1)!
      expect(ev).toMatchObject({ kind: "eval-graded", runId: "RUN1", seq: 4, iter: -1, timestamp: 99, score: 0.8, passed: false })
      expect(analyzeCause(t)).toMatchObject({ cause: "wrong-answer", subCause: "mean.txt correct", confidence: "decisive" })
    }))

  it("a passing grade appends but leaves the label at none", () =>
    withDir(async (dir) => {
      const p = join(dir, "run.jsonl")
      writeFileSync(p, cleanTraceLines("RUN2").join("\n"), "utf8") // no trailing newline
      appendEvalGraded(p, buildEvalGraded(acc({ score: 1, grader: "regex", checks: [] }), { taskId: "t", source: "bench" })!)
      const t = await loadTrace(p)
      expect(t.events).toHaveLength(5)
      expect(analyzeCause(t).cause).toBe("none")
    }))

  it("does not throw on a missing or event-less trace", () =>
    withDir((dir) => {
      const g = buildEvalGraded(acc({ score: 0, grader: "regex" }), { taskId: "t", source: "bench" })!
      expect(appendEvalGraded(join(dir, "nope.jsonl"), g).appended).toBe(false)
      const empty = join(dir, "empty.jsonl")
      writeFileSync(empty, "", "utf8")
      expect(appendEvalGraded(empty, g).appended).toBe(false)
    }))
})

describe("parseGraderChecks / scoreVerifiable checks", () => {
  it("parses graded-check FAIL lines (with detail) and bun-test pass/fail lines", () => {
    const text = [
      "FAIL: mean.txt within tolerance — got 20.45",
      "FAIL: median correct",
      "(pass) parses csv [1.20ms]",
      "(fail) handles empty input [3ms]",
      "2 pass",
      "3 fail",
    ].join("\n")
    expect(parseGraderChecks(text)).toEqual([
      { name: "mean.txt within tolerance", passed: false, detail: "got 20.45" },
      { name: "median correct", passed: false },
      { name: "parses csv", passed: true },
      { name: "handles empty input", passed: false },
    ])
  })

  it("scoreVerifiable keeps every FAIL line as a check (evidence is cut, checks are not)", () =>
    withDir(async (dir) => {
      const long = "x".repeat(250)
      writeFileSync(join(dir, "check.ts"), [
        `console.error("FAIL: first ${long}")`,
        `console.error("FAIL: second")`,
        `console.log("1 pass")`, `console.log("2 fail")`, `process.exit(1)`,
      ].join("\n"))
      const s = await scoreVerifiable("bun check.ts", dir, true)
      expect(s.score).toBeCloseTo(1 / 3)
      expect(s.checks?.map((c) => c.name)).toEqual([`first ${long}`, "second"])
      expect(s.evidence!.length).toBeLessThan(260)
    }))

  it("with no named checks in the output, one check records the command's exit status", () =>
    withDir(async (dir) => {
      writeFileSync(join(dir, "ok.ts"), "process.exit(0)")
      expect((await scoreVerifiable("bun ok.ts", dir)).checks).toEqual([{ name: "bun ok.ts", passed: true, detail: "exit 0" }])
    }))

  it("scoreTask stamps the grader on deterministic accuracy", () =>
    withDir(async (dir) => {
      const t: BenchmarkTask = {
        id: "rx", tier: "trivial", name: "rx", prompt: "p", successCriteria: { type: "regex", pattern: "42" },
      }
      const [a] = await scoreTask("it is 41", t, dir, 0, 0, { judgeUrl: "http://127.0.0.1:1" })
      expect(a).toMatchObject({ dimension: "accuracy", score: 0, grader: "regex", checks: [{ name: "output matches /42/", passed: false }] })
    }))
})

describe("runSession wiring (no live model)", () => {
  // ab-trap-4 abstains at iteration 0 before any LLM call (see abstention-scored-e2e.test.ts),
  // so this drives the REAL runSession -> scoreTask -> appendEvalGraded chain deterministically.
  it("a bench run's own trace carries the eval-graded verdict, stamped with the session suiteHash", () =>
    withDir(async (dir) => {
      const session: BenchmarkSession = {
        id: "eval-graded-e2e", name: "eval-graded e2e", version: "1", taskIds: ["ab-trap-4"],
        models: [{ id: "test", provider: "test", model: "test", contextTier: "standard" }],
        harnessVariants: [{ type: "internal", id: "ra-full", label: "RA Full", config: { tools: true, reasoning: true } }],
        runs: 1, concurrency: 1, timeoutMs: 60_000, logLevel: "silent", traceDir: dir, suiteHash: "suite-xyz",
      }
      const report = await runSession(session)
      const traceId = report.taskReports?.[0]?.runs[0]?.traceId
      expect(traceId).toBeDefined()
      const t = await loadTrace(join(dir, `${traceId}.jsonl`))
      const g = t.events.filter((e) => e.kind === "eval-graded")
      expect(g).toHaveLength(1)
      expect(g[0]).toMatchObject({
        grader: "abstention", passed: true, score: 1, taskId: "ab-trap-4", source: "bench", suiteHash: "suite-xyz",
        checks: [{ name: "abstained (abstainExpected)", passed: true }],
      })
    }), 90_000)
})

describe("regradeCell (H3 trace re-grader)", () => {
  const regexTask: BenchmarkTask = {
    id: "rg", tier: "trivial", name: "rg", prompt: "p", successCriteria: { type: "regex", pattern: "answer is 42" },
  }
  const verifiableTask: BenchmarkTask = {
    id: "vf", tier: "trivial", name: "vf", prompt: "p",
    successCriteria: { type: "verifiable", command: "bun hidden-check.ts", partialCredit: true },
    hiddenFixtures: [{
      path: "hidden-check.ts",
      content: [
        `import { existsSync, readFileSync } from "node:fs"`,
        `const ok = existsSync("out.txt") && readFileSync("out.txt", "utf8").trim() === "7"`,
        `if (!ok) console.error("FAIL: out.txt holds 7")`,
        `console.log(ok ? "1 pass" : "0 pass")`, `console.log(ok ? "0 fail" : "1 fail")`,
        `process.exit(ok ? 0 : 1)`,
      ].join("\n"),
    }],
  }

  it("appends once, then is idempotent (already-graded)", () =>
    withDir(async (dir) => {
      const p = join(dir, "r.jsonl")
      writeFileSync(p, cleanTraceLines("RG").join("\n") + "\n", "utf8")
      const first = await regradeCell({ task: regexTask, traceFile: p, recordedAccuracy: 1, suiteHash: "h" })
      expect(first.status).toBe("appended")
      expect(first.grade).toMatchObject({ passed: true, source: "trace-regrade", suiteHash: "h" })
      const bytes = readFileSync(p, "utf8")
      const second = await regradeCell({ task: regexTask, traceFile: p, recordedAccuracy: 1 })
      expect(second.status).toBe("already-graded")
      expect(readFileSync(p, "utf8")).toBe(bytes)
    }))

  it("refuses to append when the re-graded score disagrees with the recorded accuracy", () =>
    withDir(async (dir) => {
      const p = join(dir, "r.jsonl")
      writeFileSync(p, cleanTraceLines("RG").join("\n") + "\n", "utf8")
      const bytes = readFileSync(p, "utf8")
      const r = await regradeCell({ task: regexTask, traceFile: p, recordedAccuracy: 0 })
      expect(r.status).toBe("mismatch")
      expect(r.regraded).toBe(1)
      expect(readFileSync(p, "utf8")).toBe(bytes)
    }))

  it("rebuilds the workspace from the trace's file-writes and grades with the hidden check", () =>
    withDir(async (dir) => {
      const write = (seq: number, content: string, ok = true) => JSON.stringify({
        runId: "VF", iter: 1, seq, timestamp: 10 + seq, kind: "tool-call-end", toolName: "file-write", ok,
        args: { path: `/somewhere/.bench-run-abc123/out.txt`, content },
      })
      const lines = cleanTraceLines("VF")
      const p = join(dir, "v.jsonl")
      // a wrong write, then a failed (ok:false) correct write that must NOT be replayed
      writeFileSync(p, [...lines.slice(0, 3), write(10, "6"), write(11, "7", false), lines[3]].join("\n") + "\n", "utf8")
      const r = await regradeCell({ task: verifiableTask, traceFile: p, recordedAccuracy: 0 })
      expect(r.status).toBe("appended")
      expect(r.grade).toMatchObject({ score: 0, passed: false, checks: [{ name: "out.txt holds 7", passed: false }] })
      expect(analyzeCause(await loadTrace(p))).toMatchObject({ cause: "wrong-answer", subCause: "out.txt holds 7" })

      const p2 = join(dir, "v2.jsonl")
      writeFileSync(p2, [...lines.slice(0, 3), write(10, "7"), lines[3]].join("\n") + "\n", "utf8")
      expect((await regradeCell({ task: verifiableTask, traceFile: p2, recordedAccuracy: 1, dryRun: true })).status).toBe("would-append")
      expect(readFileSync(p2, "utf8")).not.toContain("eval-graded")
    }))

  it("refuses cells with no recorded accuracy or no trace", async () => {
    expect((await regradeCell({ task: regexTask, traceFile: null, recordedAccuracy: 1 })).status).toBe("no-trace")
    await withDir(async (dir) => {
      const p = join(dir, "r.jsonl")
      writeFileSync(p, cleanTraceLines("RG").join("\n") + "\n", "utf8")
      expect((await regradeCell({ task: regexTask, traceFile: p, recordedAccuracy: null })).status).toBe("no-recorded-accuracy")
    })
  })
})
