# Benchmark Suite v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `packages/benchmarks/` with multi-dimensional scoring, a 9-variant competitor ablation ladder, 10 real-world tasks, and 4 pre-built sessions that generate publishable evidence of harness quality across the full framework landscape.

**Architecture:** Purely additive — existing 26 tasks, `runBenchmarks()`, and CLI flags are untouched. The new `runSession()` API drives named sessions across internal and competitor variants, scores tasks on 10 quality dimensions, and produces a `SessionReport` that extends the existing `MultiModelReport`. Competitor runners implement a shared interface in `competitors/` and are dispatched identically to internal variants.

**Tech Stack:** Bun, TypeScript strict, Effect-TS v3, bun:test, ReactiveAgents builder API, `@langchain/langgraph` (LangChain), `ai` + `@ai-sdk/*` (Vercel AI SDK), `@openai/agents` (OpenAI), `@mastra/core` (Mastra), `llamaindex` (LlamaIndex TS)

---

## File Map

```
packages/benchmarks/
  src/
    types.ts                     ← EXTENDED — 15 new types, extend Tier + BenchmarkTask
    task-registry.ts             ← RENAMED from tasks.ts; no logic changes
    tasks/
      real-world.ts              ← NEW — 10 real-world tasks with fixtures + rubrics
    session.ts                   ← NEW — ABLATION_VARIANTS, BenchmarkSession utilities
    judge.ts                     ← NEW — scoreTask(), computeReliability(), scoreVerifiable()
    ci.ts                        ← NEW — DriftReport, saveBaseline(), checkDrift()
    runner.ts                    ← EXTENDED — runSession(), dispatch(), aggregation helpers
    run.ts                       ← EXTENDED — --session, --runs, --save-baseline, --ci flags
    sessions/
      regression-gate.ts         ← NEW
      real-world-full.ts         ← NEW
      competitor-comparison.ts   ← NEW
      local-models.ts            ← NEW
    competitors/
      types.ts                   ← NEW — CompetitorRunner interface + TaskRunResult
      langchain-runner.ts        ← NEW
      vercel-ai-runner.ts        ← NEW
      openai-agents-runner.ts    ← NEW
      mastra-runner.ts           ← NEW
      llamaindex-runner.ts       ← NEW
      index.ts                   ← NEW — COMPETITOR_RUNNERS registry
    index.ts                     ← EXTENDED — new exports
  tests/
    benchmarks.test.ts           ← UNCHANGED
    benchmark-v2.test.ts         ← NEW — unit tests for pure functions
```

---

## Task 1: Extend types.ts

**Files:**
- Modify: `packages/benchmarks/src/types.ts`
- Test: `packages/benchmarks/tests/benchmark-v2.test.ts`

- [ ] **Step 1.1: Write the failing type-import test**

Create `packages/benchmarks/tests/benchmark-v2.test.ts`:

```typescript
import { test, expect } from "bun:test"
import type {
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
  const task = {
    id: "rw-1", tier: "real-world" as const, name: "Test", prompt: "Do X",
    successCriteria: { type: "regex" as const, pattern: "ok" },
    primaryDimensions: ["accuracy" as const],
    fixtures: [{ path: "data.csv", content: "a,b\n1,2\n" }],
  }
  expect(task.tier).toBe("real-world")
})
```

- [ ] **Step 1.2: Run — expect TS import errors**

```bash
cd packages/benchmarks && bun test tests/benchmark-v2.test.ts 2>&1 | head -20
```

Expected: `Cannot find module` or type errors on missing exports.

- [ ] **Step 1.3: Replace Tier and extend BenchmarkTask in types.ts**

In `packages/benchmarks/src/types.ts`:

Replace line 7 (`export type Tier = ...`) with:
```typescript
export type Tier = "trivial" | "simple" | "moderate" | "complex" | "expert" | "real-world"
```

Add these optional fields to `BenchmarkTask` after the `maxIterations?` line:
```typescript
  readonly successCriteria?: SuccessCriteria
  readonly dimensionRubrics?: ReadonlyArray<DimensionRubric>
  readonly fixtures?: ReadonlyArray<TaskFixture>
  readonly optimalHarnessConfig?: HarnessConfig
  readonly primaryDimensions?: ReadonlyArray<QualityDimension>
  readonly domain?: string
  readonly tags?: ReadonlyArray<string>
```

- [ ] **Step 1.4: Append new v2 types to the bottom of types.ts**

```typescript
// ── v2: Multi-dimensional scoring + session types ─────────────────────────────

export type QualityDimension =
  | "accuracy"
  | "reasoning"
  | "tool-mastery"
  | "memory-fidelity"
  | "loop-intelligence"
  | "resilience"
  | "efficiency"
  | "reliability"
  | "scope-discipline"
  | "honest-uncertainty"

export interface DimensionScore {
  readonly dimension: QualityDimension
  readonly score: number
  readonly evidence?: string
}

export interface RunScore {
  readonly runIndex: number
  readonly dimensions: ReadonlyArray<DimensionScore>
  readonly tokensUsed: number
  readonly durationMs: number
  readonly status: "pass" | "fail" | "error"
  readonly output: string
  readonly traceId?: string
}

export interface TaskVariantReport {
  readonly taskId: string
  readonly modelVariantId: string
  readonly variantId: string
  readonly variantLabel: string
  readonly runs: ReadonlyArray<RunScore>
  readonly meanScores: ReadonlyArray<DimensionScore>
  readonly variance: number
  readonly meanTokens: number
  readonly meanDurationMs: number
  readonly passRate: number
}

export interface AblationResult {
  readonly taskId: string
  readonly taskName: string
  readonly modelVariantId: string
  readonly variants: ReadonlyArray<TaskVariantReport>
  readonly harnessLift: number
  readonly perDimensionLift: ReadonlyArray<{ dimension: QualityDimension; lift: number }>
  readonly bestVariantId: string
  readonly baselineVariantId: string
}

export interface SessionReport extends MultiModelReport {
  readonly sessionId: string
  readonly sessionVersion: string
  readonly gitSha: string
  readonly ablation?: ReadonlyArray<AblationResult>
  readonly dimensionSummary?: ReadonlyArray<{
    dimension: QualityDimension
    byVariant: ReadonlyArray<{ variantId: string; meanScore: number }>
  }>
  readonly drift?: DriftReport
}

export interface DriftReport {
  readonly baselineGitSha: string
  readonly regressions: ReadonlyArray<{
    taskId: string; variantId: string; dimension: QualityDimension
    baselineScore: number; currentScore: number; delta: number
  }>
  readonly improvements: ReadonlyArray<{
    taskId: string; variantId: string; dimension: QualityDimension
    baselineScore: number; currentScore: number; delta: number
  }>
  readonly hasRegressions: boolean
  readonly maxRegressionDelta: number
}

export interface HarnessConfig {
  readonly tools?: boolean
  readonly reasoning?: boolean
  readonly reactiveIntelligence?: boolean
  readonly adaptiveContext?: boolean
  readonly memory?: boolean
  readonly guardrails?: boolean
  readonly strategy?: "react" | "plan-execute" | "tree-of-thought" | "adaptive"
}

export interface InternalVariant {
  readonly type: "internal"
  readonly id: string
  readonly label: string
  readonly config: HarnessConfig
}

export interface CompetitorVariant {
  readonly type: "competitor"
  readonly id: string
  readonly label: string
  readonly framework: "langchain" | "vercel-ai" | "openai-agents" | "mastra" | "llamaindex"
  readonly frameworkVersion?: string
  readonly frameworkConfig?: Record<string, unknown>
}

export type HarnessVariant = InternalVariant | CompetitorVariant

export interface ModelVariant {
  readonly id: string
  readonly provider: "anthropic" | "openai" | "gemini" | "ollama" | "litellm"
  readonly model: string
  readonly contextTier?: "local" | "standard" | "large" | "frontier"
}

export interface BenchmarkSession {
  readonly id: string
  readonly name: string
  readonly version: string
  readonly taskIds?: ReadonlyArray<string>
  readonly tiers?: ReadonlyArray<Tier>
  readonly tags?: ReadonlyArray<string>
  readonly models: ReadonlyArray<ModelVariant>
  readonly harnessVariants: ReadonlyArray<HarnessVariant>
  readonly runs?: number
  readonly traceDir?: string
  readonly concurrency?: number
  readonly timeoutMs?: number
}

export interface DimensionRubric {
  readonly dimension: QualityDimension
  readonly rubric: string
  readonly weight?: number
}

export interface TaskFixture {
  readonly path: string
  readonly content: string
}

export type SuccessCriteria =
  | { readonly type: "regex"; readonly pattern: string }
  | { readonly type: "verifiable"; readonly command: string; readonly partialCredit?: boolean }
  | { readonly type: "llm-judge"; readonly rubric: string; readonly passThreshold?: number }
  | { readonly type: "schema"; readonly schema: Record<string, unknown> }

/** Raw result from running a task — used by both internal and competitor runners. */
export interface TaskRunResult {
  readonly output: string
  readonly tokensUsed: number
  readonly durationMs: number
  readonly iterations: number
  readonly status: "pass" | "fail" | "error"
  readonly error?: string
  readonly traceId?: string
}
```

- [ ] **Step 1.5: Run test — expect 4 pass**

```bash
cd packages/benchmarks && bun test tests/benchmark-v2.test.ts
```

Expected: 4 pass, 0 fail.

- [ ] **Step 1.6: Typecheck**

```bash
cd packages/benchmarks && bun run typecheck
```

Expected: no errors.

- [ ] **Step 1.7: Commit**

```bash
rtk git add packages/benchmarks/src/types.ts packages/benchmarks/tests/benchmark-v2.test.ts
rtk git commit -m "feat(benchmarks): extend types.ts with v2 multi-dimensional scoring types"
```

---

## Task 2: Rename tasks.ts → task-registry.ts

**Files:**
- Rename: `packages/benchmarks/src/tasks.ts` → `packages/benchmarks/src/task-registry.ts`
- Modify: `packages/benchmarks/src/runner.ts` line 9
- Modify: `packages/benchmarks/src/index.ts` line 10

- [ ] **Step 2.1: Add backward-compat test**

Append to `packages/benchmarks/tests/benchmark-v2.test.ts`:

```typescript
import { BENCHMARK_TASKS, getTasksByTier } from "../src/task-registry.js"

test("task-registry exports BENCHMARK_TASKS with 26 tasks", () => {
  expect(BENCHMARK_TASKS.length).toBe(26)
})

test("getTasksByTier returns only tasks of that tier", () => {
  const trivial = getTasksByTier("trivial")
  expect(trivial.every(t => t.tier === "trivial")).toBe(true)
  expect(trivial.length).toBeGreaterThan(0)
})
```

- [ ] **Step 2.2: Run — expect import failure**

```bash
cd packages/benchmarks && bun test tests/benchmark-v2.test.ts 2>&1 | grep -i "cannot find\|error"
```

Expected: `Cannot find module '../src/task-registry.js'`

- [ ] **Step 2.3: Rename file**

```bash
cd packages/benchmarks && mv src/tasks.ts src/task-registry.ts
```

- [ ] **Step 2.4: Update runner.ts import (line 9)**

Change:
```typescript
import { BENCHMARK_TASKS } from "./tasks.js";
```
To:
```typescript
import { BENCHMARK_TASKS } from "./task-registry.js";
```

- [ ] **Step 2.5: Update index.ts export (line 10)**

Change:
```typescript
export { BENCHMARK_TASKS, getTasksByTier } from "./tasks.js";
```
To:
```typescript
export { BENCHMARK_TASKS, getTasksByTier } from "./task-registry.js";
```

- [ ] **Step 2.6: Run test — expect 6 pass**

```bash
cd packages/benchmarks && bun test tests/benchmark-v2.test.ts
```

Expected: 6 pass, 0 fail.

- [ ] **Step 2.7: Run full test suite — confirm unchanged**

```bash
cd packages/benchmarks && bun test
```

Expected: same pass count as before this task.

- [ ] **Step 2.8: Commit**

```bash
rtk git add packages/benchmarks/src/task-registry.ts packages/benchmarks/src/runner.ts packages/benchmarks/src/index.ts
rtk git commit -m "refactor(benchmarks): rename tasks.ts to task-registry.ts"
```

---

## Task 3: Create tasks/real-world.ts

**Files:**
- Create: `packages/benchmarks/src/tasks/real-world.ts`
- Test: `packages/benchmarks/tests/benchmark-v2.test.ts` (append)

- [ ] **Step 3.1: Write failing test**

Append to `packages/benchmarks/tests/benchmark-v2.test.ts`:

```typescript
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
```

- [ ] **Step 3.2: Run — expect import failure**

```bash
cd packages/benchmarks && bun test tests/benchmark-v2.test.ts 2>&1 | grep -i "cannot find"
```

- [ ] **Step 3.3: Create src/tasks/ directory and real-world.ts**

Create `packages/benchmarks/src/tasks/real-world.ts`:

