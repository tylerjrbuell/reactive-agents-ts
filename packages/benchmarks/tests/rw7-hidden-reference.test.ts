// rw-7 replay tests (anti-reward-hack, 2026-07-07).
//
// Proven defect being locked out: with the old `bun test` criterion the agent
// could author its own trivial test (`expect(true).toBe(true)`) — or plant a
// bug in a self-invented file and "fix" it — and score accuracy 1.0 with zero
// fixture bugs touched (traces 01KWXTV1DNF, 01KWZKRZ3G). The new criterion
// (`bun test hidden-reference` + hiddenFixtures reference tests) must:
//   - score < 1 (in fact 0) for the vacuous trivial-test workspace,
//   - score 1.0 when the three fixture bugs are actually fixed,
//   - award partial credit strictly between 0 and 1 for a partial fix.
import { describe, it, expect } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { scoreTask, scoreVerifiable } from "../src/judge.js"
import { writeFixtures } from "../src/runner.js"
import { REAL_WORLD_TASKS } from "../src/tasks/real-world.js"
import type { BenchmarkTask } from "../src/types.js"

const rw7: BenchmarkTask = REAL_WORLD_TASKS.find((t) => t.id === "rw-7")!

// Unroutable judge URL: dimensionRubric judge calls fail fast + deterministically.
const JUDGE_OPTS = { judgeUrl: "http://127.0.0.1:1" }

// ── Correct reference implementations (the fixes the task intends) ───────────

const FIXED_VALIDATOR = `// validator.ts (fixed)
export type ValidationResult = { valid: boolean; errors: string[] }

export function validate(
  data: unknown,
  schema: { required: string[] },
): ValidationResult {
  if (typeof data !== "object" || data === null) {
    return { valid: false, errors: ["Input must be an object"] }
  }
  const obj = data as Record<string, unknown>
  const errors: string[] = []
  for (const field of schema.required) {
    if (!(field in obj) || obj[field] === undefined) {
      errors.push(\`Missing required field: \${field}\`)
    }
  }
  return { valid: errors.length === 0, errors }
}
`

const FIXED_PROCESSOR = `// processor.ts (fixed)
export function filterLargeList<T>(items: T[], predicate: (item: T) => boolean): T[] {
  if (items.length >= 10) {
    return items.filter(predicate)
  }
  return items
}

export function normalizeScores(scores: number[]): number[] {
  const max = Math.max(...scores)
  if (max === 0) return scores.map(() => 0)
  return scores.map(s => s / max)
}
`

const FIXED_PIPELINE = `// pipeline.ts (fixed)
export type PipelineState = { count: number; results: string[] }

async function processFirst(state: PipelineState): Promise<string> {
  await new Promise(r => setTimeout(r, 1))
  state.count += 1
  return \`first-\${state.count}\`
}

async function processSecond(state: PipelineState): Promise<string> {
  await new Promise(r => setTimeout(r, 1))
  return \`second-\${state.count}\`
}

export async function runPipeline(state: PipelineState): Promise<string[]> {
  const r1 = await processFirst(state)
  const r2 = await processSecond(state)
  return [r1, r2]
}
`

const TRIVIAL_AGENT_TEST = `import { it, expect } from "bun:test"
it("everything is fine", () => expect(true).toBe(true))
`

function makeWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "rw7-replay-"))
  writeFixtures(rw7, dir) // buggy fixtures, exactly as the agent receives them
  return dir
}

async function accuracyOf(dir: string): Promise<number> {
  const dims = await scoreTask("done", rw7, dir, 1000, 5, JUDGE_OPTS)
  return dims.find((d) => d.dimension === "accuracy")?.score ?? -1
}

describe("rw-7 task definition invariants", () => {
  it("criteria runs ONLY the hidden reference file, with partial credit", () => {
    expect(rw7.successCriteria).toEqual({
      type: "verifiable",
      command: "bun test ./hidden-reference.test.ts",
      partialCredit: true,
    })
    expect(rw7.hiddenFixtures?.map((f) => f.path)).toEqual(["hidden-reference.test.ts"])
  })

  it("prompt names all three fixture paths so absolute-path substitution fires", () => {
    for (const p of ["src/validator.ts", "src/processor.ts", "src/pipeline.ts"]) {
      expect(rw7.prompt.includes(p)).toBe(true)
    }
  })

  it("tool contract: file-read/file-write required, code-execute exposed but not gated", () => {
    expect(rw7.tools).toEqual([
      { kind: "required", name: "file-read" },
      { kind: "required", name: "file-write" },
      { kind: "available", name: "code-execute" },
    ])
  })
})

describe("rw-7 replay scoring", () => {
  it("vacuous workspace (trivial agent test, bugs untouched): OLD command passed, NEW scores 0", async () => {
    const dir = makeWorkspace()
    try {
      writeFileSync(join(dir, "agent.test.ts"), TRIVIAL_AGENT_TEST, "utf8")
      // The exploit under the OLD criterion: agent-authored trivial test makes
      // bare `bun test` exit 0 → accuracy 1.0 with zero fixture bugs touched.
      const old = await scoreVerifiable("bun test", dir, true)
      expect(old.score).toBe(1)
      // NEW criterion: hidden reference tests all fail against the buggy code,
      // and the agent's trivial test is filtered out of the grade entirely.
      expect(await accuracyOf(dir)).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)

  it("fully fixed workspace scores 1.0", async () => {
    const dir = makeWorkspace()
    try {
      writeFileSync(join(dir, "src/validator.ts"), FIXED_VALIDATOR, "utf8")
      writeFileSync(join(dir, "src/processor.ts"), FIXED_PROCESSOR, "utf8")
      writeFileSync(join(dir, "src/pipeline.ts"), FIXED_PIPELINE, "utf8")
      expect(await accuracyOf(dir)).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)

  it("partial fix (validator only) earns partial credit strictly between 0 and 1", async () => {
    const dir = makeWorkspace()
    try {
      writeFileSync(join(dir, "src/validator.ts"), FIXED_VALIDATOR, "utf8")
      const score = await accuracyOf(dir)
      expect(score).toBeGreaterThan(0)
      expect(score).toBeLessThan(1)
      // One reference test per bug → 1 pass / 3 total.
      expect(score).toBeCloseTo(1 / 3, 5)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)

  it("agent broke a fixture while 'fixing' (syntax error): hidden tests fail — score 0", async () => {
    const dir = makeWorkspace()
    try {
      writeFileSync(join(dir, "src/validator.ts"), "export function validate( {{{ broken", "utf8")
      expect(await accuracyOf(dir)).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)
})
