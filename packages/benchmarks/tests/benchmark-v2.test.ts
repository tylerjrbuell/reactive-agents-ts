import { test, expect } from "bun:test"
import type {
  BenchmarkTask,
  QualityDimension,
  DimensionScore,
  RunScore,
  TaskVariantReport,
  AblationResult,
  SessionReport,
  HarnessVariant,
  InternalVariant,
  CompetitorVariant,
  HarnessConfig,
  BenchmarkSession,
  ModelVariant,
  DimensionRubric,
  TaskFixture,
  SuccessCriteria,
  DriftReport,
  TaskRunResult,
} from "../src/types.js"
import type { CompetitorRunner } from "../src/competitors/types.js"

test("QualityDimension covers all 10 dimensions", () => {
  const dims: QualityDimension[] = [
    "accuracy", "reasoning", "tool-mastery", "memory-fidelity",
    "loop-intelligence", "resilience", "efficiency", "reliability",
    "scope-discipline", "honest-uncertainty",
  ]
  expect(dims).toHaveLength(10)
})

test("SuccessCriteria discriminated union has 4 variants", () => {
  const a: SuccessCriteria = { type: "regex", pattern: "foo" }
  const b: SuccessCriteria = { type: "verifiable", command: "bun check output.ts" }
  const c: SuccessCriteria = { type: "llm-judge", rubric: "Is it correct?" }
  const d: SuccessCriteria = { type: "schema", schema: {} }
  expect([a, b, c, d]).toHaveLength(4)
})

test("HarnessVariant discriminated union works", () => {
  const internal: InternalVariant = {
    type: "internal", id: "bare-llm", label: "Bare LLM", config: {},
  }
  const competitor: CompetitorVariant = {
    type: "competitor", id: "langchain-react", label: "LangChain JS", framework: "langchain",
  }
  const variants: HarnessVariant[] = [internal, competitor]
  expect(variants).toHaveLength(2)
})

test("BenchmarkTask accepts real-world tier and v2 optional fields", () => {
  const task: BenchmarkTask = {
    id: "rw-1", tier: "real-world", name: "Test", prompt: "Do X",
    successCriteria: { type: "regex", pattern: "ok" },
    primaryDimensions: ["accuracy"],
    fixtures: [{ path: "data.csv", content: "a,b\n1,2\n" }],
  }
  expect(task.tier).toBe("real-world")
})

test("task-registry exports BENCHMARK_TASKS with 25 tasks", async () => {
  const { BENCHMARK_TASKS } = await import("../src/task-registry.js")
  expect(BENCHMARK_TASKS.length).toBe(25)
})

test("getTasksByTier returns only tasks of that tier", async () => {
  const { getTasksByTier } = await import("../src/task-registry.js")
  const trivial = getTasksByTier("trivial")
  expect(trivial.every(t => t.tier === "trivial")).toBe(true)
  expect(trivial.length).toBeGreaterThan(0)
})

import { REAL_WORLD_TASKS } from "../src/tasks/real-world.js"

test("REAL_WORLD_TASKS exports exactly 10 tasks", () => {
  expect(REAL_WORLD_TASKS).toHaveLength(10)
})

test("all real-world tasks have required v2 fields", () => {
  for (const task of REAL_WORLD_TASKS) {
    expect(task.tier).toBe("real-world")
    expect(task.successCriteria).toBeDefined()
    expect(task.primaryDimensions?.length).toBeGreaterThanOrEqual(2)
    expect(task.dimensionRubrics?.length).toBeGreaterThanOrEqual(2)
  }
})

test("rw-2 fixture includes sales-data.csv with 3 day headers", () => {
  const task = REAL_WORLD_TASKS.find(t => t.id === "rw-2")!
  const csv = task.fixtures?.find(f => f.path === "sales-data.csv")
  expect(csv).toBeDefined()
  expect(csv!.content).toContain("2025-03-10")
  expect(csv!.content).toContain("2025-03-11")
  expect(csv!.content).toContain("ELEC-4K-TV-001")
})

test("rw-7 fixture includes three buggy TypeScript files", () => {
  const task = REAL_WORLD_TASKS.find(t => t.id === "rw-7")!
  const paths = task.fixtures?.map(f => f.path) ?? []
  expect(paths).toContain("src/validator.ts")
  expect(paths).toContain("src/processor.ts")
  expect(paths).toContain("src/pipeline.ts")
})

import { ABLATION_VARIANTS, resolveTasks, mergeConfigs } from "../src/session.js"
import { BENCHMARK_TASKS } from "../src/task-registry.js"

test("ABLATION_VARIANTS has exactly 9 variants", () => {
  expect(ABLATION_VARIANTS).toHaveLength(9)
})