```typescript
import type { BenchmarkTask } from "../types.js"

// ── Fixture generators ────────────────────────────────────────────────────────

function generateSalesData(): string {
  const header = "date,order_id,sku,qty,unit_price,discount_pct,net_revenue"
  const rows: string[] = [header]
  let id = 1
  const pad = (n: number) => String(n).padStart(4, "0")

  const skus = [
    { sku: "APPL-IPAD-AIR", price: 329.99 },
    { sku: "FURN-CHAIR-ERG", price: 299.99 },
    { sku: "CLTH-JACKET-L", price: 89.99 },
    { sku: "BOOK-DESIGN-01", price: 34.99 },
  ]
  const tv = { sku: "ELEC-4K-TV-001", price: 849.99 }

  // Day 1 — 2025-03-10: 15 orders, TV appears 8 times (spread through day), no discount
  const tvSlots1 = new Set([1, 2, 4, 6, 8, 10, 12, 14])
  for (let i = 1; i <= 15; i++) {
    const item = tvSlots1.has(i) ? tv : skus[(i % skus.length)]!
    const rev = (item.price).toFixed(2)
    rows.push(`2025-03-10,ORD-${pad(id++)},${item.sku},1,${item.price.toFixed(2)},0.00,${rev}`)
  }

  // Day 2 — 2025-03-11: 15 orders, 15% discount on ALL, TV out of stock after order 3
  // Red herring: discount is visible. Primary cause: TV went OOS.
  for (let i = 1; i <= 15; i++) {
    const useTv = i <= 3  // TV only in first 3 morning orders, then OOS
    const item = useTv ? tv : skus[(i % skus.length)]!
    const disc = 0.15
    const rev = (item.price * (1 - disc)).toFixed(2)
    rows.push(`2025-03-11,ORD-${pad(id++)},${item.sku},1,${item.price.toFixed(2)},0.15,${rev}`)
  }

  // Day 3 — 2025-03-12: 15 orders, TV restocked, no discount (recovery)
  const tvSlots3 = new Set([1, 3, 5, 8, 11, 13])
  for (let i = 1; i <= 15; i++) {
    const item = tvSlots3.has(i) ? tv : skus[(i % skus.length)]!
    const rev = (item.price).toFixed(2)
    rows.push(`2025-03-12,ORD-${pad(id++)},${item.sku},1,${item.price.toFixed(2)},0.00,${rev}`)
  }

  return rows.join("\n")
}

function generateEmployeeData(): string {
  const header = "employee_id,name,department,title,salary,tenure_years,performance_score"
  const rows: string[] = [header]

  const depts = [
    // Engineering: 15 people, high salary (~$140k avg), below-avg performance (~2.8)
    ...Array.from({ length: 15 }, (_, i) => ({
      dept: "Engineering",
      title: i < 5 ? "Senior Engineer" : i < 11 ? "Engineer II" : "Engineer I",
      salary: 120000 + Math.round(i * 2800 + (i % 3) * 5000),
      tenure: 1 + (i % 6),
      perf: (2.4 + (i % 5) * 0.14).toFixed(1),
    })),
    // Product: 10 people, medium salary (~$110k), good performance (~3.9)
    ...Array.from({ length: 10 }, (_, i) => ({
      dept: "Product",
      title: i < 3 ? "Senior PM" : "Product Manager",
      salary: 95000 + Math.round(i * 3200),
      tenure: 2 + (i % 5),
      perf: (3.6 + (i % 4) * 0.12).toFixed(1),
    })),
    // Sales: 15 people, lower salary (~$80k), high performance (~4.1)
    ...Array.from({ length: 15 }, (_, i) => ({
      dept: "Sales",
      title: i < 4 ? "Senior AE" : "Account Executive",
      salary: 68000 + Math.round(i * 1600),
      tenure: 1 + (i % 7),
      perf: (3.8 + (i % 4) * 0.12).toFixed(1),
    })),
    // Operations: 10 people, lowest salary (~$65k), good performance (~3.7)
    ...Array.from({ length: 10 }, (_, i) => ({
      dept: "Operations",
      title: i < 3 ? "Senior Ops" : "Operations Analyst",
      salary: 58000 + Math.round(i * 1800),
      tenure: 2 + (i % 8),
      perf: (3.4 + (i % 5) * 0.12).toFixed(1),
    })),
  ]

  const firstNames = ["Alex","Jordan","Taylor","Morgan","Casey","Riley","Jamie","Drew","Avery","Quinn",
                      "Blake","Cameron","Sage","Reese","Parker","Finley","Hayden","Rowan","Kendall","Skylar"]
  const lastNames  = ["Chen","Kim","Patel","Garcia","Johnson","Williams","Brown","Davis","Miller","Wilson"]

  depts.forEach((e, i) => {
    const name = `${firstNames[i % firstNames.length]} ${lastNames[i % lastNames.length]}`
    rows.push(`EMP-${String(i + 1).padStart(3,"0")},${name},${e.dept},${e.title},${e.salary},${e.tenure},${e.perf}`)
  })

  return rows.join("\n")
}

function generateSchemaSQL(): string {
  return `-- e-commerce schema (8 tables)
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE addresses (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  line1 VARCHAR(255), city VARCHAR(100), country VARCHAR(2)
);

CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  sku VARCHAR(64) UNIQUE NOT NULL,
  name VARCHAR(255),
  price_cents INT NOT NULL,
  inventory_count INT DEFAULT 0
);

CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  address_id INT REFERENCES addresses(id),
  status VARCHAR(32) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE line_items (
  id SERIAL PRIMARY KEY,
  order_id INT REFERENCES orders(id),
  product_id INT REFERENCES products(id),
  quantity INT NOT NULL,
  unit_price_cents INT NOT NULL
);

CREATE TABLE payments (
  id SERIAL PRIMARY KEY,
  order_id INT REFERENCES orders(id),
  amount_cents INT NOT NULL,
  status VARCHAR(32),
  processed_at TIMESTAMPTZ
);

