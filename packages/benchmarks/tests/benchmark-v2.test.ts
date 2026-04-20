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