test("ABLATION_VARIANTS has 4 internal variants and 5 competitor variants", () => {
  const internal = ABLATION_VARIANTS.filter(v => v.type === "internal")
  const competitor = ABLATION_VARIANTS.filter(v => v.type === "competitor")
  expect(internal).toHaveLength(4)
  expect(competitor).toHaveLength(5)
})

test("ABLATION_VARIANTS contains all 5 competitor frameworks", () => {
  const frameworks = ABLATION_VARIANTS
    .filter(v => v.type === "competitor")
    .map(v => (v as any).framework)
  expect(frameworks).toContain("langchain")
  expect(frameworks).toContain("vercel-ai")
  expect(frameworks).toContain("openai-agents")
  expect(frameworks).toContain("mastra")
  expect(frameworks).toContain("llamaindex")
})

test("resolveTasks by taskIds returns matching tasks", () => {
  const session = {
    id: "test", name: "test", version: "1.0.0",
    taskIds: ["rw-1", "rw-2"],
    models: [], harnessVariants: [],
  }
  const tasks = resolveTasks(session, [...BENCHMARK_TASKS, ...REAL_WORLD_TASKS])
  expect(tasks).toHaveLength(2)
  expect(tasks.map(t => t.id)).toContain("rw-1")
})

test("resolveTasks by tier returns tasks of that tier", () => {
  const session = {
    id: "test", name: "test", version: "1.0.0",
    tiers: ["real-world" as const],
    models: [], harnessVariants: [],
  }
  const tasks = resolveTasks(session, [...BENCHMARK_TASKS, ...REAL_WORLD_TASKS])
  expect(tasks.length).toBe(10)
  expect(tasks.every(t => t.tier === "real-world")).toBe(true)
})

test("mergeConfigs combines base and override", () => {
  const base = { tools: true, reasoning: true }
  const override = { reactiveIntelligence: true, strategy: "react" as const }
  const merged = mergeConfigs(base, override)
  expect(merged.tools).toBe(true)
  expect(merged.reasoning).toBe(true)
  expect(merged.reactiveIntelligence).toBe(true)
  expect(merged.strategy).toBe("react")
})

import { computeReliability, matchSuccessCriteria, parsePartialCreditScore } from "../src/judge.js"

test("computeReliability returns 1.0 for single run", () => {
  const runs = [{ dimensions: [{ dimension: "accuracy" as const, score: 0.8 }], tokensUsed: 100, durationMs: 1000, status: "pass" as const, output: "", runIndex: 0 }]
  expect(computeReliability(runs)).toBe(1)
})

test("computeReliability returns 1.0 for perfectly consistent runs", () => {
  const makeRun = (score: number, i: number) => ({
    runIndex: i, dimensions: [{ dimension: "accuracy" as const, score }],
    tokensUsed: 100, durationMs: 1000, status: "pass" as const, output: "",
  })
  const runs = [makeRun(0.9, 0), makeRun(0.9, 1), makeRun(0.9, 2)]
  expect(computeReliability(runs)).toBeCloseTo(1.0, 3)
})

test("computeReliability returns < 0.5 for highly inconsistent runs", () => {
  const makeRun = (score: number, i: number) => ({
    runIndex: i, dimensions: [{ dimension: "accuracy" as const, score }],
    tokensUsed: 100, durationMs: 1000, status: "pass" as const, output: "",
  })
  const runs = [makeRun(0.0, 0), makeRun(1.0, 1), makeRun(0.0, 2)]
  expect(computeReliability(runs)).toBeLessThan(0.5)
})

test("matchSuccessCriteria regex: matches correctly", () => {
  expect(matchSuccessCriteria("the answer is 42", { type: "regex", pattern: "42" })).toBe(1.0)
  expect(matchSuccessCriteria("the answer is 7", { type: "regex", pattern: "42" })).toBe(0.0)
})

test("matchSuccessCriteria regex: case-insensitive", () => {
  expect(matchSuccessCriteria("Hello World", { type: "regex", pattern: "hello" })).toBe(1.0)
})

test("parsePartialCreditScore: extracts pass ratio from bun test output", () => {
  const output = "3 pass\n1 fail\n"
  expect(parsePartialCreditScore(output)).toBeCloseTo(0.75, 2)
})

test("parsePartialCreditScore: returns 1.0 when all pass", () => {
  const output = "5 pass\n0 fail\n"
  expect(parsePartialCreditScore(output)).toBe(1.0)
})

test("parsePartialCreditScore: returns 0.0 when all fail", () => {
  const output = "0 pass\n3 fail\n"
  expect(parsePartialCreditScore(output)).toBe(0.0)
})

