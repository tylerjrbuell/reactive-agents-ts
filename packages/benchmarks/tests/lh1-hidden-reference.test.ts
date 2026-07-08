// lh-1 replay tests (anti-reward-hack / vacuous-case guard, 2026-07-08).
//
// lh-1 is the long-horizon research + multi-file-deliverable instrument (Wave A
// task A1). Its accuracy is scored by a SCORER-WRITTEN hidden-reference.test.ts
// (materialized post-run, never seen by the agent) run with partial credit.
// These replay tests lock the instrument to the a9727e8c contract:
//   - a vacuous/empty deliverable scores 0 (no trivially-satisfiable criterion),
//   - a complete, well-formed three-file deliverable scores 1.0,
//   - a partial deliverable earns credit strictly between 0 and 1.
import { describe, it, expect } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { scoreTask } from "../src/judge.js"
import { LONG_HORIZON_TASKS, LH1_QUESTION_IDS, LH1_MIN_SOURCES } from "../src/tasks/long-horizon.js"
import type { BenchmarkTask } from "../src/types.js"

const lh1: BenchmarkTask = LONG_HORIZON_TASKS.find((t) => t.id === "lh-1")!

// Unroutable judge URL: dimensionRubric judge calls fail fast + deterministically
// (accuracy is scored by the verifiable command, not the judge).
const JUDGE_OPTS = { judgeUrl: "http://127.0.0.1:1" }

// ── Correct deliverable authoring ────────────────────────────────────────────

function url(i: number): string {
  return `https://example.org/wasi/source-${i}`
}

/** A complete, well-formed three-file deliverable that satisfies every check. */
function writeCorrectDeliverable(dir: string): void {
  const findings = LH1_QUESTION_IDS.map((id, i) => ({
    id,
    question: `Research question ${id} about server-side WebAssembly.`,
    answer:
      `Synthesized answer for ${id}: this is a substantive multi-sentence response ` +
      `that comfortably exceeds the minimum length floor and draws on more than one source.`,
    sources: [url(i * 2), url(i * 2 + 1)],
  }))
  writeFileSync(join(dir, "findings.json"), JSON.stringify(findings, null, 2), "utf8")

  const sections = LH1_QUESTION_IDS.map(
    (id) =>
      `## ${id}: overview\n\nThis section provides a detailed written synthesis for ${id}, ` +
      `well beyond the minimum section length so the deterministic coverage check passes ` +
      `for this question. It references multiple sources and explains the reasoning.\n`,
  )
  writeFileSync(
    join(dir, "report.md"),
    `# WASI Research Report\n\nOverall summary tying the six findings together.\n\n${sections.join("\n")}`,
    "utf8",
  )

  // Every URL cited in findings must appear here (superset), and the distinct
  // count must clear the floor. Six questions × 2 sources = 12 distinct URLs.
  const allUrls = LH1_QUESTION_IDS.flatMap((_, i) => [url(i * 2), url(i * 2 + 1)])
  writeFileSync(
    join(dir, "sources.md"),
    `# Sources\n\n${allUrls.map((u) => `- ${u}`).join("\n")}\n`,
    "utf8",
  )
}

async function accuracyOf(dir: string): Promise<number> {
  const dims = await scoreTask("done", lh1, dir, 5000, 40, JUDGE_OPTS)
  return dims.find((d) => d.dimension === "accuracy")?.score ?? -1
}

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), "lh1-replay-"))
}

// ── Task definition invariants ───────────────────────────────────────────────