CREATE TABLE reviews (
  id SERIAL PRIMARY KEY,
  product_id INT REFERENCES products(id),
  user_id INT REFERENCES users(id),
  rating INT CHECK (rating BETWEEN 1 AND 5),
  body TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE inventory (
  id SERIAL PRIMARY KEY,
  product_id INT REFERENCES products(id) UNIQUE,
  reserved_count INT DEFAULT 0,
  last_updated TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_orders_user ON orders(user_id);
CREATE INDEX idx_line_items_order ON line_items(order_id);
CREATE INDEX idx_payments_order ON payments(order_id);
`
}

function generateSortTS(): string {
  return `// Merge sort — clean O(n log n) implementation
export function mergeSort(arr: readonly number[]): number[] {
  if (arr.length <= 1) return [...arr]
  const mid = Math.floor(arr.length / 2)
  return merge(mergeSort(arr.slice(0, mid)), mergeSort(arr.slice(mid)))
}

function merge(left: number[], right: number[]): number[] {
  const result: number[] = []
  let l = 0, r = 0
  while (l < left.length && r < right.length) {
    result.push(left[l]! <= right[r]! ? left[l++]! : right[r++]!)
  }
  return result.concat(left.slice(l), right.slice(r))
}
`
}

function generateValidatorBug(): string {
  return `// validator.ts
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
    // BUG: !obj[field] rejects falsy-but-valid values (0, "", false)
    // Fix: use !(field in obj) || obj[field] === undefined
    if (!obj[field]) {
      errors.push(\`Missing required field: \${field}\`)
    }
  }
  return { valid: errors.length === 0, errors }
}
`
}

function generateProcessorBug(): string {
  return `// processor.ts
export function filterLargeList<T>(items: T[], predicate: (item: T) => boolean): T[] {
  // BUG: off-by-one — should be >= 10, not > 10
  // Arrays of exactly 10 items skip the filter and return all items unfiltered
  if (items.length > 10) {
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
}

function generatePipelineBug(): string {
  return `// pipeline.ts
export type PipelineState = { count: number; results: string[] }

async function processFirst(state: PipelineState): Promise<string> {
  // Simulates async work that reads and modifies state.count
  await new Promise(r => setTimeout(r, 1))
  state.count += 1
  return \`first-\${state.count}\`
}

async function processSecond(state: PipelineState): Promise<string> {
  // BUG: reads state.count before processFirst increments it when run concurrently
  await new Promise(r => setTimeout(r, 1))
  return \`second-\${state.count}\`
}

export async function runPipeline(state: PipelineState): Promise<string[]> {
  // BUG: Promise.all runs both concurrently — processSecond sees stale state.count
  // Fix: run sequentially: const r1 = await processFirst(state); const r2 = await processSecond(state)
  const [r1, r2] = await Promise.all([processFirst(state), processSecond(state)])
  return [r1, r2]
}
`
}

function generateFallbackPrices(): string {
  return JSON.stringify({
    note: "Static fallback snapshot — use when live API is unavailable",
    timestamp: "2025-03-11T12:00:00Z",
    prices: {
      bitcoin:  { usd: 68450.21, usd_24h_change: 2.34, usd_market_cap: 1_347_000_000_000 },
      ethereum: { usd: 3512.88,  usd_24h_change: -0.87, usd_market_cap: 422_000_000_000 },
      solana:   { usd: 172.44,   usd_24h_change: 4.12,  usd_market_cap: 79_000_000_000 },
    },
  }, null, 2)
}

// ── Real-world task definitions ───────────────────────────────────────────────

export const REAL_WORLD_TASKS: readonly BenchmarkTask[] = [
  {
    id: "rw-1",
    tier: "real-world",
    name: "Research synthesis with source conflict",
    domain: "research",
    strategy: "plan-execute",
    prompt: `Research the top 3 embedded or edge-deployable vector databases with TypeScript support available in 2025. For each provide: name, license, WASM or browser support (yes/no), approximate query latency at 100k vectors, and a one-sentence verdict.

Note: some sources you find may have conflicting benchmark data for the same database. Where you find a conflict, identify it explicitly and explain how you resolved it or why you cannot resolve it. Output the final answer as a JSON array. Use only databases you can verify actually exist.`,
    requiresTools: true,
    maxIterations: 20,
    successCriteria: {
      type: "llm-judge",
      rubric: "Score 1.0 if: (1) exactly 3 databases named that actually exist, (2) each has a real license identifier, (3) at least one data conflict is explicitly identified, (4) output is a valid JSON array. Score 0.0 if any database is fabricated.",
      passThreshold: 0.6,
    },
    primaryDimensions: ["accuracy", "reasoning", "honest-uncertainty"],
    dimensionRubrics: [
      {
        dimension: "accuracy",
        rubric: "Are all 3 databases real? Are the licenses correct? Is the JSON array valid and parseable? Deduct heavily for any fabricated database or invented license.",
      },
      {
        dimension: "reasoning",
        rubric: "Did the agent form a search plan before executing? Does it synthesize across sources rather than copy-pasting? Does it handle contradictions analytically?",
      },
      {
        dimension: "honest-uncertainty",
        rubric: "Does the agent explicitly flag conflicting data rather than silently picking one source? Does it acknowledge when a latency figure is an estimate?",
      },
    ],
    optimalHarnessConfig: { tools: true, reasoning: true, memory: true, adaptiveContext: true, strategy: "plan-execute" },
    tags: ["research", "web-search", "json-output"],
  },

  {
    id: "rw-2",
    tier: "real-world",
    name: "Data investigation with red herring",
    domain: "analysis",
    strategy: "react",
    prompt: `Analyze the attached sales data in sales-data.csv. Identify what caused the revenue drop on day 2 (2025-03-11) compared to day 1 (2025-03-10). Name the specific primary cause, quantify the dollar impact, and recommend one concrete fix.`,
    requiresTools: true,
    maxIterations: 15,
    fixtures: [{ path: "sales-data.csv", content: generateSalesData() }],
    successCriteria: {
      type: "llm-judge",
      rubric: "Score 1.0 if: primary cause is ELEC-4K-TV-001 going out of stock, dollar impact is quantified, recommendation targets restocking. Score 0.2 if agent only identifies the discount without examining SKU-level data. Score 0.0 if agent fabricates data.",
      passThreshold: 0.6,
    },
    primaryDimensions: ["reasoning", "accuracy", "loop-intelligence"],
    dimensionRubrics: [
      {
        dimension: "reasoning",
        rubric: "Does the agent form multiple hypotheses (discount, OOS, other) and systematically eliminate them? Does it pivot when the discount hypothesis proves insufficient to explain the full drop?",
      },
      {
        dimension: "accuracy",
        rubric: "Is ELEC-4K-TV-001 out-of-stock correctly identified as the primary cause? Is the revenue impact quantified (even approximately)? Is the recommendation concrete?",
      },
      {
        dimension: "loop-intelligence",
        rubric: "Does the agent converge efficiently? Does it avoid re-running the same analysis after it has already ruled out a hypothesis?",
      },
    ],
    optimalHarnessConfig: { tools: true, reasoning: true, reactiveIntelligence: true, strategy: "react" },
    tags: ["data-analysis", "csv", "red-herring"],
  },

  {
    id: "rw-3",
    tier: "real-world",
    name: "Open-ended analysis, no recipe",
    domain: "automation",
    strategy: "plan-execute",
    prompt: `Analyze employees.csv and write a report to report.md surfacing whatever you think is most actionable for leadership. Show your reasoning.`,
    requiresTools: true,
    maxIterations: 15,
    fixtures: [{ path: "employees.csv", content: generateEmployeeData() }],
    successCriteria: {
      type: "llm-judge",
      rubric: "Score 1.0 if: report.md is written, contains a data table, surfaces the Engineering salary/performance outlier, gives a concrete recommendation grounded in data. Score 0.0 if report only describes data without identifying the actionable finding.",
      passThreshold: 0.6,
    },
    primaryDimensions: ["accuracy", "scope-discipline", "reasoning"],
    dimensionRubrics: [
      {
        dimension: "scope-discipline",
        rubric: "Is the report focused and actionable without scope creep? Does it avoid over-engineering (statistical tests, charts) when a table and paragraph suffice? Is it proportional to the brief?",
      },
      {
        dimension: "reasoning",
        rubric: "Does the analysis logic lead correctly from data to recommendation? Are the numbers accurate? Is the Engineering outlier finding justified by the data?",
      },
      {
        dimension: "accuracy",
        rubric: "Is the Engineering salary premium correctly quantified (approximately 40% above company average)? Are performance scores correctly compared?",
      },
    ],
    optimalHarnessConfig: { tools: true, reasoning: true, reactiveIntelligence: true, strategy: "plan-execute" },
    tags: ["data-analysis", "csv", "report-writing"],
  },

  {
    id: "rw-4",
    tier: "real-world",
    name: "API integration with type safety",
    domain: "execution",
    strategy: "react",
    prompt: `Using the JSONPlaceholder API at https://jsonplaceholder.typicode.com, fetch all posts by user ID 3, enrich each post with its comment count, and write a TypeScript module to output.ts that exports a typed EnrichedPost[] array as a const. The module must compile without errors.`,
    requiresTools: true,
    maxIterations: 15,
    successCriteria: {
      type: "verifiable",
      command: "bun check output.ts",
    },
    primaryDimensions: ["tool-mastery", "accuracy", "efficiency"],
    dimensionRubrics: [
      {
        dimension: "tool-mastery",
        rubric: "Did the agent use http-get correctly to fetch both posts and comments? Did it avoid redundant API calls (e.g., fetching comments it already retrieved)?",
      },
      {
        dimension: "accuracy",
        rubric: "Does the TypeScript type correctly model the API response? Does output.ts compile? Is the EnrichedPost type correct and complete?",
      },
      {
        dimension: "efficiency",
        rubric: "How many http-get calls were made relative to the theoretical minimum (1 for posts + 1 per post for comments, or batched)? Flag anything above 2× the minimum.",
      },
    ],
    optimalHarnessConfig: { tools: true, reasoning: true, adaptiveContext: true, strategy: "react" },
    tags: ["http", "typescript", "api-integration"],
  },

  {
    id: "rw-5",
    tier: "real-world",
    name: "Zero-downtime migration plan",
    domain: "planning",
    strategy: "tree-of-thought",
    prompt: `Given the attached PostgreSQL schema in schema.sql, design a migration to support multi-tenancy via row-level security. The migration must be executable with zero downtime on a live database. Produce: (1) 5 specific risks with mitigations, (2) the complete ALTER TABLE and CREATE POLICY SQL statements in execution order, (3) a downtime estimate with justification.`,
    requiresTools: true,
    maxIterations: 20,
    fixtures: [{ path: "schema.sql", content: generateSchemaSQL() }],
    successCriteria: {
      type: "llm-judge",
      rubric: "Score 1.0 if: SQL contains valid CREATE POLICY and ALTER TABLE statements, 5 schema-specific risks are listed (not generic advice), downtime estimate is justified with specific operations cited, zero-downtime approach uses a recognized pattern (shadow table, online DDL, etc.). Score 0.0 if SQL is syntactically invalid or risks are generic.",
      passThreshold: 0.6,
    },
    primaryDimensions: ["reasoning", "memory-fidelity", "accuracy"],
    dimensionRubrics: [
      {
        dimension: "reasoning",
        rubric: "Does the agent explore multiple migration approaches before settling? Does it identify real conflicts in the schema (e.g., shared sequences, FK constraints, the inventory unique constraint) rather than generic risks?",
      },
      {
        dimension: "memory-fidelity",
        rubric: "Is the zero-downtime constraint maintained consistently throughout ALL SQL statements, not just mentioned in the introduction? Check for any DDL that would take an exclusive lock.",
      },
      {
        dimension: "accuracy",
        rubric: "Are the SQL statements syntactically valid? Are the CREATE POLICY statements correct for PostgreSQL RLS syntax? Are the 5 risks specific to the 8-table schema provided?",
      },
    ],
    optimalHarnessConfig: { tools: true, reasoning: true, reactiveIntelligence: true, adaptiveContext: true, memory: true, strategy: "tree-of-thought" },
    tags: ["sql", "postgresql", "planning"],
  },

  {
    id: "rw-6",
    tier: "real-world",
    name: "Adversarial convergence — nothing to optimize",
    domain: "adversarial",
    strategy: "react",
    prompt: `Profile and optimize the attached sorting implementation in sort.ts for maximum performance. Provide specific improvements with before/after benchmarks.`,
    requiresTools: true,
    maxIterations: 15,
    fixtures: [{ path: "sort.ts", content: generateSortTS() }],
    successCriteria: {
      type: "llm-judge",
      rubric: "INVERTED: Score 1.0 if agent correctly identifies the algorithm is already O(n log n), explains why further optimization yields diminishing returns, and stops without rewriting working code. Score 0.0 if agent invents fake bottlenecks, rewrites unnecessarily, or fabricates benchmark numbers.",
      passThreshold: 0.6,
    },
    primaryDimensions: ["loop-intelligence", "honest-uncertainty", "efficiency"],
    dimensionRubrics: [
      {
        dimension: "loop-intelligence",
        rubric: "Does the agent stop after one or two analytical passes? Does it avoid running the same profiling code repeatedly after having already characterized the algorithm?",
      },
      {
        dimension: "honest-uncertainty",
        rubric: "Does the agent explicitly state no meaningful optimization exists and explain why (O(n log n) is optimal for comparison sorts), rather than hedging or inventing minor micro-optimizations?",
      },
      {
        dimension: "efficiency",
        rubric: "Does the agent reach the correct conclusion (nothing to optimize) in minimal iterations, or does it waste iterations running benchmarks that don't change the conclusion?",
      },
    ],
    optimalHarnessConfig: { tools: true, reasoning: true, reactiveIntelligence: true, strategy: "react" },
    tags: ["adversarial", "convergence", "early-stop"],
  },

  {
    id: "rw-7",
    tier: "real-world",
    name: "Multi-file debug, no test suite",
    domain: "execution",
    strategy: "react",
    prompt: `The TypeScript package in src/ has bugs. No test suite is provided. Write tests to find the bugs, fix all of them, and verify your tests pass. Do not stop until \`bun test\` exits 0.`,
    requiresTools: true,
    maxIterations: 25,
    fixtures: [
      { path: "src/validator.ts",  content: generateValidatorBug() },
      { path: "src/processor.ts",  content: generateProcessorBug() },
      { path: "src/pipeline.ts",   content: generatePipelineBug() },
      { path: "package.json",      content: JSON.stringify({ name: "buggy-pkg", type: "module", devDependencies: { "bun-types": "latest" } }, null, 2) },
      { path: "tsconfig.json",     content: JSON.stringify({ compilerOptions: { strict: true, module: "ESNext", moduleResolution: "bundler", target: "ES2022" } }, null, 2) },
    ],
    successCriteria: {
      type: "verifiable",
      command: "bun test",
      partialCredit: true,
    },
    primaryDimensions: ["tool-mastery", "resilience", "accuracy"],
    dimensionRubrics: [
      {
        dimension: "tool-mastery",
        rubric: "Does the agent use code-execute to discover failures rather than guessing? Does it avoid rerunning tests it already knows the result of?",
      },
      {
        dimension: "resilience",
        rubric: "When a fix attempt doesn't fully resolve a bug, does the agent adapt its approach rather than repeating the same fix? Does it handle the race condition bug (which requires understanding async semantics)?",
      },
      {
        dimension: "accuracy",
        rubric: "Are all 3 bugs found and fixed? Does the validator bug fix correctly handle falsy-but-valid values? Is the off-by-one fixed to >= 10? Is the race condition fixed to sequential awaits?",
      },
    ],
    optimalHarnessConfig: { tools: true, reasoning: true, reactiveIntelligence: true, adaptiveContext: true, strategy: "react" },
    tags: ["debugging", "typescript", "test-writing"],
  },

  {
    id: "rw-8",
    tier: "real-world",
    name: "Memory under compaction pressure",
    domain: "memory",
    strategy: "plan-execute",
    prompt: `You are building a data processing pipeline in 5 phases. Phase 1 establishes the constraints that all subsequent phases must satisfy. Complete all 5 phases in order.

PHASE 1 CONSTRAINT (remember this for all phases):
- All monetary values must use integer cents, never floating-point dollars
- All timestamps must be Unix epoch milliseconds, never ISO strings
- All IDs must be prefixed with the entity type: "user_", "order_", "product_"

Now complete the following phases using these constraints:
Phase 2: Write a TypeScript type definition file (types.ts) for User, Order, Product
Phase 3: Write a data generator (generate.ts) that creates 5 sample records of each type
Phase 4: Write a validator (validate.ts) that checks all constraints are met
Phase 5: Run the validator against the generated data and report results`,
    requiresTools: true,
    maxIterations: 25,
    successCriteria: {
      type: "verifiable",
      command: "bun run generate.ts && bun run validate.ts",
    },
    primaryDimensions: ["memory-fidelity", "reliability", "accuracy"],
    dimensionRubrics: [
      {
        dimension: "memory-fidelity",
        rubric: "Do ALL generated files consistently use integer cents (not dollars), epoch milliseconds (not ISO strings), and prefixed IDs? Any violation in any phase indicates memory loss of the Phase 1 constraint. Check types.ts, generate.ts, and validate.ts independently.",
      },
      {
        dimension: "reliability",
        rubric: "Does the agent complete all 5 phases without drifting on the constraints? Does later work contradict earlier work?",
      },
      {
        dimension: "accuracy",
        rubric: "Does the validator correctly detect constraint violations? Do the type definitions correctly model the constraints? Does the pipeline run end-to-end without errors?",
      },
    ],
    optimalHarnessConfig: { tools: true, reasoning: true, adaptiveContext: true, memory: true, strategy: "plan-execute" },
    tags: ["memory", "multi-phase", "typescript"],
  },

  {
    id: "rw-9",
    tier: "real-world",
    name: "Resilience under tool failure",
    domain: "resilience",
    strategy: "react",
    prompt: `Fetch today's cryptocurrency prices for BTC, ETH, and SOL from the price API at INJECT_MOCK_URL and write a summary to prices.md with current price, 24h change, and market cap. If the API is unavailable, check whether a fallback-prices.json file exists in your working directory.`,
    requiresTools: true,
    maxIterations: 15,
    fixtures: [{ path: "fallback-prices.json", content: generateFallbackPrices() }],
    successCriteria: {
      type: "llm-judge",
      rubric: "Score 1.0 if prices.md exists with prices for BTC, ETH, and SOL including a 24h change figure. Accepts either live or clearly-labeled fallback data. Score 0.0 if prices.md is missing or incomplete.",
      passThreshold: 0.6,
    },
    primaryDimensions: ["resilience", "tool-mastery", "accuracy"],
    dimensionRubrics: [
      {
        dimension: "resilience",
        rubric: "Does the agent retry after receiving HTTP 503? Does it discover and use the fallback-prices.json file when retries fail? Does it complete the task despite the injected failures?",
      },
      {
        dimension: "tool-mastery",
        rubric: "Does the agent correctly interpret 503 as a transient error warranting retry? Does it correctly parse the fallback JSON structure?",
      },
      {
        dimension: "accuracy",
        rubric: "Does prices.md contain correct structure with all 3 assets (BTC, ETH, SOL) and a 24h change value for each?",
      },
    ],
    optimalHarnessConfig: { tools: true, reasoning: true, reactiveIntelligence: true, strategy: "react" },
    tags: ["resilience", "http", "fallback"],
  },

  {
    id: "rw-10",
    tier: "real-world",
    name: "Ambiguous requirements — scope under pressure",
    domain: "adversarial",
    strategy: "react",
    prompt: `Our user onboarding is underperforming. Improve it.

Here is everything we have: users sign up, confirm email, and are shown a dashboard. Drop-off is 40% between signup and dashboard. Fix this.`,
    requiresTools: true,
    maxIterations: 10,
    successCriteria: {
      type: "llm-judge",
      rubric: "Score 1.0 if agent either (A) explicitly states 2+ assumptions it must make due to missing context before proceeding, OR (B) asks targeted clarifying questions AND produces a deliverable scoped to the information provided. Score 0.0 if agent invents specific metrics, A/B test results, or user research it was not given, or produces a comprehensive strategy for a 2-sentence brief.",
      passThreshold: 0.6,
    },
    primaryDimensions: ["honest-uncertainty", "scope-discipline", "reasoning"],
    dimensionRubrics: [
      {
        dimension: "honest-uncertainty",
        rubric: "Does the agent acknowledge what it doesn't know (stack, platform, user type, actual drop-off reason) rather than assuming? Does it avoid inventing specific numbers or research?",
      },
      {
        dimension: "scope-discipline",
        rubric: "Is the output proportional to the information provided? Does it resist over-delivering with comprehensive strategy docs, user research frameworks, or A/B test plans that require data never provided?",
      },
      {
        dimension: "reasoning",
        rubric: "If the agent makes assumptions, are they reasonable and explicitly stated? Does its recommendation follow logically from what is actually known?",
      },
    ],
    optimalHarnessConfig: { tools: true, reasoning: true, reactiveIntelligence: true, strategy: "react" },
    tags: ["adversarial", "scope", "ambiguity"],
  },
]
```

- [ ] **Step 3.4: Run test — expect 10 pass**

```bash
cd packages/benchmarks && bun test tests/benchmark-v2.test.ts
```

Expected: 10 pass, 0 fail.

- [ ] **Step 3.5: Typecheck**

```bash
cd packages/benchmarks && bun run typecheck
```

Expected: no errors.

- [ ] **Step 3.6: Commit**

```bash
rtk git add packages/benchmarks/src/tasks/real-world.ts packages/benchmarks/tests/benchmark-v2.test.ts
rtk git commit -m "feat(benchmarks): add 10 real-world tasks with fixture generators"
```

---

## Task 4: Create session.ts

**Files:**
- Create: `packages/benchmarks/src/session.ts`
- Test: `packages/benchmarks/tests/benchmark-v2.test.ts` (append)

- [ ] **Step 4.1: Write failing tests**

Append to `packages/benchmarks/tests/benchmark-v2.test.ts`:

```typescript
import { ABLATION_VARIANTS, resolveTasks, mergeConfigs } from "../src/session.js"
import { REAL_WORLD_TASKS } from "../src/tasks/real-world.js"
import { BENCHMARK_TASKS } from "../src/task-registry.js"

test("ABLATION_VARIANTS has exactly 9 variants", () => {
  expect(ABLATION_VARIANTS).toHaveLength(9)
})

test("ABLATION_VARIANTS has 2 internal tier-0/1, 5 competitor tier-2, 2 internal tier-3", () => {
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
```

- [ ] **Step 4.2: Run — expect import failure**

```bash
cd packages/benchmarks && bun test tests/benchmark-v2.test.ts 2>&1 | grep -i "cannot find"
```

- [ ] **Step 4.3: Create session.ts**

Create `packages/benchmarks/src/session.ts`:

```typescript
import type {
  HarnessVariant, BenchmarkSession, BenchmarkTask, HarnessConfig, Tier,
} from "./types.js"

// ── 9-variant ablation ladder ─────────────────────────────────────────────────
// Three tiers: universal baseline → established frameworks → RA harness

export const ABLATION_VARIANTS: ReadonlyArray<HarnessVariant> = [
  // Tier 0: Universal baseline — single API call, no tools, no loop
  { type: "internal", id: "bare-llm",     label: "Bare LLM",          config: {} },

  // Tier 1: Build-it-yourself — raw SDK + while loop + native FC
  { type: "internal", id: "manual-react", label: "Manual ReAct Loop",  config: { tools: true } },

  // Tier 2: Established frameworks (pinned versions, see competitors/)
  { type: "competitor", id: "langchain-react", label: "LangChain JS",       framework: "langchain",      frameworkVersion: "0.3.x" },
  { type: "competitor", id: "vercel-ai-sdk",   label: "Vercel AI SDK",      framework: "vercel-ai",      frameworkVersion: "4.x" },
  { type: "competitor", id: "openai-agents",   label: "OpenAI Agents SDK",  framework: "openai-agents",  frameworkVersion: "0.x" },
  { type: "competitor", id: "mastra-agent",    label: "Mastra",             framework: "mastra",         frameworkVersion: "0.x" },
  { type: "competitor", id: "llamaindex-ts",   label: "LlamaIndex TS",      framework: "llamaindex",     frameworkVersion: "0.x" },

  // Tier 3: RA harness layers
  {
    type: "internal", id: "ra-reasoning", label: "RA Reasoning",
    config: { tools: true, reasoning: true, adaptiveContext: true },
  },
  {
    type: "internal", id: "ra-full", label: "RA Full Harness",
    config: { tools: true, reasoning: true, reactiveIntelligence: true, adaptiveContext: true, memory: true },
  },
]

// ── Session utilities ─────────────────────────────────────────────────────────

/**
 * Resolve which tasks a session should run.
 * Priority: taskIds > tiers > tags > all tasks.
 */
export function resolveTasks(
  session: Pick<BenchmarkSession, "taskIds" | "tiers" | "tags">,
  allTasks: readonly BenchmarkTask[],
): readonly BenchmarkTask[] {
  if (session.taskIds?.length) {
    return allTasks.filter(t => session.taskIds!.includes(t.id))
  }
  if (session.tiers?.length) {
    return allTasks.filter(t => session.tiers!.includes(t.tier as Tier))
  }
  if (session.tags?.length) {
    return allTasks.filter(t => t.tags?.some(tag => session.tags!.includes(tag)))
  }
  return allTasks
}

/**
 * Merge a base HarnessConfig with an override, override wins on conflicts.
 */
export function mergeConfigs(
  base: HarnessConfig,
  override: HarnessConfig,
): HarnessConfig {
  return { ...base, ...override }
}

/**
 * Look up a variant by ID from the canonical ABLATION_VARIANTS list.
 * Throws if not found — callers should use IDs that are known at build time.
 */
export function getVariant(id: string): HarnessVariant {
  const v = ABLATION_VARIANTS.find(v => v.id === id)
  if (!v) throw new Error(`Unknown variant ID: ${id}`)
  return v
}
```

- [ ] **Step 4.4: Run test — expect 16 pass**

```bash
cd packages/benchmarks && bun test tests/benchmark-v2.test.ts
```

Expected: 16 pass, 0 fail.

- [ ] **Step 4.5: Commit**

```bash
rtk git add packages/benchmarks/src/session.ts packages/benchmarks/tests/benchmark-v2.test.ts
rtk git commit -m "feat(benchmarks): add session.ts with 9-variant ABLATION_VARIANTS and session utilities"
```

---

## Task 5: Create judge.ts

**Files:**
- Create: `packages/benchmarks/src/judge.ts`
- Test: `packages/benchmarks/tests/benchmark-v2.test.ts` (append)

- [ ] **Step 5.1: Write failing tests**

Append to `packages/benchmarks/tests/benchmark-v2.test.ts`:

```typescript
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
```

- [ ] **Step 5.2: Run — expect import failure**

```bash
cd packages/benchmarks && bun test tests/benchmark-v2.test.ts 2>&1 | grep -i "cannot find"
```

- [ ] **Step 5.3: Create judge.ts**

Create `packages/benchmarks/src/judge.ts`:

```typescript
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import type { BenchmarkTask, DimensionScore, QualityDimension, RunScore, SuccessCriteria } from "./types.js"
import { ReactiveAgents } from "@reactive-agents/runtime"

// ── Pure utility functions (testable without LLM) ────────────────────────────

/**
 * Reliability = 1 - stddev of accuracy scores across runs.
 * 1.0 = perfectly consistent, 0.0 = completely random.
 */
export function computeReliability(runs: ReadonlyArray<RunScore>): number {
  if (runs.length < 2) return 1
  const scores = runs.map(r => r.dimensions.find(d => d.dimension === "accuracy")?.score ?? 0)
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length
  const variance = scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length
  return Math.max(0, 1 - Math.sqrt(variance))
}

/**
 * Test a regex SuccessCriteria against output — returns 1.0 (pass) or 0.0 (fail).
 */
export function matchSuccessCriteria(output: string, criteria: SuccessCriteria): number {
  if (criteria.type !== "regex") return 0
  try {
    return new RegExp(criteria.pattern, "i").test(output) ? 1.0 : 0.0
  } catch {
    return output.toLowerCase().includes(criteria.pattern.toLowerCase()) ? 1.0 : 0.0
  }
}

/**
 * Parse bun test / jest-style output to extract a partial credit ratio.
 * Looks for patterns like "3 pass" and "1 fail".
 */
export function parsePartialCreditScore(output: string): number {
  const passMatch = output.match(/(\d+)\s+pass/i)
  const failMatch = output.match(/(\d+)\s+fail/i)
  if (!passMatch) return 0.0
  const pass = parseInt(passMatch[1]!, 10)
  const fail = parseInt(failMatch?.[1] ?? "0", 10)
  const total = pass + fail
  return total === 0 ? 0.0 : pass / total
}

// ── Verifiable scoring — runs a command in tmpDir ────────────────────────────

export async function scoreVerifiable(
  command: string,
  tmpDir: string,
  partialCredit = false,
): Promise<DimensionScore> {
  const [cmd, ...args] = command.split(" ")
  const result = spawnSync(cmd!, args, { cwd: tmpDir, encoding: "utf8", timeout: 30_000 })

  if (result.status === 0) {
    return { dimension: "accuracy", score: 1.0 }
  }

  if (partialCredit) {
    const combined = (result.stdout ?? "") + (result.stderr ?? "")
    const score = parsePartialCreditScore(combined)
    return { dimension: "accuracy", score, evidence: `exit ${result.status}: ${combined.slice(0, 200)}` }
  }

  const err = (result.stderr ?? "").slice(0, 300)
  return { dimension: "accuracy", score: 0.0, evidence: `exit ${result.status}: ${err}` }
}

// ── LLM-as-judge ─────────────────────────────────────────────────────────────

const judgeModel = process.env["BENCH_JUDGE_MODEL"] ?? "claude-haiku-4-5"
const judgeProvider = (process.env["BENCH_JUDGE_PROVIDER"] ?? "anthropic") as "anthropic" | "openai"

async function callJudge(prompt: string): Promise<string> {
  const agent = await ReactiveAgents.create()
    .withName("bench-judge")
    .withProvider(judgeProvider)
    .withModel(judgeModel)
    .withMaxIterations(1)
    .build()
  try {
    const result = await agent.run(prompt)
    return result.output
  } finally {
    await agent.dispose()
  }
}

function buildJudgePrompt(
  taskPrompt: string,
  output: string,
  dimension: QualityDimension,
  rubric: string,
): string {
  return `You are evaluating an AI agent's performance on a benchmark task.

TASK PROMPT:
${taskPrompt.slice(0, 800)}

AGENT OUTPUT (truncated to 1500 chars):
${output.slice(0, 1500)}

DIMENSION: ${dimension}
RUBRIC: ${rubric}

Score the agent's performance on this single dimension from 0.0 to 1.0.
- 1.0 = excellent, fully meets the rubric
- 0.5 = partially meets the rubric
- 0.0 = fails the rubric entirely

Reply with ONLY a JSON object on one line:
{"score": <0.0-1.0>, "evidence": "<one sentence explaining the score>"}`
}

async function scoreWithJudge(
  taskPrompt: string,
  output: string,
  dimension: QualityDimension,
  rubric: string,
): Promise<DimensionScore> {
  const prompt = buildJudgePrompt(taskPrompt, output, dimension, rubric)
  try {
    const raw = await callJudge(prompt)
    const match = raw.match(/\{[^}]+\}/)
    if (!match) throw new Error("No JSON in judge response")
    const parsed = JSON.parse(match[0]) as { score: number; evidence?: string }
    const score = Math.max(0, Math.min(1, Number(parsed.score) || 0))
    return { dimension, score, evidence: parsed.evidence }
  } catch (e) {
    return { dimension, score: 0, evidence: `Judge error: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ── Main entry: score a task run across all relevant dimensions ───────────────

/**
 * Score a completed task run across all dimensions it exercises.
 * Accuracy is always scored. Other dimensions come from task.dimensionRubrics.
 * Efficiency is computed from token counts. Reliability is session-level (not here).
 */
export async function scoreTask(
  output: string,
  task: BenchmarkTask,
  tmpDir: string,
  runTokens: number,
  runIterations: number,
): Promise<ReadonlyArray<DimensionScore>> {
  const scores: DimensionScore[] = []

  // ── Accuracy ────────────────────────────────────────────────────────────────
  if (task.successCriteria) {
    switch (task.successCriteria.type) {
      case "regex":
        scores.push(matchSuccessCriteria(output, task.successCriteria)
          ? { dimension: "accuracy", score: 1.0 }
          : { dimension: "accuracy", score: 0.0 })
        break
      case "verifiable":
        scores.push(await scoreVerifiable(
          task.successCriteria.command,
          tmpDir,
          task.successCriteria.partialCredit,
        ))
        break
      case "llm-judge":
        scores.push(await scoreWithJudge(
          task.prompt, output, "accuracy", task.successCriteria.rubric,
        ))
        break
      case "schema":
        // Schema validation: attempt to parse output as JSON and validate
        try {
          JSON.parse(output)
          scores.push({ dimension: "accuracy", score: 1.0 })
        } catch {
          scores.push({ dimension: "accuracy", score: 0.0, evidence: "Output is not valid JSON" })
        }
        break
    }
  } else if (task.expected) {
    // Legacy regex from existing tasks
    const patterns = task.expected.split("|")
    const matched = patterns.some(p => {
      try { return new RegExp(p, "i").test(output) }
      catch { return output.toLowerCase().includes(p.toLowerCase()) }
    })
    scores.push({ dimension: "accuracy", score: matched ? 1.0 : 0.0 })
  }

  // ── Efficiency — normalized token usage ─────────────────────────────────────
  if (task.primaryDimensions?.includes("efficiency")) {
    const baselineTokens = 500 * (task.maxIterations ?? 15)
    const ratio = runTokens / baselineTokens
    const effScore = Math.max(0, 1 - Math.min(1, Math.max(0, ratio - 0.5) / 1.5))
    scores.push({ dimension: "efficiency", score: effScore,
      evidence: `${runTokens} tokens used (baseline ${baselineTokens})` })
  }

  // ── LLM-judged dimensions from task.dimensionRubrics ───────────────────────
  if (task.dimensionRubrics?.length) {
    for (const rubric of task.dimensionRubrics) {
      if (rubric.dimension === "accuracy") continue  // already scored above
      if (rubric.dimension === "efficiency") continue  // computed above
      if (rubric.dimension === "reliability") continue  // session-level aggregation
      scores.push(await scoreWithJudge(task.prompt, output, rubric.dimension, rubric.rubric))
    }
  }

  return scores
}
```

- [ ] **Step 5.4: Run test — expect 26 pass**

```bash
cd packages/benchmarks && bun test tests/benchmark-v2.test.ts
```

Expected: 26 pass, 0 fail. (The LLM-dependent `scoreTask` and `scoreVerifiable` are not unit-tested here — pure functions only.)

- [ ] **Step 5.5: Typecheck**

```bash
cd packages/benchmarks && bun run typecheck
```

Expected: no errors.

- [ ] **Step 5.6: Commit**

```bash
rtk git add packages/benchmarks/src/judge.ts packages/benchmarks/tests/benchmark-v2.test.ts
rtk git commit -m "feat(benchmarks): add judge.ts with scoreTask, computeReliability, and verifiable scoring"
```

---

## Task 6: Add competitor devDeps + create competitors/types.ts

**Files:**
- Modify: `packages/benchmarks/package.json`
- Create: `packages/benchmarks/src/competitors/types.ts`
- Test: `packages/benchmarks/tests/benchmark-v2.test.ts` (append)

- [ ] **Step 6.1: Write failing test**

Append to `packages/benchmarks/tests/benchmark-v2.test.ts`:

```typescript
import type { CompetitorRunner, TaskRunResult } from "../src/competitors/types.js"

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
```

- [ ] **Step 6.2: Run — expect import failure**

```bash
cd packages/benchmarks && bun test tests/benchmark-v2.test.ts 2>&1 | grep -i "cannot find"
```

- [ ] **Step 6.3: Install competitor devDeps**

```bash
cd packages/benchmarks && bun add -d \
  @langchain/langgraph@^0.2 \
  @langchain/core@^0.3 \
  @langchain/anthropic@^0.3 \
  @langchain/openai@^0.3 \
  ai@^4.0 \
  @ai-sdk/anthropic@^1.0 \
  @ai-sdk/openai@^1.0 \
  @openai/agents@^0.0 \
  @mastra/core@^0.5 \
  llamaindex@^0.8 \
  zod@^3.23
```

Expected: packages installed, package.json devDependencies updated.

- [ ] **Step 6.4: Create competitors/types.ts**

Create `packages/benchmarks/src/competitors/types.ts`:

```typescript
import type { BenchmarkTask, ModelVariant } from "../types.js"

/** Raw result from any runner — internal or competitor. */
export interface TaskRunResult {
  readonly output: string
  readonly tokensUsed: number
  readonly durationMs: number
  readonly iterations: number
  readonly status: "pass" | "fail" | "error"
  readonly error?: string
  readonly traceId?: string
}

/** Shared interface implemented by all 5 competitor runners. */
export interface CompetitorRunner {
  readonly id: string
  readonly label: string
  readonly framework: "langchain" | "vercel-ai" | "openai-agents" | "mastra" | "llamaindex"
  readonly pinnedVersion: string
  run(
    task: BenchmarkTask,
    model: ModelVariant,
    tmpDir: string,
    timeoutMs: number,
  ): Promise<TaskRunResult>
}
```

- [ ] **Step 6.5: Run test — expect 27 pass**

```bash
cd packages/benchmarks && bun test tests/benchmark-v2.test.ts
```

Expected: 27 pass, 0 fail.

- [ ] **Step 6.6: Commit**

```bash
rtk git add packages/benchmarks/package.json packages/benchmarks/src/competitors/types.ts packages/benchmarks/tests/benchmark-v2.test.ts
rtk git commit -m "feat(benchmarks): add competitor devDeps and CompetitorRunner interface"
```

---

## Task 7: Implement all 5 competitor runners + index.ts

**Files:**
- Create: `packages/benchmarks/src/competitors/langchain-runner.ts`
- Create: `packages/benchmarks/src/competitors/vercel-ai-runner.ts`
- Create: `packages/benchmarks/src/competitors/openai-agents-runner.ts`
- Create: `packages/benchmarks/src/competitors/mastra-runner.ts`
- Create: `packages/benchmarks/src/competitors/llamaindex-runner.ts`
- Create: `packages/benchmarks/src/competitors/index.ts`
- Test: `packages/benchmarks/tests/benchmark-v2.test.ts` (append)

- [ ] **Step 7.1: Write failing tests**

Append to `packages/benchmarks/tests/benchmark-v2.test.ts`:

```typescript
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
```

- [ ] **Step 7.2: Run — expect import failure**

```bash
cd packages/benchmarks && bun test tests/benchmark-v2.test.ts 2>&1 | grep -i "cannot find"
```

- [ ] **Step 7.3: Create langchain-runner.ts**

Create `packages/benchmarks/src/competitors/langchain-runner.ts`:

```typescript
import type { CompetitorRunner, TaskRunResult } from "./types.js"
import type { BenchmarkTask, ModelVariant } from "../types.js"

// Tools available to all competitors — same set as internal variants
// Mapped to LangChain DynamicStructuredTool format
function buildLangChainTools(tmpDir: string) {
  const { DynamicStructuredTool } = require("@langchain/core/tools")
  const { z } = require("zod")
  const { readFileSync, writeFileSync } = require("node:fs")
  const { join } = require("node:path")

  return [
    new DynamicStructuredTool({
      name: "file_read",
      description: "Read a file from the working directory",
      schema: z.object({ path: z.string() }),
      func: async ({ path }: { path: string }) => {
        try { return readFileSync(join(tmpDir, path), "utf8") }
        catch (e) { return `Error: ${e}` }
      },
    }),
    new DynamicStructuredTool({
      name: "file_write",
      description: "Write content to a file in the working directory",
      schema: z.object({ path: z.string(), content: z.string() }),
      func: async ({ path, content }: { path: string; content: string }) => {
        try { writeFileSync(join(tmpDir, path), content, "utf8"); return "ok" }
        catch (e) { return `Error: ${e}` }
      },
    }),
  ]
}

function buildLangChainLLM(model: ModelVariant) {
  if (model.provider === "anthropic") {
    const { ChatAnthropic } = require("@langchain/anthropic")
    return new ChatAnthropic({ model: model.model, temperature: 0 })
  }
  if (model.provider === "openai") {
    const { ChatOpenAI } = require("@langchain/openai")
    return new ChatOpenAI({ model: model.model, temperature: 0 })
  }
  throw new Error(`LangChain runner: unsupported provider ${model.provider}`)
}

export const langchainRunner: CompetitorRunner = {
  id: "langchain-react",
  label: "LangChain JS",
  framework: "langchain",
  pinnedVersion: "0.3.x",
  async run(task: BenchmarkTask, model: ModelVariant, tmpDir: string, timeoutMs: number): Promise<TaskRunResult> {
    const start = performance.now()
    try {
      const { createReactAgent } = require("@langchain/langgraph/prebuilt")
      const { HumanMessage } = require("@langchain/core/messages")

      const llm = buildLangChainLLM(model)
      const tools = buildLangChainTools(tmpDir)
      const agent = createReactAgent({ llm, tools })

      const response = await Promise.race([
        agent.invoke({ messages: [new HumanMessage(task.prompt)] }),
        new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), timeoutMs)),
      ])

      const lastMsg = response.messages[response.messages.length - 1]
      const output = typeof lastMsg?.content === "string"
        ? lastMsg.content
        : JSON.stringify(lastMsg?.content ?? "")

      return {
        output,
        tokensUsed: 0, // LangChain doesn't expose token counts easily without callbacks
        durationMs: performance.now() - start,
        iterations: response.messages.filter((m: { _getType?: () => string }) => m._getType?.() === "tool").length,
        status: "pass",
      }
    } catch (e) {
      return {
        output: "",
        tokensUsed: 0,
        durationMs: performance.now() - start,
        iterations: 0,
        status: "error",
        error: e instanceof Error ? e.message : String(e),
      }
    }
  },
}
```

- [ ] **Step 7.4: Create vercel-ai-runner.ts**

Create `packages/benchmarks/src/competitors/vercel-ai-runner.ts`:

```typescript
import type { CompetitorRunner, TaskRunResult } from "./types.js"
import type { BenchmarkTask, ModelVariant } from "../types.js"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

function buildVercelModel(model: ModelVariant) {
  if (model.provider === "anthropic") {
    const { anthropic } = require("@ai-sdk/anthropic")
    return anthropic(model.model)
  }
  if (model.provider === "openai") {
    const { openai } = require("@ai-sdk/openai")
    return openai(model.model)
  }
  throw new Error(`Vercel AI runner: unsupported provider ${model.provider}`)
}

function buildVercelTools(tmpDir: string) {
  const { tool } = require("ai")
  const { z } = require("zod")
  return {
    file_read: tool({
      description: "Read a file from the working directory",
      parameters: z.object({ path: z.string() }),
      execute: async ({ path }: { path: string }) => {
        try { return readFileSync(join(tmpDir, path), "utf8") }
        catch (e) { return `Error: ${e}` }
      },
    }),
    file_write: tool({
      description: "Write content to a file in the working directory",
      parameters: z.object({ path: z.string(), content: z.string() }),
      execute: async ({ path, content }: { path: string; content: string }) => {
        try { writeFileSync(join(tmpDir, path), content, "utf8"); return "ok" }
        catch (e) { return `Error: ${e}` }
      },
    }),
  }
}

export const vercelAiRunner: CompetitorRunner = {
  id: "vercel-ai-sdk",
  label: "Vercel AI SDK",
  framework: "vercel-ai",
  pinnedVersion: "4.x",
  async run(task: BenchmarkTask, model: ModelVariant, tmpDir: string, timeoutMs: number): Promise<TaskRunResult> {
    const start = performance.now()
    try {
      const { generateText } = require("ai")
      const llmModel = buildVercelModel(model)
      const tools = buildVercelTools(tmpDir)

      const result = await Promise.race([
        generateText({
          model: llmModel,
          prompt: task.prompt,
          tools,
          maxSteps: task.maxIterations ?? 15,
          temperature: 0,
        }),
        new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), timeoutMs)),
      ])

      return {
        output: result.text,
        tokensUsed: (result.usage?.totalTokens ?? 0),
        durationMs: performance.now() - start,
        iterations: result.steps?.length ?? 0,
        status: "pass",
      }
    } catch (e) {
      return {
        output: "",
        tokensUsed: 0,
        durationMs: performance.now() - start,
        iterations: 0,
        status: "error",
        error: e instanceof Error ? e.message : String(e),
      }
    }
  },
}
```

- [ ] **Step 7.5: Create openai-agents-runner.ts**

Create `packages/benchmarks/src/competitors/openai-agents-runner.ts`:

```typescript
import type { CompetitorRunner, TaskRunResult } from "./types.js"
import type { BenchmarkTask, ModelVariant } from "../types.js"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

export const openaiAgentsRunner: CompetitorRunner = {
  id: "openai-agents",
  label: "OpenAI Agents SDK",
  framework: "openai-agents",
  pinnedVersion: "0.x",
  async run(task: BenchmarkTask, model: ModelVariant, tmpDir: string, timeoutMs: number): Promise<TaskRunResult> {
    // OpenAI Agents SDK only supports OpenAI-compatible models
    if (model.provider !== "openai") {
      return {
        output: "",
        tokensUsed: 0,
        durationMs: 0,
        iterations: 0,
        status: "error",
        error: `OpenAI Agents SDK requires provider=openai, got ${model.provider} — skipped`,
      }
    }

    const start = performance.now()
    try {
      const { Agent, run } = require("@openai/agents")
      const { z } = require("zod")

      const fileReadTool = {
        name: "file_read",
        description: "Read a file from the working directory",
        parameters: z.object({ path: z.string() }),
        execute: async ({ path }: { path: string }) => {
          try { return readFileSync(join(tmpDir, path), "utf8") }
          catch (e) { return `Error: ${e}` }
        },
      }

      const fileWriteTool = {
        name: "file_write",
        description: "Write content to a file in the working directory",
        parameters: z.object({ path: z.string(), content: z.string() }),
        execute: async ({ path, content }: { path: string; content: string }) => {
          try { writeFileSync(join(tmpDir, path), content, "utf8"); return "ok" }
          catch (e) { return `Error: ${e}` }
        },
      }

      const agent = new Agent({
        name: `bench-${task.id}`,
        instructions: "You are a helpful assistant. Complete the task carefully.",
        model: model.model,
        tools: [fileReadTool, fileWriteTool],
      })

      const result = await Promise.race([
        run(agent, task.prompt),
        new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), timeoutMs)),
      ])

      return {
        output: result.finalOutput ?? "",
        tokensUsed: result.rawResponses?.reduce((a: number, r: { usage?: { totalTokens?: number } }) => a + (r.usage?.totalTokens ?? 0), 0) ?? 0,
        durationMs: performance.now() - start,
        iterations: result.rawResponses?.length ?? 0,
        status: "pass",
      }
    } catch (e) {
      return {
        output: "",
        tokensUsed: 0,
        durationMs: performance.now() - start,
        iterations: 0,
        status: "error",
        error: e instanceof Error ? e.message : String(e),
      }
    }
  },
}
```

- [ ] **Step 7.6: Create mastra-runner.ts**

Create `packages/benchmarks/src/competitors/mastra-runner.ts`:

```typescript
import type { CompetitorRunner, TaskRunResult } from "./types.js"
import type { BenchmarkTask, ModelVariant } from "../types.js"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

function buildMastraModel(model: ModelVariant) {
  if (model.provider === "anthropic") {
    const { anthropic } = require("@ai-sdk/anthropic")
    return anthropic(model.model)
  }
  if (model.provider === "openai") {
    const { openai } = require("@ai-sdk/openai")
    return openai(model.model)
  }
  throw new Error(`Mastra runner: unsupported provider ${model.provider}`)
}

export const mastraRunner: CompetitorRunner = {
  id: "mastra-agent",
  label: "Mastra",
  framework: "mastra",
  pinnedVersion: "0.x",
  async run(task: BenchmarkTask, model: ModelVariant, tmpDir: string, timeoutMs: number): Promise<TaskRunResult> {
    const start = performance.now()
    try {
      const { Agent } = require("@mastra/core/agent")
      const { createTool } = require("@mastra/core/tools")
      const { z } = require("zod")

      const tools = {
        fileRead: createTool({
          id: "file_read",
          description: "Read a file from the working directory",
          inputSchema: z.object({ path: z.string() }),
          execute: async ({ context }: { context: { path: string } }) => {
            try { return readFileSync(join(tmpDir, context.path), "utf8") }
            catch (e) { return `Error: ${e}` }
          },
        }),
        fileWrite: createTool({
          id: "file_write",
          description: "Write content to a file in the working directory",
          inputSchema: z.object({ path: z.string(), content: z.string() }),
          execute: async ({ context }: { context: { path: string; content: string } }) => {
            try { writeFileSync(join(tmpDir, context.path), context.content, "utf8"); return "ok" }
            catch (e) { return `Error: ${e}` }
          },
        }),
      }

      const agent = new Agent({
        name: `bench-${task.id}`,
        instructions: "You are a helpful assistant. Complete the task carefully.",
        model: buildMastraModel(model),
        tools,
      })

      const response = await Promise.race([
        agent.generate(task.prompt),
        new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), timeoutMs)),
      ])

      return {
        output: response.text ?? "",
        tokensUsed: response.usage?.totalTokens ?? 0,
        durationMs: performance.now() - start,
        iterations: response.steps?.length ?? 1,
        status: "pass",
      }
    } catch (e) {
      return {
        output: "",
        tokensUsed: 0,
        durationMs: performance.now() - start,
        iterations: 0,
        status: "error",
        error: e instanceof Error ? e.message : String(e),
      }
    }
  },
}
```

- [ ] **Step 7.7: Create llamaindex-runner.ts**

Create `packages/benchmarks/src/competitors/llamaindex-runner.ts`:

```typescript
import type { CompetitorRunner, TaskRunResult } from "./types.js"
import type { BenchmarkTask, ModelVariant } from "../types.js"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

export const llamaindexRunner: CompetitorRunner = {
  id: "llamaindex-ts",
  label: "LlamaIndex TS",
  framework: "llamaindex",
  pinnedVersion: "0.x",
  async run(task: BenchmarkTask, model: ModelVariant, tmpDir: string, timeoutMs: number): Promise<TaskRunResult> {
    if (model.provider !== "anthropic" && model.provider !== "openai") {
      return {
        output: "",
        tokensUsed: 0,
        durationMs: 0,
        iterations: 0,
        status: "error",
        error: `LlamaIndex runner: unsupported provider ${model.provider} — skipped`,
      }
    }

    const start = performance.now()
    try {
      const { FunctionTool, ReActAgent } = require("llamaindex")

      const tools = [
        FunctionTool.from(
          ({ path }: { path: string }) => {
            try { return readFileSync(join(tmpDir, path), "utf8") }
            catch (e) { return `Error: ${e}` }
          },
          { name: "file_read", description: "Read a file from the working directory",
            parameters: { type: "object" as const, properties: { path: { type: "string" as const } }, required: ["path"] } },
        ),
        FunctionTool.from(
          ({ path, content }: { path: string; content: string }) => {
            try { writeFileSync(join(tmpDir, path), content, "utf8"); return "ok" }
            catch (e) { return `Error: ${e}` }
          },
          { name: "file_write", description: "Write content to a file in the working directory",
            parameters: { type: "object" as const, properties: { path: { type: "string" as const }, content: { type: "string" as const } }, required: ["path", "content"] } },
        ),
      ]

      let llm: unknown
      if (model.provider === "openai") {
        const { OpenAI } = require("llamaindex")
        llm = new OpenAI({ model: model.model, temperature: 0 })
      } else {
        const { Anthropic } = require("llamaindex")
        llm = new Anthropic({ model: model.model, temperature: 0 })
      }

      const agent = new ReActAgent({ tools, llm, verbose: false })
      const response = await Promise.race([
        agent.chat({ message: task.prompt }),
        new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), timeoutMs)),
      ])

      return {
        output: response.response ?? "",
        tokensUsed: 0,
        durationMs: performance.now() - start,
        iterations: 0,
        status: "pass",
      }
    } catch (e) {
      return {
        output: "",
        tokensUsed: 0,
        durationMs: performance.now() - start,
        iterations: 0,
        status: "error",
        error: e instanceof Error ? e.message : String(e),
      }
    }
  },
}
```

- [ ] **Step 7.8: Create competitors/index.ts**

Create `packages/benchmarks/src/competitors/index.ts`:

```typescript
import type { CompetitorRunner } from "./types.js"
import { langchainRunner }     from "./langchain-runner.js"
import { vercelAiRunner }      from "./vercel-ai-runner.js"
import { openaiAgentsRunner }  from "./openai-agents-runner.js"
import { mastraRunner }        from "./mastra-runner.js"
import { llamaindexRunner }    from "./llamaindex-runner.js"

export type { CompetitorRunner, TaskRunResult } from "./types.js"

export const COMPETITOR_RUNNERS: Record<string, CompetitorRunner> = {
  "langchain":       langchainRunner,
  "vercel-ai":       vercelAiRunner,
  "openai-agents":   openaiAgentsRunner,
  "mastra":          mastraRunner,
  "llamaindex":      llamaindexRunner,
}
```

- [ ] **Step 7.9: Run test — expect 30 pass**

```bash
cd packages/benchmarks && bun test tests/benchmark-v2.test.ts
```

Expected: 30 pass, 0 fail.

- [ ] **Step 7.10: Typecheck**

```bash
cd packages/benchmarks && bun run typecheck
```

Expected: no errors.

- [ ] **Step 7.11: Commit**

```bash
rtk git add \
  packages/benchmarks/src/competitors/langchain-runner.ts \
  packages/benchmarks/src/competitors/vercel-ai-runner.ts \
  packages/benchmarks/src/competitors/openai-agents-runner.ts \
  packages/benchmarks/src/competitors/mastra-runner.ts \
  packages/benchmarks/src/competitors/llamaindex-runner.ts \
  packages/benchmarks/src/competitors/index.ts \
  packages/benchmarks/tests/benchmark-v2.test.ts
rtk git commit -m "feat(benchmarks): implement all 5 competitor runners (LangChain, Vercel AI, OpenAI Agents, Mastra, LlamaIndex)"
```

---

## Task 8: Create ci.ts

**Files:**
- Create: `packages/benchmarks/src/ci.ts`
- Test: `packages/benchmarks/tests/benchmark-v2.test.ts` (append)

- [ ] **Step 8.1: Write failing tests**

Append to `packages/benchmarks/tests/benchmark-v2.test.ts`:

```typescript
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
```

- [ ] **Step 8.2: Run — expect import failure**

```bash
cd packages/benchmarks && bun test tests/benchmark-v2.test.ts 2>&1 | grep -i "cannot find"
```

- [ ] **Step 8.3: Create ci.ts**

Create `packages/benchmarks/src/ci.ts`:

```typescript
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"
import type { DriftReport, TaskVariantReport, QualityDimension, DimensionScore } from "./types.js"

const DEFAULT_REGRESSION_THRESHOLD = 0.15

/**
 * Compare current task-variant reports against a stored baseline.
 * Returns a DriftReport identifying regressions and improvements.
 */
export function computeDrift(
  baseline: ReadonlyArray<TaskVariantReport>,
  current: ReadonlyArray<TaskVariantReport>,
  baselineGitSha: string,
  regressionThreshold = DEFAULT_REGRESSION_THRESHOLD,
): DriftReport {
  type Entry = { taskId: string; variantId: string; dimension: QualityDimension; baselineScore: number; currentScore: number; delta: number }
  const regressions: Entry[] = []
  const improvements: Entry[] = []

  for (const cur of current) {
    const base = baseline.find(b => b.taskId === cur.taskId && b.variantId === cur.variantId)
    if (!base) continue

    // Compare mean scores for each dimension
    for (const curScore of cur.meanScores) {
      const baseScore = base.meanScores.find(s => s.dimension === curScore.dimension)
      if (!baseScore) continue
      const delta = curScore.score - baseScore.score
      if (delta < -regressionThreshold) {
        regressions.push({ taskId: cur.taskId, variantId: cur.variantId,
          dimension: curScore.dimension, baselineScore: baseScore.score,
          currentScore: curScore.score, delta })
      } else if (delta > regressionThreshold) {
        improvements.push({ taskId: cur.taskId, variantId: cur.variantId,
          dimension: curScore.dimension, baselineScore: baseScore.score,
          currentScore: curScore.score, delta })
      }
    }
  }

  return {
    baselineGitSha,
    regressions,
    improvements,
    hasRegressions: regressions.length > 0,
    maxRegressionDelta: regressions.length > 0
      ? Math.min(...regressions.map(r => r.delta))
      : 0,
  }
}

/** Returns true if the drift report has regressions exceeding the CI failure threshold. */
export function exceedsThreshold(drift: DriftReport, failThreshold = DEFAULT_REGRESSION_THRESHOLD): boolean {
  return drift.hasRegressions && Math.abs(drift.maxRegressionDelta) > failThreshold
}

/** Serialize task-variant reports to a baseline JSON file at `path`. */
export function saveBaseline(reports: ReadonlyArray<TaskVariantReport>, gitSha: string, path: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify({ gitSha, reports, savedAt: new Date().toISOString() }, null, 2), "utf8")
}

/** Load a previously saved baseline. Returns null if file doesn't exist. */
export function loadBaseline(path: string): { gitSha: string; reports: ReadonlyArray<TaskVariantReport> } | null {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { gitSha: string; reports: ReadonlyArray<TaskVariantReport> }
    return raw
  } catch {
    return null
  }
}
```

- [ ] **Step 8.4: Run test — expect 34 pass**

```bash
cd packages/benchmarks && bun test tests/benchmark-v2.test.ts
```

Expected: 34 pass, 0 fail.

- [ ] **Step 8.5: Commit**

```bash
rtk git add packages/benchmarks/src/ci.ts packages/benchmarks/tests/benchmark-v2.test.ts
rtk git commit -m "feat(benchmarks): add ci.ts with drift detection and baseline management"
```

---

## Task 9: Extend runner.ts with runSession()

**Files:**
- Modify: `packages/benchmarks/src/runner.ts`
- Test: `packages/benchmarks/tests/benchmark-v2.test.ts` (append)

- [ ] **Step 9.1: Write failing test**

Append to `packages/benchmarks/tests/benchmark-v2.test.ts`:

```typescript
import { aggregateRuns, computeAllAblation, summarizeDimensions } from "../src/runner.js"

test("aggregateRuns computes correct passRate and meanTokens", () => {
  const runs = [
    { runIndex: 0, dimensions: [{ dimension: "accuracy" as const, score: 1.0 }], tokensUsed: 100, durationMs: 500, status: "pass" as const, output: "" },
    { runIndex: 1, dimensions: [{ dimension: "accuracy" as const, score: 0.0 }], tokensUsed: 200, durationMs: 600, status: "fail" as const, output: "" },
  ]
  const report = aggregateRuns("rw-1", "haiku", { type: "internal", id: "ra-full", label: "RA Full", config: {} }, runs)
  expect(report.passRate).toBeCloseTo(0.5, 2)
  expect(report.meanTokens).toBe(150)
  expect(report.meanScores[0]!.score).toBeCloseTo(0.5, 2)
})

test("computeAllAblation computes harnessLift correctly", () => {
  const baseReport = {
    taskId: "rw-1", modelVariantId: "haiku",
    variantId: "bare-llm", variantLabel: "Bare LLM",
    runs: [], meanScores: [{ dimension: "accuracy" as const, score: 0.3 }],
    variance: 0, meanTokens: 100, meanDurationMs: 500, passRate: 0.3,
  }
  const fullReport = {
    ...baseReport, variantId: "ra-full", variantLabel: "RA Full",
    meanScores: [{ dimension: "accuracy" as const, score: 0.9 }],
    passRate: 0.9,
  }
  const ablation = computeAllAblation([baseReport, fullReport])
  expect(ablation).toHaveLength(1)
  expect(ablation[0]!.harnessLift).toBeCloseTo(0.6, 2)
})
```

- [ ] **Step 9.2: Run — expect failures (functions not yet exported)**

```bash
cd packages/benchmarks && bun test tests/benchmark-v2.test.ts 2>&1 | grep -E "pass|fail"
```

- [ ] **Step 9.3: Add runSession() and helpers to runner.ts**

Append to the end of `packages/benchmarks/src/runner.ts` (after the last line):

```typescript
// ── v2: runSession() — multi-variant, multi-model, multi-run session runner ──

import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execSync } from "node:child_process"
import type {
  BenchmarkSession, BenchmarkTask, HarnessVariant, ModelVariant,
  TaskVariantReport, AblationResult, SessionReport, RunScore,
  DimensionScore, QualityDimension, HarnessConfig, TaskRunResult,
} from "./types.js"
import { BENCHMARK_TASKS } from "./task-registry.js"
import { REAL_WORLD_TASKS } from "./tasks/real-world.js"
import { COMPETITOR_RUNNERS } from "./competitors/index.js"
import { resolveTasks, mergeConfigs } from "./session.js"
import { scoreTask, computeReliability } from "./judge.js"

const ALL_TASKS = [...BENCHMARK_TASKS, ...REAL_WORLD_TASKS] as const

function getGitSha(): string {
  try { return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim() }
  catch { return "unknown" }
}

/** Write task fixtures to a temp directory. */
function writeFixtures(task: BenchmarkTask, dir: string): void {
  for (const fixture of task.fixtures ?? []) {
    const dest = join(dir, fixture.path)
    mkdirSync(join(dir, fixture.path.split("/").slice(0, -1).join("/")), { recursive: true })
    writeFileSync(dest, fixture.content, "utf8")
  }
}

/** Run an internal variant (bare-llm, manual-react, ra-reasoning, ra-full). */
async function runInternal(
  task: BenchmarkTask,
  model: ModelVariant,
  config: HarnessConfig,
  tmpDir: string,
  timeoutMs: number,
): Promise<TaskRunResult> {
  const start = performance.now()
  try {
    const maxIter = task.maxIterations ?? (config.reasoning ? 20 : config.tools ? 15 : 1)
    const builder = ReactiveAgents.create()
      .withName(`bench-${task.id}`)
      .withProvider(model.provider)
      .withModel(model.model)
      .withMaxIterations(maxIter)

    if (config.tools) builder.withTools()
    if (config.guardrails) builder.withGuardrails()

    if (config.reasoning) {
      const strategyMap = {
        "react": "reactive" as const,
        "plan-execute": "plan-execute-reflect" as const,
        "tree-of-thought": "tree-of-thought" as const,
        "adaptive": "adaptive" as const,
      }
      const strategy = config.strategy ? strategyMap[config.strategy] : "reactive"
      builder.withReasoning({
        defaultStrategy: strategy,
        reactiveIntelligence: config.reactiveIntelligence,
        adaptiveContext: config.adaptiveContext,
      } as Parameters<typeof builder.withReasoning>[0])
    }

    if (config.memory) {
      (builder as unknown as { withMemory: () => typeof builder }).withMemory?.()
    }

    const _log = console.log; console.log = () => {}
    const agent = await builder.build()
    console.log = _log

    let tokens = 0; let iters = 0
    const unsub = await agent.subscribe((event) => {
      if (event._tag === "LLMRequestCompleted") tokens += event.tokensUsed
      if (event._tag === "ReasoningStepCompleted") iters++
    })

    try {
      const timeoutP = new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), timeoutMs))
      const result = await Promise.race([agent.run(task.prompt), timeoutP])
      return {
        output: result.output,
        tokensUsed: result.metadata.tokensUsed || tokens,
        durationMs: performance.now() - start,
        iterations: result.metadata.stepsCount || iters,
        status: "pass",
      }
    } finally {
      unsub(); await agent.dispose()
    }
  } catch (e) {
    return {
      output: "",
      tokensUsed: 0,
      durationMs: performance.now() - start,
      iterations: 0,
      status: "error",
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

/** Dispatch a single task run to the right runner — internal or competitor. */
async function dispatch(
  task: BenchmarkTask,
  model: ModelVariant,
  variant: HarnessVariant,
  tmpDir: string,
  timeoutMs: number,
): Promise<TaskRunResult> {
  if (variant.type === "competitor") {
    const runner = COMPETITOR_RUNNERS[variant.framework]
    if (!runner) return { output: "", tokensUsed: 0, durationMs: 0, iterations: 0, status: "error", error: `No runner for ${variant.framework}` }
    return runner.run(task, model, tmpDir, timeoutMs)
  }

  // Internal: ra-full uses task's optimalHarnessConfig as the ceiling
  const effectiveConfig = variant.id === "ra-full" && task.optimalHarnessConfig
    ? mergeConfigs(variant.config, task.optimalHarnessConfig)
    : variant.config

  // Inject mock URL for resilience task rw-9
  const effectiveTask = task.id === "rw-9"
    ? { ...task, prompt: task.prompt.replace("INJECT_MOCK_URL", "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true&include_market_cap=true") }
    : task

  return runInternal(effectiveTask, model, effectiveConfig, tmpDir, timeoutMs)
}

/** Aggregate N run scores into a TaskVariantReport. */
export function aggregateRuns(
  taskId: string,
  modelVariantId: string,
  variant: HarnessVariant,
  runs: ReadonlyArray<RunScore>,
): TaskVariantReport {
  if (runs.length === 0) {
    return { taskId, modelVariantId, variantId: variant.id, variantLabel: variant.label,
      runs: [], meanScores: [], variance: 0, meanTokens: 0, meanDurationMs: 0, passRate: 0 }
  }

  // Collect all dimension IDs that appear across runs
  const dims = [...new Set(runs.flatMap(r => r.dimensions.map(d => d.dimension)))] as QualityDimension[]

  const meanScores: DimensionScore[] = dims.map(dim => {
    const scores = runs.map(r => r.dimensions.find(d => d.dimension === dim)?.score ?? 0)
    return { dimension: dim, score: scores.reduce((a, b) => a + b, 0) / scores.length }
  })

  const accuracyScores = runs.map(r => r.dimensions.find(d => d.dimension === "accuracy")?.score ?? 0)
  const mean = accuracyScores.reduce((a, b) => a + b, 0) / accuracyScores.length
  const variance = accuracyScores.reduce((a, b) => a + (b - mean) ** 2, 0) / accuracyScores.length
  const reliability = computeReliability(runs as RunScore[])

  // Inject reliability as a dimension score (session-level)
  if (!meanScores.find(s => s.dimension === "reliability")) {
    meanScores.push({ dimension: "reliability", score: reliability })
  }

  return {
    taskId, modelVariantId,
    variantId: variant.id, variantLabel: variant.label,
    runs,
    meanScores,
    variance: Math.sqrt(variance),
    meanTokens: Math.round(runs.reduce((a, r) => a + r.tokensUsed, 0) / runs.length),
    meanDurationMs: Math.round(runs.reduce((a, r) => a + r.durationMs, 0) / runs.length),
    passRate: runs.filter(r => r.status === "pass").length / runs.length,
  }
}

/** Compute ablation results — one per (taskId × modelVariantId) combination. */
export function computeAllAblation(reports: ReadonlyArray<TaskVariantReport>): ReadonlyArray<AblationResult> {
  const groups = new Map<string, TaskVariantReport[]>()
  for (const r of reports) {
    const key = `${r.taskId}::${r.modelVariantId}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(r)
  }

  const results: AblationResult[] = []
  for (const [key, variants] of groups) {
    const [taskId, modelVariantId] = key.split("::") as [string, string]
    const baseline = variants.find(v => v.variantId === "bare-llm")
    const full = variants.find(v => v.variantId === "ra-full")
    if (!baseline || !full) continue

    const baseAcc = baseline.meanScores.find(s => s.dimension === "accuracy")?.score ?? 0
    const fullAcc = full.meanScores.find(s => s.dimension === "accuracy")?.score ?? 0

    const allDims = [...new Set(variants.flatMap(v => v.meanScores.map(s => s.dimension)))] as QualityDimension[]
    const perDimensionLift = allDims.map(dim => {
      const baseScore = baseline.meanScores.find(s => s.dimension === dim)?.score ?? 0
      const fullScore = full.meanScores.find(s => s.dimension === dim)?.score ?? 0
      return { dimension: dim, lift: fullScore - baseScore }
    })

    const bestVariant = [...variants].sort((a, b) =>
      (b.meanScores.find(s => s.dimension === "accuracy")?.score ?? 0) -
      (a.meanScores.find(s => s.dimension === "accuracy")?.score ?? 0)
    )[0]!

    results.push({
      taskId, taskName: taskId, modelVariantId, variants,
      harnessLift: fullAcc - baseAcc,
      perDimensionLift,
      bestVariantId: bestVariant.variantId,
      baselineVariantId: "bare-llm",
    })
  }
  return results
}

/** Aggregate dimension scores across all tasks and variants. */
export function summarizeDimensions(
  reports: ReadonlyArray<TaskVariantReport>,
): SessionReport["dimensionSummary"] {
  const dims = [...new Set(reports.flatMap(r => r.meanScores.map(s => s.dimension)))] as QualityDimension[]
  return dims.map(dim => {
    const variantIds = [...new Set(reports.map(r => r.variantId))]
    return {
      dimension: dim,
      byVariant: variantIds.map(variantId => {
        const variantReports = reports.filter(r => r.variantId === variantId)
        const scores = variantReports.map(r => r.meanScores.find(s => s.dimension === dim)?.score ?? 0)
        return {
          variantId,
          meanScore: scores.reduce((a, b) => a + b, 0) / (scores.length || 1),
        }
      }),
    }
  })
}

/**
 * Run a full named BenchmarkSession — all tasks × models × variants × N runs.
 * Writes a SessionReport to outputPath if provided.
 */
export async function runSession(
  session: BenchmarkSession,
  outputPath?: string,
): Promise<SessionReport> {
  const tasks = resolveTasks(session, ALL_TASKS)
  const gitSha = getGitSha()
  const allVariantReports: TaskVariantReport[] = []

  const runCount = session.runs ?? 1
  const timeoutMs = session.timeoutMs ?? 120_000

  console.log(`\n  Running session: ${session.name} (${session.id} v${session.version})`)
  console.log(`  Tasks: ${tasks.length} | Models: ${session.models.length} | Variants: ${session.harnessVariants.length} | Runs: ${runCount}\n`)

  for (const task of tasks) {
    for (const model of session.models) {
      for (const variant of session.harnessVariants) {
        const runScores: RunScore[] = []

        for (let i = 0; i < runCount; i++) {
          const tmpDir = mkdtempSync(join(tmpdir(), "ra-bench-"))
          try {
            writeFixtures(task, tmpDir)
            const result = await dispatch(task, model, variant, tmpDir, timeoutMs)
            const dimensions = await scoreTask(result.output, task, tmpDir, result.tokensUsed, result.iterations)
            runScores.push({
              runIndex: i,
              dimensions: dimensions as DimensionScore[],
              tokensUsed: result.tokensUsed,
              durationMs: result.durationMs,
              status: result.status,
              output: result.output,
            })
          } finally {
            rmSync(tmpDir, { recursive: true, force: true })
          }
        }

        allVariantReports.push(aggregateRuns(task.id, model.id, variant, runScores))
        process.stdout.write(".")
      }
    }
  }

  console.log("\n")

  const ablation = computeAllAblation(allVariantReports)
  const dimensionSummary = summarizeDimensions(allVariantReports)

  // Build a MultiModelReport-compatible runs array from variant reports
  const sessionReport: SessionReport = {
    generatedAt: new Date().toISOString(),
    runs: [],  // populated below for backward compat
    sessionId: session.id,
    sessionVersion: session.version,
    gitSha,
    ablation,
    dimensionSummary,
  }

  if (outputPath) {
    let existing: SessionReport = sessionReport
    try { existing = JSON.parse(require("node:fs").readFileSync(outputPath, "utf8")) as SessionReport } catch {}
    require("node:fs").writeFileSync(outputPath, JSON.stringify({ ...existing, ...sessionReport }, null, 2), "utf8")
  }

  return sessionReport
}
```

- [ ] **Step 9.4: Run test — expect 36 pass**

```bash
cd packages/benchmarks && bun test tests/benchmark-v2.test.ts
```

Expected: 36 pass, 0 fail.

- [ ] **Step 9.5: Typecheck**

```bash
cd packages/benchmarks && bun run typecheck
```

Expected: no errors.

- [ ] **Step 9.6: Commit**

```bash
rtk git add packages/benchmarks/src/runner.ts packages/benchmarks/tests/benchmark-v2.test.ts
rtk git commit -m "feat(benchmarks): extend runner.ts with runSession(), dispatch(), and aggregation helpers"
```

---

## Task 10: Create sessions/*.ts

**Files:**
- Create: `packages/benchmarks/src/sessions/regression-gate.ts`
- Create: `packages/benchmarks/src/sessions/real-world-full.ts`
- Create: `packages/benchmarks/src/sessions/competitor-comparison.ts`
- Create: `packages/benchmarks/src/sessions/local-models.ts`
- Test: `packages/benchmarks/tests/benchmark-v2.test.ts` (append)

- [ ] **Step 10.1: Write failing tests**

Append to `packages/benchmarks/tests/benchmark-v2.test.ts`:

```typescript
import { regressionGateSession } from "../src/sessions/regression-gate.js"
import { realWorldFullSession } from "../src/sessions/real-world-full.js"
import { competitorComparisonSession } from "../src/sessions/competitor-comparison.js"
import { localModelsSession } from "../src/sessions/local-models.js"

test("regressionGateSession has ra-full only and 1 run", () => {
  expect(regressionGateSession.harnessVariants).toHaveLength(1)
  expect(regressionGateSession.harnessVariants[0]!.id).toBe("ra-full")
  expect(regressionGateSession.runs).toBe(1)
})

test("realWorldFullSession has all 9 variants and 3 runs", () => {
  expect(realWorldFullSession.harnessVariants).toHaveLength(9)
  expect(realWorldFullSession.runs).toBe(3)
  expect(realWorldFullSession.tiers).toContain("real-world")
})

test("competitorComparisonSession has both Anthropic and OpenAI models", () => {
  const providers = competitorComparisonSession.models.map(m => m.provider)
  expect(providers).toContain("anthropic")
  expect(providers).toContain("openai")
  expect(competitorComparisonSession.harnessVariants).toHaveLength(9)
})

test("localModelsSession has only bare-llm and ra-full variants", () => {
  const ids = localModelsSession.harnessVariants.map(v => v.id)
  expect(ids).toContain("bare-llm")
  expect(ids).toContain("ra-full")
  expect(ids).not.toContain("langchain-react")
})
```

- [ ] **Step 10.2: Run — expect import failures**

```bash
cd packages/benchmarks && bun test tests/benchmark-v2.test.ts 2>&1 | grep -i "cannot find"
```

- [ ] **Step 10.3: Create sessions/regression-gate.ts**

Create `packages/benchmarks/src/sessions/regression-gate.ts`:

```typescript
import type { BenchmarkSession } from "../types.js"
import { getVariant } from "../session.js"

export const regressionGateSession: BenchmarkSession = {
  id: "regression-gate",
  name: "CI Regression Gate",
  version: "1.0.0",
  tiers: ["moderate", "complex", "expert"],
  models: [
    { id: "claude-haiku", provider: "anthropic", model: "claude-haiku-4-5", contextTier: "standard" },
  ],
  harnessVariants: [getVariant("ra-full")],
  runs: 1,
  concurrency: 3,
  timeoutMs: 90_000,
}
```

- [ ] **Step 10.4: Create sessions/real-world-full.ts**

Create `packages/benchmarks/src/sessions/real-world-full.ts`:

```typescript
import type { BenchmarkSession } from "../types.js"
import { ABLATION_VARIANTS } from "../session.js"

export const realWorldFullSession: BenchmarkSession = {
  id: "real-world-full",
  name: "Real-World Benchmark Suite",
  version: "1.0.0",
  tiers: ["real-world"],
  models: [
    { id: "claude-haiku", provider: "anthropic", model: "claude-haiku-4-5",  contextTier: "standard" },
    { id: "qwen3-4b",     provider: "ollama",    model: "qwen3:4b",          contextTier: "local" },
    { id: "cogito-8b",    provider: "ollama",    model: "cogito:8b",         contextTier: "local" },
  ],
  harnessVariants: [...ABLATION_VARIANTS],
  runs: 3,
  traceDir: "benchmark-traces",
  concurrency: 1,
  timeoutMs: 300_000,
}
```

- [ ] **Step 10.5: Create sessions/competitor-comparison.ts**

Create `packages/benchmarks/src/sessions/competitor-comparison.ts`:

```typescript
import type { BenchmarkSession } from "../types.js"
import { ABLATION_VARIANTS } from "../session.js"

export const competitorComparisonSession: BenchmarkSession = {
  id: "competitor-comparison",
  name: "Framework Landscape Comparison",
  version: "1.0.0",
  // Research, data analysis, multi-file debug, memory, resilience — max differentiation between tiers
  taskIds: ["rw-1", "rw-2", "rw-7", "rw-8", "rw-9"],
  models: [
    { id: "claude-haiku", provider: "anthropic", model: "claude-haiku-4-5", contextTier: "standard" },
    { id: "gpt-4o-mini",  provider: "openai",    model: "gpt-4o-mini",      contextTier: "standard" },
  ],
  harnessVariants: [...ABLATION_VARIANTS],
  runs: 3,
  traceDir: "benchmark-traces",
  concurrency: 1,
  timeoutMs: 180_000,
}
```

- [ ] **Step 10.6: Create sessions/local-models.ts**

Create `packages/benchmarks/src/sessions/local-models.ts`:

```typescript
import type { BenchmarkSession } from "../types.js"
import { getVariant } from "../session.js"

export const localModelsSession: BenchmarkSession = {
  id: "local-models",
  name: "Local Model Benchmark",
  version: "1.0.0",
  taskIds: ["rw-2", "rw-3", "rw-6", "rw-8", "rw-9"],
  models: [
    { id: "qwen3-4b",  provider: "ollama", model: "qwen3:4b",  contextTier: "local" },
    { id: "cogito-8b", provider: "ollama", model: "cogito:8b", contextTier: "local" },
  ],
  harnessVariants: [getVariant("bare-llm"), getVariant("ra-full")],
  runs: 3,
  traceDir: "benchmark-traces",
  concurrency: 1,
  timeoutMs: 180_000,
}
```

- [ ] **Step 10.7: Run test — expect 40 pass**

```bash
cd packages/benchmarks && bun test tests/benchmark-v2.test.ts
```

Expected: 40 pass, 0 fail.

- [ ] **Step 10.8: Commit**

```bash
rtk git add \
  packages/benchmarks/src/sessions/regression-gate.ts \
  packages/benchmarks/src/sessions/real-world-full.ts \
  packages/benchmarks/src/sessions/competitor-comparison.ts \
  packages/benchmarks/src/sessions/local-models.ts \
  packages/benchmarks/tests/benchmark-v2.test.ts
rtk git commit -m "feat(benchmarks): add 4 pre-built sessions (regression-gate, real-world-full, competitor-comparison, local-models)"
```

---

## Task 11: Extend run.ts CLI

**Files:**
- Modify: `packages/benchmarks/src/run.ts`
- Test: `packages/benchmarks/tests/benchmark-v2.test.ts` (append)

- [ ] **Step 11.1: Write failing test**

Append to `packages/benchmarks/tests/benchmark-v2.test.ts`:

```typescript
import { parseArgs } from "../src/run.js"

test("parseArgs: existing --provider flag still works", () => {
  const args = parseArgs(["--provider", "anthropic", "--model", "claude-haiku-4-5"])
  expect(args.provider).toBe("anthropic")
  expect(args.model).toBe("claude-haiku-4-5")
})

test("parseArgs: --session flag parsed", () => {
  const args = parseArgs(["--session", "local-models"])
  expect(args.session).toBe("local-models")
})

test("parseArgs: --runs flag parsed as number", () => {
  const args = parseArgs(["--session", "local-models", "--runs", "3"])
  expect(args.runs).toBe(3)
})

test("parseArgs: --save-baseline and --ci flags parsed", () => {
  const args = parseArgs(["--session", "regression-gate", "--save-baseline"])
  expect(args.saveBaseline).toBe(true)
  const args2 = parseArgs(["--session", "regression-gate", "--ci"])
  expect(args2.ci).toBe(true)
})
```

- [ ] **Step 11.2: Run — expect import failure on parseArgs**

```bash
cd packages/benchmarks && bun test tests/benchmark-v2.test.ts 2>&1 | grep -i "parseArgs\|cannot find"
```

- [ ] **Step 11.3: Read current run.ts to understand its structure**

```bash
cat packages/benchmarks/src/run.ts
```

- [ ] **Step 11.4: Replace run.ts with extended version**

Replace `packages/benchmarks/src/run.ts` entirely:

```typescript
// File: src/run.ts
import { writeFileSync, readFileSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"
import type { MultiModelReport } from "./types.js"
import { runBenchmarks } from "./runner.js"
import { runSession } from "./runner.js"
import { regressionGateSession } from "./sessions/regression-gate.js"
import { realWorldFullSession } from "./sessions/real-world-full.js"
import { competitorComparisonSession } from "./sessions/competitor-comparison.js"
import { localModelsSession } from "./sessions/local-models.js"
import { saveBaseline, loadBaseline, computeDrift, exceedsThreshold } from "./ci.js"
import type { BenchmarkSession } from "./types.js"

const SESSIONS: Record<string, BenchmarkSession> = {
  "regression-gate":       regressionGateSession,
  "real-world-full":       realWorldFullSession,
  "competitor-comparison": competitorComparisonSession,
  "local-models":          localModelsSession,
}

export interface CliArgs {
  // Legacy flags
  provider?: string
  model?: string
  tiers?: string[]
  taskIds?: string[]
  output?: string
  timeoutSec?: number
  // v2 flags
  session?: string
  runs?: number
  saveBaseline?: boolean
  ci?: boolean
  baselinePath?: string
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {}
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!
    const next = argv[i + 1]
    switch (flag) {
      case "--provider":     args.provider = next; i++; break
      case "--model":        args.model = next; i++; break
      case "--tier":         args.tiers = next?.split(","); i++; break
      case "--task":         args.taskIds = next?.split(","); i++; break
      case "--output":       args.output = next; i++; break
      case "--timeout":      args.timeoutSec = next ? parseInt(next, 10) : undefined; i++; break
      case "--session":      args.session = next; i++; break
      case "--runs":         args.runs = next ? parseInt(next, 10) : undefined; i++; break
      case "--save-baseline":args.saveBaseline = true; break
      case "--ci":           args.ci = true; break
      case "--baseline":     args.baselinePath = next; i++; break
    }
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  // ── v2 path: named session ───────────────────────────────────────────────
  if (args.session) {
    const sessionDef = SESSIONS[args.session]
    if (!sessionDef) {
      console.error(`Unknown session: ${args.session}. Available: ${Object.keys(SESSIONS).join(", ")}`)
      process.exit(1)
    }

    const session = args.runs ? { ...sessionDef, runs: args.runs } : sessionDef
    const outputPath = args.output ?? "apps/docs/src/data/benchmark-report.json"
    const baselinePath = args.baselinePath ?? `benchmark-baselines/${args.session}.json`

    const report = await runSession(session, args.output ? outputPath : undefined)

    if (args.saveBaseline) {
      const allVariantReports = report.ablation?.flatMap(a => a.variants) ?? []
      saveBaseline(allVariantReports, report.gitSha, baselinePath)
      console.log(`Baseline saved to ${baselinePath}`)
    }

    if (args.ci) {
      const baseline = loadBaseline(baselinePath)
      if (!baseline) {
        console.warn("No baseline found — skipping drift check. Run with --save-baseline first.")
      } else {
        const allVariantReports = report.ablation?.flatMap(a => a.variants) ?? []
        const drift = computeDrift(baseline.reports, allVariantReports, baseline.gitSha)
        if (exceedsThreshold(drift)) {
          console.error(`CI FAIL: ${drift.regressions.length} regressions detected. Max delta: ${drift.maxRegressionDelta.toFixed(3)}`)
          for (const r of drift.regressions) {
            console.error(`  ${r.taskId} / ${r.variantId} / ${r.dimension}: ${r.baselineScore.toFixed(2)} → ${r.currentScore.toFixed(2)} (${r.delta.toFixed(2)})`)
          }
          process.exit(1)
        }
        console.log(`CI PASS: no significant regressions (${drift.improvements.length} improvements)`)
      }
    }

    return
  }

  // ── Legacy path: runBenchmarks() ────────────────────────────────────────
  const provider = (args.provider ?? "anthropic") as Parameters<typeof runBenchmarks>[0]["provider"]
  const report = await runBenchmarks({
    provider,
    model: args.model,
    tiers: args.tiers as Parameters<typeof runBenchmarks>[0]["tiers"],
    taskIds: args.taskIds,
    timeoutMs: args.timeoutSec ? args.timeoutSec * 1000 : undefined,
  })

  if (args.output) {
    let existing: MultiModelReport = { generatedAt: new Date().toISOString(), runs: [] }
    try { existing = JSON.parse(readFileSync(args.output, "utf8")) as MultiModelReport } catch {}
    const updated: MultiModelReport = {
      generatedAt: new Date().toISOString(),
      runs: [
        ...existing.runs.filter(r => !(r.provider === report.provider && r.model === report.model)),
        report,
      ],
    }
    mkdirSync(dirname(args.output), { recursive: true })
    writeFileSync(args.output, JSON.stringify(updated, null, 2), "utf8")
    console.log(`\n  Report written to ${args.output}`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
```

- [ ] **Step 11.5: Run test — expect 44 pass**

```bash
cd packages/benchmarks && bun test tests/benchmark-v2.test.ts
```

Expected: 44 pass, 0 fail.

- [ ] **Step 11.6: Verify legacy CLI still works with test provider**

```bash
cd packages/benchmarks && bun run src/run.ts --provider test --tier trivial 2>&1 | tail -5
```

Expected: completes with test provider output (no real LLM calls).

- [ ] **Step 11.7: Commit**

```bash
rtk git add packages/benchmarks/src/run.ts packages/benchmarks/tests/benchmark-v2.test.ts
rtk git commit -m "feat(benchmarks): extend run.ts CLI with --session, --runs, --save-baseline, --ci flags"
```

---

## Task 12: Update index.ts exports

**Files:**
- Modify: `packages/benchmarks/src/index.ts`
- Test: `packages/benchmarks/tests/benchmark-v2.test.ts` (append)

- [ ] **Step 12.1: Write failing test**

Append to `packages/benchmarks/tests/benchmark-v2.test.ts`:

```typescript
import {
  runSession, ABLATION_VARIANTS, REAL_WORLD_TASKS,
  regressionGateSession, realWorldFullSession,
  competitorComparisonSession, localModelsSession,
  computeReliability, computeDrift,
} from "../src/index.js"

test("index.ts exports all v2 public APIs", () => {
  expect(typeof runSession).toBe("function")
  expect(ABLATION_VARIANTS).toHaveLength(9)
  expect(REAL_WORLD_TASKS).toHaveLength(10)
  expect(regressionGateSession.id).toBe("regression-gate")
  expect(realWorldFullSession.id).toBe("real-world-full")
  expect(competitorComparisonSession.id).toBe("competitor-comparison")
  expect(localModelsSession.id).toBe("local-models")
  expect(typeof computeReliability).toBe("function")
  expect(typeof computeDrift).toBe("function")
})
```

- [ ] **Step 12.2: Run — expect import failures from index.js**

```bash
cd packages/benchmarks && bun test tests/benchmark-v2.test.ts 2>&1 | grep -i "does not provide\|cannot find"
```

- [ ] **Step 12.3: Replace index.ts**

Replace `packages/benchmarks/src/index.ts` entirely:

```typescript
// Public API — v1 exports (unchanged)
export type {
  BenchmarkTask,
  TaskResult,
  OverheadMeasurement,
  BenchmarkReport,
  MultiModelReport,
  Tier,
} from "./types.js"
export { BENCHMARK_TASKS, getTasksByTier } from "./task-registry.js"
export { runBenchmarks } from "./runner.js"
export type { RunnerOptions } from "./runner.js"

// Public API — v2 additions
export type {
  QualityDimension,
  DimensionScore,
  RunScore,
  TaskVariantReport,
  AblationResult,
  SessionReport,
  DriftReport,
  HarnessVariant,
  InternalVariant,
  CompetitorVariant,
  HarnessConfig,
  ModelVariant,
  BenchmarkSession,
  DimensionRubric,
  TaskFixture,
  SuccessCriteria,
  TaskRunResult,
} from "./types.js"

export { REAL_WORLD_TASKS } from "./tasks/real-world.js"
export { ABLATION_VARIANTS, resolveTasks, mergeConfigs, getVariant } from "./session.js"
export { runSession, aggregateRuns, computeAllAblation, summarizeDimensions } from "./runner.js"
export { scoreTask, computeReliability, matchSuccessCriteria, parsePartialCreditScore } from "./judge.js"
export { computeDrift, exceedsThreshold, saveBaseline, loadBaseline } from "./ci.js"

export { regressionGateSession }     from "./sessions/regression-gate.js"
export { realWorldFullSession }       from "./sessions/real-world-full.js"
export { competitorComparisonSession } from "./sessions/competitor-comparison.js"
export { localModelsSession }         from "./sessions/local-models.js"

export type { CompetitorRunner } from "./competitors/types.js"
export { COMPETITOR_RUNNERS }    from "./competitors/index.js"
```

- [ ] **Step 12.4: Run test — expect 45 pass**

```bash
cd packages/benchmarks && bun test tests/benchmark-v2.test.ts
```

Expected: 45 pass, 0 fail.

- [ ] **Step 12.5: Run full test suite — confirm nothing broken**

```bash
cd packages/benchmarks && bun test
```

Expected: all existing tests still pass, 45+ new tests pass.

- [ ] **Step 12.6: Typecheck**

```bash
cd packages/benchmarks && bun run typecheck
```

Expected: no errors.

- [ ] **Step 12.7: Commit**

```bash
rtk git add packages/benchmarks/src/index.ts packages/benchmarks/tests/benchmark-v2.test.ts
rtk git commit -m "feat(benchmarks): update index.ts with full v2 public API exports"
```

---

## Task 13: Extend BenchmarkResults.astro

**Files:**
- Modify: `apps/docs/src/components/BenchmarkResults.astro`
- No unit tests — visual verification in browser after adding session data.

The existing component handles legacy `BenchmarkReport` runs. This task adds three new display sections that render when the report contains v2 `SessionReport` fields (`ablation`, `dimensionSummary`). All additions are wrapped in conditional checks so the component continues to work with legacy data.

- [ ] **Step 13.1: Read the current BenchmarkResults.astro bottom half**

```bash
tail -200 apps/docs/src/components/BenchmarkResults.astro
```

This confirms where to insert the new sections.

- [ ] **Step 13.2: Add v2 type declarations to the frontmatter**

In the `---` frontmatter of `apps/docs/src/components/BenchmarkResults.astro`, after the existing `type MultiModelReport = ...` declaration, add:

```typescript
type QualityDimension = "accuracy" | "reasoning" | "tool-mastery" | "memory-fidelity"
  | "loop-intelligence" | "resilience" | "efficiency" | "reliability"
  | "scope-discipline" | "honest-uncertainty"

type DimensionScore = { dimension: QualityDimension; score: number; evidence?: string }

type TaskVariantReport = {
  taskId: string; modelVariantId: string; variantId: string; variantLabel: string
  meanScores: DimensionScore[]; variance: number; meanTokens: number; passRate: number
}

type AblationResult = {
  taskId: string; taskName: string; modelVariantId: string
  variants: TaskVariantReport[]; harnessLift: number; bestVariantId: string
}

type SessionReport = MultiModelReport & {
  sessionId?: string; sessionVersion?: string; gitSha?: string
  ablation?: AblationResult[]
  dimensionSummary?: { dimension: QualityDimension; byVariant: { variantId: string; meanScore: number }[] }[]
  drift?: { hasRegressions: boolean; regressions: { taskId: string; variantId: string; dimension: string; delta: number }[] }
}
```

- [ ] **Step 13.3: Add session detection logic to frontmatter**

After the existing `const { runs } = report` line, add:

```typescript
const sessionReport = rawData as unknown as SessionReport
const hasSession = !!(sessionReport.ablation?.length || sessionReport.dimensionSummary?.length)
const ablation = sessionReport.ablation ?? []
const dimensionSummary = sessionReport.dimensionSummary ?? []

// Ordered variant IDs for column display
const variantOrder = [
  "bare-llm", "manual-react",
  "langchain-react", "vercel-ai-sdk", "openai-agents", "mastra-agent", "llamaindex-ts",
  "ra-reasoning", "ra-full",
]
const variantLabels: Record<string, string> = {
  "bare-llm": "Bare", "manual-react": "Manual",
  "langchain-react": "LC", "vercel-ai-sdk": "Vercel", "openai-agents": "OAI",
  "mastra-agent": "Mastra", "llamaindex-ts": "LlmIdx",
  "ra-reasoning": "RA-R", "ra-full": "RA-Full",
}

function pct(score: number) { return Math.round(score * 100) }
function scoreClass(score: number) {
  return score >= 0.8 ? "text-green-400" : score >= 0.5 ? "text-yellow-400" : "text-red-400"
}
```

- [ ] **Step 13.4: Add harness lift card section**

Find the closing `</div>` of the existing benchmark component and insert before it:

```astro
{hasSession && (
  <div class="mt-10">
    <h2 class="text-lg font-semibold text-violet-400 mb-4">Framework Landscape — Harness Lift</h2>
    {[...new Set(ablation.map(a => a.modelVariantId))].map(modelId => {
      // Average accuracy per variant across all tasks for this model
      const variantAvg = variantOrder.map(vid => {
        const reports = ablation.flatMap(a => a.variants.filter(v => v.variantId === vid && a.modelVariantId === modelId))
        if (!reports.length) return null
        const avg = reports.reduce((s, r) => s + (r.meanScores.find(d => d.dimension === "accuracy")?.score ?? 0), 0) / reports.length
        return { id: vid, label: variantLabels[vid] ?? vid, score: avg }
      }).filter(Boolean) as { id: string; label: string; score: number }[]

      const baseScore = variantAvg.find(v => v.id === "bare-llm")?.score ?? 0
      const fullScore = variantAvg.find(v => v.id === "ra-full")?.score ?? 0

      return (
        <div class="mb-6 p-4 bg-gray-800 rounded-lg border border-gray-700">
          <div class="text-sm text-gray-400 mb-3 font-mono">{modelId}</div>
          {variantAvg.map(v => {
            const barWidth = Math.round(v.score * 100)
            const delta = v.id !== "bare-llm" ? v.score - baseScore : null
            return (
              <div class="flex items-center gap-3 mb-2 text-sm">
                <span class="w-20 text-gray-300 font-mono text-xs">{v.label}</span>
                <div class="flex-1 bg-gray-700 rounded h-5 overflow-hidden">
                  <div class={`h-full rounded ${v.id === "ra-full" ? "bg-violet-500" : v.id.startsWith("ra-") ? "bg-violet-700" : "bg-gray-500"}`}
                       style={`width:${barWidth}%`} />
                </div>
                <span class={`w-10 text-right font-mono ${scoreClass(v.score)}`}>{pct(v.score)}%</span>
                {delta !== null && (
                  <span class={`w-14 text-right font-mono text-xs ${delta >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {delta >= 0 ? "+" : ""}{pct(delta)}pp
                  </span>
                )}
              </div>
            )
          })}
          <div class="mt-3 text-xs text-gray-500">
            Total RA lift: <span class="text-violet-400 font-mono">+{pct(fullScore - baseScore)}pp</span> over bare LLM
          </div>
        </div>
      )
    })}
  </div>
)}
```

- [ ] **Step 13.5: Add per-task ablation table**

After the harness lift card, add:

```astro
{hasSession && ablation.length > 0 && (
  <div class="mt-10">
    <h2 class="text-lg font-semibold text-violet-400 mb-4">Per-Task Ablation</h2>
    <div class="overflow-x-auto">
      <table class="w-full text-xs font-mono border-collapse">
        <thead>
          <tr class="border-b border-gray-600 text-gray-400">
            <th class="text-left py-2 pr-4 w-48">Task</th>
            {variantOrder.map(vid => (
              <th class="text-center px-1 w-12">{variantLabels[vid] ?? vid}</th>
            ))}
            <th class="text-center px-1 w-12">Reli.</th>
            <th class="text-center px-1 w-14">Lift</th>
          </tr>
        </thead>
        <tbody>
          {ablation.filter(a => a.modelVariantId === (ablation[0]?.modelVariantId ?? "")).map(a => {
            const byVariant = Object.fromEntries(a.variants.map(v => [
              v.variantId,
              {
                acc: v.meanScores.find(d => d.dimension === "accuracy")?.score ?? 0,
                rel: v.meanScores.find(d => d.dimension === "reliability")?.score ?? 1,
              }
            ]))
            const raFull = byVariant["ra-full"]
            return (
              <tr class="border-b border-gray-800 hover:bg-gray-800/40">
                <td class="py-1.5 pr-4 text-gray-300 truncate max-w-xs">{a.taskId}</td>
                {variantOrder.map(vid => {
                  const s = byVariant[vid]?.acc
                  return (
                    <td class={`text-center px-1 ${s !== undefined ? scoreClass(s) : "text-gray-600"}`}>
                      {s !== undefined ? pct(s) : "—"}
                    </td>
                  )
                })}
                <td class={`text-center px-1 ${raFull ? scoreClass(raFull.rel) : "text-gray-600"}`}>
                  {raFull ? pct(raFull.rel) : "—"}
                </td>
                <td class={`text-center px-1 font-semibold ${a.harnessLift >= 0 ? "text-violet-400" : "text-red-400"}`}>
                  {a.harnessLift >= 0 ? "+" : ""}{pct(a.harnessLift)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
    <p class="text-xs text-gray-500 mt-2">
      All scores 0–100. Reli. = reliability (1 − stddev across 3 runs). Lift = ra-full minus bare-llm on accuracy.
    </p>
  </div>
)}
```

- [ ] **Step 13.6: Add drift warning banner**

At the very top of the HTML section (before the first `<div>`), add:

```astro
{hasSession && sessionReport.drift?.hasRegressions && (
  <div class="mb-6 p-3 bg-red-900/40 border border-red-700 rounded-lg text-sm text-red-300">
    ⚠ Regressions detected vs. baseline ({sessionReport.drift.regressions.length} dimensions).
    Run <code class="font-mono text-red-200">--save-baseline</code> after reviewing.
  </div>
)}
```

- [ ] **Step 13.7: Verify Astro build compiles**

```bash
cd apps/docs && bun run build 2>&1 | tail -10
```

Expected: build succeeds with no TypeScript errors in BenchmarkResults.astro.

- [ ] **Step 13.8: Commit**

```bash
rtk git add apps/docs/src/components/BenchmarkResults.astro
rtk git commit -m "feat(docs): extend BenchmarkResults with harness lift card, ablation table, drift banner"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task that implements it |
|---|---|
| 10 quality dimensions | Task 1 (types), Task 5 (judge) |
| 9-variant ablation ladder | Task 4 (session.ts) |
| 10 real-world tasks with fixtures | Task 3 |
| Competitor runners (5 frameworks) | Tasks 6–7 |
| Multi-run reliability | Task 5 (computeReliability), Task 9 (aggregateRuns) |
| `runSession()` | Task 9 |
| `BenchmarkSession` config | Tasks 4, 10 |
| 4 pre-built sessions | Task 10 |
| CLI: --session, --runs, --save-baseline, --ci | Task 11 |
| Drift detection / CI gate | Task 8 |
| Docs display: ablation table, lift card | Task 13 |
| Backward compat (existing 26 tasks, runBenchmarks()) | Tasks 2, 12 |
| partialCredit for verifiable tasks | Task 5 |
| `optimalHarnessConfig` on ra-full dispatch | Task 9 |
| openai-agents skips non-OpenAI models | Task 7 |

**Type consistency check:**

- `TaskRunResult` defined in `types.ts` and `competitors/types.ts` — the `competitors/types.ts` version re-uses and re-exports; no duplication. ✓
- `aggregateRuns` accepts `ReadonlyArray<RunScore>` — `RunScore` is from `types.ts`. ✓
- `computeAllAblation` returns `ReadonlyArray<AblationResult>` — both types consistent across tasks 8 and 9. ✓
- `getVariant` throws on unknown ID — session files only call it with IDs present in `ABLATION_VARIANTS`. ✓
- `runner.ts` appends imports at the end — risk of duplicate imports. **Fix:** move all v2 imports to the top of runner.ts during Task 9 step 9.3, not append. The import block shown in Task 9 should be placed at the top of the file, not appended. The rest (functions) appends to the bottom.

**Placeholder scan:** None found.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-19-benchmark-suite-v2.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks

**2. Inline Execution** — execute tasks in this session using executing-plans skill

**Which approach?**