test("parsePartialCreditScore: returns 0.0 when output is unparseable", () => {
  expect(parsePartialCreditScore("some random output")).toBe(0.0)
})

test("CompetitorRunner interface is importable", () => {
  // Type-level check — if this compiles, the interface is correct
  const mockRunner: CompetitorRunner = {
    id: "test-runner",
    label: "Test Runner",
    framework: "langchain",
    pinnedVersion: "0.3.0",
    async run(_task, _model, _tmpDir, _timeoutMs): Promise<TaskRunResult> {
      return { output: "test", tokensUsed: 0, durationMs: 0, iterations: 0, status: "pass" }
    },
  }
  expect(mockRunner.id).toBe("test-runner")
})

import { COMPETITOR_RUNNERS } from "../src/competitors/index.js"

test("COMPETITOR_RUNNERS registry has all 5 frameworks", () => {
  expect(Object.keys(COMPETITOR_RUNNERS)).toContain("langchain")
  expect(Object.keys(COMPETITOR_RUNNERS)).toContain("vercel-ai")
  expect(Object.keys(COMPETITOR_RUNNERS)).toContain("openai-agents")
  expect(Object.keys(COMPETITOR_RUNNERS)).toContain("mastra")
  expect(Object.keys(COMPETITOR_RUNNERS)).toContain("llamaindex")
})

test("each competitor runner has required fields", () => {
  for (const runner of Object.values(COMPETITOR_RUNNERS)) {
    expect(typeof runner.id).toBe("string")
    expect(typeof runner.label).toBe("string")
    expect(typeof runner.framework).toBe("string")
    expect(typeof runner.pinnedVersion).toBe("string")
    expect(typeof runner.run).toBe("function")
  }
})

test("openai-agents runner skips for non-OpenAI provider", async () => {
  const runner = COMPETITOR_RUNNERS["openai-agents"]!
  const fakeTask = {
    id: "test", tier: "trivial" as const, name: "Test", prompt: "Say hi",
  }
  const fakeModel = {
    id: "haiku", provider: "anthropic" as const, model: "claude-haiku-4-5",
  }
  const result = await runner.run(fakeTask, fakeModel, "/tmp", 5000)
  expect(result.status).toBe("error")
  expect(result.error).toContain("OpenAI")
})

import { computeDrift, exceedsThreshold } from "../src/ci.js"
import type { TaskVariantReport, DimensionScore, RunScore } from "../src/types.js"

function makeReport(taskId: string, variantId: string, accuracyScore: number): TaskVariantReport {
  const dim: DimensionScore = { dimension: "accuracy", score: accuracyScore }
  const run: RunScore = { runIndex: 0, dimensions: [dim], tokensUsed: 100, durationMs: 500, status: accuracyScore >= 0.6 ? "pass" : "fail", output: "" }
  return {
    taskId, modelVariantId: "haiku", variantId, variantLabel: variantId,
    runs: [run], meanScores: [dim], variance: 0,
    meanTokens: 100, meanDurationMs: 500, passRate: accuracyScore >= 0.6 ? 1 : 0,
  }
}

test("computeDrift detects regression when score drops > threshold", () => {
  const baseline = [makeReport("rw-1", "ra-full", 0.9)]
  const current  = [makeReport("rw-1", "ra-full", 0.6)]
  const drift = computeDrift(baseline, current, "abc123", 0.15)
  expect(drift.hasRegressions).toBe(true)
  expect(drift.regressions).toHaveLength(1)
  expect(drift.regressions[0]!.delta).toBeCloseTo(-0.3, 2)
})

test("computeDrift detects improvement when score rises", () => {
  const baseline = [makeReport("rw-1", "ra-full", 0.5)]
  const current  = [makeReport("rw-1", "ra-full", 0.8)]
  const drift = computeDrift(baseline, current, "abc123", 0.15)
  expect(drift.hasRegressions).toBe(false)
  expect(drift.improvements).toHaveLength(1)
})

test("computeDrift returns no changes when scores are within threshold", () => {
  const baseline = [makeReport("rw-1", "ra-full", 0.8)]
  const current  = [makeReport("rw-1", "ra-full", 0.75)]
  const drift = computeDrift(baseline, current, "abc123", 0.15)
  expect(drift.hasRegressions).toBe(false)
  expect(drift.regressions).toHaveLength(0)
  expect(drift.improvements).toHaveLength(0)
})

test("exceedsThreshold returns true when maxRegressionDelta > threshold", () => {
  const baseline = [makeReport("rw-1", "ra-full", 0.9)]
  const current  = [makeReport("rw-1", "ra-full", 0.5)]
  const drift = computeDrift(baseline, current, "abc123", 0.15)
  expect(exceedsThreshold(drift, 0.2)).toBe(true)
})
