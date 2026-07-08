// Hidden-fixture seam tests (anti-reward-hack, 2026-07-07).
//
// Contract under test:
//  1. `writeFixtures` (runner, pre-run) writes ONLY agent-visible fixtures —
//     hiddenFixtures must be absent during the run.
//  2. `scoreTask` (judge, post-run) materializes hiddenFixtures BEFORE any
//     scoring branch executes — including the abstention branch — so a
//     verifiable command can grade against reference files the agent never saw.
//  3. Hidden fixtures are excluded from the LLM-judge deliverable (they are
//     scoring apparatus, not agent output).
//  4. `computeGroundingSet` keeps the ALL-OF terminal gate minimal: contract
//     `required` tools only; `available` tools are exposed but never gated.
import { describe, it, expect } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { scoreTask, scoreVerifiable, writeHiddenFixtures, collectJudgeDeliverable } from "../src/judge.js"
import { writeFixtures, computeGroundingSet } from "../src/runner.js"
import { REAL_WORLD_TASKS } from "../src/tasks/real-world.js"
import type { BenchmarkTask } from "../src/types.js"

// Unroutable judge URL so dimensionRubric scoring fails fast + deterministically
// (never accidentally hits a live local judge-server on the default port).
const JUDGE_OPTS = { judgeUrl: "http://127.0.0.1:1" }

const baseTask: BenchmarkTask = {
  id: "hf-test",
  tier: "simple",
  name: "hidden fixture seam",
  prompt: "irrelevant",
  fixtures: [{ path: "visible.txt", content: "agent can see this" }],
  hiddenFixtures: [
    { path: "hidden-run.ts", content: "process.exit(0)\n" },
    { path: "nested/dir/ref.txt", content: "nested hidden reference" },
  ],
  successCriteria: { type: "verifiable", command: "bun hidden-run.ts" },
}

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), "hidden-fixtures-test-"))
}

describe("writeFixtures (pre-run) vs writeHiddenFixtures (pre-scoring)", () => {
  it("writeFixtures does NOT materialize hiddenFixtures — agent never sees them", () => {
    const dir = makeDir()
    try {
      writeFixtures(baseTask, dir)
      expect(existsSync(join(dir, "visible.txt"))).toBe(true)
      expect(existsSync(join(dir, "hidden-run.ts"))).toBe(false)
      expect(existsSync(join(dir, "nested/dir/ref.txt"))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("writeHiddenFixtures materializes hidden files, including nested paths, and overwrites agent-written collisions", () => {
    const dir = makeDir()
    try {
      // Agent tried to squat the hidden path — the reference must win.
      writeFileSync(join(dir, "hidden-run.ts"), "process.exit(1) // poisoned", "utf8")
      writeHiddenFixtures(baseTask, dir)
      expect(readFileSync(join(dir, "hidden-run.ts"), "utf8")).toBe("process.exit(0)\n")
      expect(readFileSync(join(dir, "nested/dir/ref.txt"), "utf8")).toBe("nested hidden reference")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("writeHiddenFixtures is a no-op for tasks without hiddenFixtures", () => {
    const dir = makeDir()
    try {
      const noHidden: BenchmarkTask = {
        id: "hf-none", tier: "simple", name: "no hidden", prompt: "irrelevant",
      }
      writeHiddenFixtures(noHidden, dir)
      expect(existsSync(join(dir, "hidden-run.ts"))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("scoreTask seam", () => {
  it("verifiable command only passes because scoreTask wrote the hidden fixture first", async () => {
    const dir = makeDir()
    try {
      writeFixtures(baseTask, dir)
      // Control: without hidden fixtures the command has nothing to run.
      const before = await scoreVerifiable("bun hidden-run.ts", dir)
      expect(before.score).toBe(0)
      // Real path: scoreTask writes hidden fixtures, then the command passes.
      const dims = await scoreTask("agent output", baseTask, dir, 100, 1, JUDGE_OPTS)
      const accuracy = dims.find((d) => d.dimension === "accuracy")
      expect(accuracy?.score).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 30_000)

  it("abstention branch also gets hidden fixtures (written before ANY branch)", async () => {
    const dir = makeDir()
    try {
      const trapTask: BenchmarkTask = { ...baseTask, abstainExpected: true }
      await scoreTask("agent output", trapTask, dir, 100, 1, JUDGE_OPTS, "abstained")
      // The abstention branch ran (accuracy comes from scoreAbstention), and
      // the hidden fixtures were still materialized for its verifiable check.
      expect(existsSync(join(dir, "hidden-run.ts"))).toBe(true)
      expect(existsSync(join(dir, "nested/dir/ref.txt"))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 30_000)

  it("hidden fixtures are excluded from the judge deliverable", () => {
    const dir = makeDir()
    try {
      writeHiddenFixtures(baseTask, dir)
      const excluded = collectJudgeDeliverable(
        "final text",
        dir,
        [...(baseTask.fixtures ?? []), ...(baseTask.hiddenFixtures ?? [])].map((f) => f.path),
      )
      expect(excluded.includes("hidden-run.ts")).toBe(false)
      // Control: without the exclusion the same file WOULD be attributed to
      // the agent as a produced file.
      const notExcluded = collectJudgeDeliverable("final text", dir, [])
      expect(notExcluded.includes("hidden-run.ts")).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("computeGroundingSet — ALL-OF gate stays minimal", () => {
  it("uses only `required` contract tools; `available` tools never enter the gate", () => {
    const rw7 = REAL_WORLD_TASKS.find((t) => t.id === "rw-7")!
    const declared = ["file-read", "file-write", "code-execute"]
    const grounding = computeGroundingSet(rw7, declared, declared)
    expect([...grounding].sort()).toEqual(["file-read", "file-write"])
    expect(grounding.includes("code-execute")).toBe(false)
  })

  it("legacy fixture task (no tools contract) grounds on file-read only", () => {
    const legacy: BenchmarkTask = {
      id: "legacy", tier: "simple", name: "legacy", prompt: "p",
      fixtures: [{ path: "a.txt", content: "x" }],
    }
    expect(computeGroundingSet(legacy, undefined, ["file-read", "file-write"])).toEqual(["file-read"])
  })

  it("contract with only `available` tools yields an empty grounding set (gate skipped)", () => {
    const task: BenchmarkTask = {
      id: "avail-only", tier: "simple", name: "avail", prompt: "p",
      tools: [{ kind: "available", name: "code-execute" }],
    }
    expect(computeGroundingSet(task, ["code-execute"], ["code-execute"])).toEqual([])
  })
})