describe("lh-1 task definition invariants", () => {
  it("is a ≥40-iteration long-horizon task with its own timeout override", () => {
    expect(lh1.tier).toBe("real-world")
    expect(lh1.maxIterations).toBe(50)
    expect(lh1.timeoutSec).toBe(1800)
    expect(lh1.tags).toContain("long-horizon")
    expect(lh1.tags).toContain("horizon:long")
  })

  it("scores accuracy via the hidden reference test with partial credit", () => {
    expect(lh1.successCriteria).toEqual({
      type: "verifiable",
      command: "bun test ./hidden-reference.test.ts",
      partialCredit: true,
    })
    expect(lh1.hiddenFixtures?.map((f) => f.path)).toEqual(["hidden-reference.test.ts"])
  })

  it("requires web-search + file-write as the ALL-OF grounding set", () => {
    expect(lh1.tools).toEqual([
      { kind: "required", name: "web-search" },
      { kind: "required", name: "file-write" },
      { kind: "available", name: "http-get" },
      { kind: "available", name: "file-read" },
    ])
  })

  it("declares one judge rubric per research-question family (none duplicating deterministic accuracy)", () => {
    const dims = lh1.dimensionRubrics?.map((r) => r.dimension) ?? []
    expect(dims).toEqual([
      "reasoning",
      "tool-mastery",
      "loop-intelligence",
      "memory-fidelity",
      "honest-uncertainty",
    ])
    expect(dims).not.toContain("accuracy")
  })

  it("names all six research question IDs in the prompt so the format is pinned", () => {
    for (const id of LH1_QUESTION_IDS) expect(lh1.prompt.includes(id)).toBe(true)
    expect(LH1_QUESTION_IDS.length).toBeGreaterThanOrEqual(6)
    expect(LH1_MIN_SOURCES).toBeGreaterThanOrEqual(6)
  })
})

// ── Replay scoring ───────────────────────────────────────────────────────────

describe("lh-1 replay scoring", () => {
  it("vacuous workspace (no deliverable files) scores 0 — no trivially-satisfiable criterion", async () => {
    const dir = makeDir()
    try {
      // Nothing written: the agent produced no deliverable at all.
      expect(await accuracyOf(dir)).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)

  it("vacuous-but-present deliverable (empty array, no sections) still scores 0", async () => {
    const dir = makeDir()
    try {
      writeFileSync(join(dir, "findings.json"), "[]", "utf8")
      writeFileSync(join(dir, "report.md"), "# Report\n\nNothing here.\n", "utf8")
      writeFileSync(join(dir, "sources.md"), "# Sources\n", "utf8")
      expect(await accuracyOf(dir)).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)

  it("complete, well-formed three-file deliverable scores 1.0", async () => {
    const dir = makeDir()
    try {
      writeCorrectDeliverable(dir)
      expect(await accuracyOf(dir)).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)

  it("partial deliverable (3 of 6 questions) earns credit strictly between 0 and 1", async () => {
    const dir = makeDir()
    try {
      const covered = LH1_QUESTION_IDS.slice(0, 3)
      const findings = covered.map((id, i) => ({
        id,
        question: `Research question ${id} about server-side WebAssembly.`,
        answer:
          `Synthesized answer for ${id}: a substantive multi-sentence response that ` +
          `exceeds the minimum length floor and cites a real source.`,
        sources: [url(i)],
      }))
      writeFileSync(join(dir, "findings.json"), JSON.stringify(findings), "utf8")
      writeFileSync(
        join(dir, "report.md"),
        covered
          .map(
            (id) =>
              `## ${id}: overview\n\nA detailed synthesis for ${id} that clears the section ` +
              `length floor and discusses the sources gathered for this question.\n`,
          )
          .join("\n"),
        "utf8",
      )
      // Clear the ≥6-distinct-source floor even though only 3 questions are
      // covered, so this test isolates the per-question coverage dimension of
      // partial credit (structure floor passes; 3 of 6 question tests pass).
      const allUrls = LH1_QUESTION_IDS.map((_, i) => url(i))
      writeFileSync(join(dir, "sources.md"), allUrls.map((u) => `- ${u}`).join("\n"), "utf8")

      const score = await accuracyOf(dir)
      expect(score).toBeGreaterThan(0)
      expect(score).toBeLessThan(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)
})
