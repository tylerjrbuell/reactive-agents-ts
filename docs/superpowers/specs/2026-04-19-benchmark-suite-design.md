# Benchmark Suite v2 Design

**Date:** 2026-04-19  
**Status:** Approved  
**Package:** `packages/benchmarks/`

---

## Problem

The existing benchmark suite (20 tasks, regex-match success, no ablation) measures whether agents produce correct output. It does not measure whether the harness is responsible for that correctness. Without ablation data we cannot answer the questions that matter most:

- How much does the full harness improve over a plain LLM call?
- Which harness layer contributes the most lift?
- Did a code change regress agent performance?
- Can local 4B–14B models solve hard tasks with the harness that they cannot solve without it?

The framework's central claim — that engineering bridges the gap between model tiers — needs evidence to back it. This design produces that evidence.

---

## Goals

1. **Ablation** — run the same task against four harness variants and measure per-layer contribution
2. **Real-world tasks** — 7 hard, domain-diverse tasks that test the harness doing its actual job
3. **Publishable results** — output embeds in the docs site as proof of harness impact
4. **Quality drift detection** — compare runs against stored baselines to catch regressions
5. **Modular sessions** — named, versioned run configs that can be extended or composed
6. **Backward compatible** — existing 20 tasks, `runBenchmarks()`, and `BenchmarkResults.astro` are untouched

---

## Architecture

All changes are additive to `packages/benchmarks/`. No new packages.

```
packages/benchmarks/
  src/
    task-registry.ts          ← RENAMED from tasks.ts; existing 20 tasks unchanged
    tasks/
      real-world.ts           ← NEW: 7 real-world tasks ("real-world" tier)
    session.ts                ← NEW: BenchmarkSession, HarnessVariant, ModelVariant
    runner.ts                 ← EXTENDED: adds runSession() alongside runBenchmarks()
    types.ts                  ← EXTENDED: AblationResult, SessionReport, DriftReport, SuccessCriteria
    judge.ts                  ← NEW: LLM-as-judge scoring (thin wrapper over packages/eval)
    ci.ts                     ← NEW: baseline load/save + drift detection (deferred activation)
    run.ts                    ← EXTENDED: --session, --ablate, --save-baseline, --ci flags
    sessions/
      regression-gate.ts      ← pre-built: fast CI check on existing tasks
      real-world-full.ts      ← pre-built: all 7 real-world tasks, 3 model tiers, full ablation
      local-models.ts         ← pre-built: local Ollama session for development testing

apps/docs/src/components/
  BenchmarkResults.astro      ← EXTENDED: harness lift card + per-task ablation columns
```

### Data flow

```
BenchmarkSession config
        ↓
  runSession()
        ├── for each task × model × harness variant
        │   ├── write fixtures to isolated temp dir
        │   ├── build agent from HarnessConfig
        │   ├── agent.run(task.prompt)
        │   ├── score (regex | bun test | llm-judge | schema)
        │   └── save trace to traceDir (if configured)
        ├── computeAblation() — group variants by task+model, diff scores
        └── checkDrift() — compare to baseline (if --ci)
              ↓
        SessionReport (extends MultiModelReport)
              ↓
  apps/docs/src/data/benchmark-report.json
```

---

## Type System

### Session config

```typescript
// session.ts

export interface BenchmarkSession {
  readonly id: string
  readonly name: string
  readonly version: string
  readonly taskIds?: ReadonlyArray<string>       // filter by ID
  readonly tiers?: ReadonlyArray<Tier>           // or by tier
  readonly tags?: ReadonlyArray<string>          // or by tag
  readonly models: ReadonlyArray<ModelVariant>
  readonly harnessVariants: ReadonlyArray<HarnessVariant>
  readonly traceDir?: string                     // writes JSONL traces if set
  readonly concurrency?: number
  readonly timeoutMs?: number
}

export interface ModelVariant {
  readonly id: string                            // "claude-haiku" | "qwen3-4b" | etc.
  readonly provider: ProviderName
  readonly model: string
  readonly contextTier?: "local" | "standard" | "large" | "frontier"
}

export interface HarnessVariant {
  readonly id: "bare-llm" | "basic-react" | "ra-reasoning" | "ra-full" | string
  readonly label: string
  readonly config: HarnessConfig
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
```

### Four standard ablation variants

These are the canonical four layers. Sessions can use a subset or add custom variants.

```typescript
export const ABLATION_VARIANTS: ReadonlyArray<HarnessVariant> = [
  {
    id: "bare-llm",
    label: "Bare LLM",
    config: {},                                  // single call, no tools, no loop
  },
  {
    id: "basic-react",
    label: "Basic ReAct",
    config: { tools: true },                     // tools + simple loop — what you'd build yourself
  },
  {
    id: "ra-reasoning",
    label: "RA Reasoning",
    config: { tools: true, reasoning: true, adaptiveContext: true },
  },
  {
    id: "ra-full",
    label: "Full Harness",
    config: {
      tools: true,
      reasoning: true,
      reactiveIntelligence: true,
      adaptiveContext: true,
      memory: true,
    },
  },
]
```

Each delta tells a specific story:
- `bare-llm → basic-react`: what tool access alone buys
- `basic-react → ra-reasoning`: what sophisticated strategy and context management add over a naive loop
- `ra-reasoning → ra-full`: what reactive intelligence specifically contributes
- `bare-llm → ra-full`: total harness lift — the headline number

### Extended BenchmarkTask

Fully backward compatible. Existing `expected` regex field continues to work.

```typescript
export type Tier = "trivial" | "simple" | "moderate" | "complex" | "expert" | "real-world"

export type SuccessCriteria =
  | { readonly type: "regex"; readonly pattern: string }
  | { readonly type: "verifiable"; readonly command: string }
  | { readonly type: "llm-judge"; readonly rubric: string; readonly passThreshold?: number }
  | { readonly type: "schema"; readonly schema: Record<string, unknown> }

export interface TaskFixture {
  readonly path: string       // relative path; written to isolated temp dir before run
  readonly content: string
}

export interface BenchmarkTask {
  // existing fields — unchanged
  readonly id: string
  readonly tier: Tier
  readonly name: string
  readonly prompt: string
  readonly expected?: string
  readonly strategy?: "react" | "plan-execute" | "tree-of-thought"
  readonly benchmark?: string
  readonly requiresTools?: boolean
  readonly requiresGuardrails?: boolean
  readonly requiresDynamicSubAgents?: boolean
  readonly maxIterations?: number
  // new fields
  readonly successCriteria?: SuccessCriteria      // overrides expected when present
  readonly fixtures?: ReadonlyArray<TaskFixture>
  readonly optimalHarnessConfig?: HarnessConfig   // ra-full uses this as ceiling
  readonly ablationSensitive?: ReadonlyArray<string>  // which config keys matter here
  readonly domain?: string
  readonly tags?: ReadonlyArray<string>
}
```

`optimalHarnessConfig` is task-appropriate maximal capability. The `ra-full` variant is built by merging `ABLATION_VARIANTS["ra-full"].config` with the task's `optimalHarnessConfig` — the task specifies what tools it needs, the variant flags can only remove capabilities, never add beyond what the task needs.

### Results

```typescript
export interface AblationVariantResult {
  readonly variantId: string
  readonly variantLabel: string
  readonly result: TaskResult
  readonly score: number        // 0–1 always; 1 or 0 for binary; fractional for llm-judge
}

export interface AblationResult {
  readonly taskId: string
  readonly taskName: string
  readonly modelVariantId: string
  readonly variants: ReadonlyArray<AblationVariantResult>
  readonly harnessLift: number  // ra-full score − bare-llm score
  readonly baselineVariantId: string
  readonly bestVariantId: string
}

export interface SessionReport extends MultiModelReport {
  readonly sessionId: string
  readonly sessionVersion: string
  readonly gitSha: string
  readonly ablation?: ReadonlyArray<AblationResult>
  readonly drift?: DriftReport
}

export interface DriftReport {
  readonly baselineSessionId: string
  readonly baselineGitSha: string
  readonly baselineTimestamp: string
  readonly taskDeltas: ReadonlyArray<{
    readonly taskId: string
    readonly variantId: string
    readonly baselineScore: number
    readonly currentScore: number
    readonly delta: number
    readonly direction: "improved" | "regressed" | "unchanged"
  }>
  readonly hasRegression: boolean
  readonly regressionCount: number
  readonly improvementCount: number
}
```

---

## Task Registry

`tasks.ts` is renamed to `task-registry.ts`. It re-exports the existing 20 tasks and the new real-world tier.

```typescript
// task-registry.ts
export { BENCHMARK_TASKS, getTasksByTier } from "./tasks/existing.js"
export { REAL_WORLD_TASKS } from "./tasks/real-world.js"
export const ALL_TASKS = [...BENCHMARK_TASKS, ...REAL_WORLD_TASKS]
```

---

## Real-World Tasks

Seven tasks designed around the principle: **does passing this task prove the harness is doing its job?** Each would fail without the harness and should succeed with it. The harness systems under test are explicit.

---

### `rw-1` — Research Synthesis
**Domain:** research | **Strategy:** plan-execute | **Tools:** web-search

```
Research the top 3 embedded/edge-deployable vector databases with TypeScript support
available in 2025. For each provide: name, license, WASM or browser support (yes/no),
approximate query latency at 100k vectors, and a one-sentence verdict on when to use it.
Output as a JSON array. Use only real databases you can verify exist.
```

- **successCriteria:** `llm-judge` — rubric checks for 3 named real databases, actual license identifiers, a latency figure per entry, valid JSON array structure; score 0 if any database name is fabricated or version numbers are hallucinated
- **ablationSensitive:** `["memory", "adaptiveContext"]` — context management across multiple searches is the primary harness contribution
- **optimalHarnessConfig:** `{ tools: true, reasoning: true, memory: true, adaptiveContext: true, strategy: "plan-execute" }`

---

### `rw-2` — Data Investigation with Red Herring
**Domain:** analysis | **Strategy:** react | **Tools:** file-read, code-execute

```
Analyze the attached sales data. Identify what caused the revenue drop on day 2.
Name the specific cause, quantify the dollar impact, and recommend one concrete fix.
```

**Fixture — `sales-data.csv`:** 3 days of order data, ~300 rows. Day 2 has two anomalies: a promotional discount code applied to all orders (obvious, looks like the cause but accounts for only 12% of the drop) and a specific high-value SKU going out of stock mid-day (real cause, accounts for 88% of the drop). The agent must rule out the red herring.

- **successCriteria:** `llm-judge` — rubric: identifies the out-of-stock SKU as primary cause, quantifies correctly, recommendation targets restocking not promotion removal; score 0 if agent names only the promotion without examining the SKU data
- **ablationSensitive:** `["reasoning", "reactiveIntelligence"]` — iterative hypothesis testing; reactive intelligence should prevent premature convergence on the wrong cause
- **optimalHarnessConfig:** `{ tools: true, reasoning: true, reactiveIntelligence: true, strategy: "react" }`

---

### `rw-3` — Open-Ended Analysis
**Domain:** automation | **Strategy:** plan-execute | **Tools:** file-read, file-write, code-execute

```
Analyze employees.csv and write a report to report.md surfacing whatever you think
is most actionable for leadership. Show your reasoning.
```

**Fixture — `employees.csv`:** 50 rows across 4 departments with salary, tenure, and performance score columns. Engineering department is 40% above company average salary with below-average performance scores — a real signal worth surfacing. No instructions on what to compute or how to structure the report.

- **successCriteria:** `llm-judge` — rubric: report exists, contains a data table, surfaces the Engineering outlier specifically, gives a recommendation grounded in the data; score 0 if report only describes the data without identifying the actionable finding
- **ablationSensitive:** `["reasoning", "reactiveIntelligence"]` — loop detection matters; agents frequently rewrite the file repeatedly without recognising completion
- **optimalHarnessConfig:** `{ tools: true, reasoning: true, reactiveIntelligence: true, strategy: "plan-execute" }`

---

### `rw-4` — API Integration
**Domain:** execution | **Strategy:** react | **Tools:** http-get, file-write, code-execute

```
Using the JSONPlaceholder API at https://jsonplaceholder.typicode.com, fetch all posts
by user ID 3, enrich each post with its comment count by fetching comments, and write
a TypeScript module to output.ts that exports a typed EnrichedPost[] array as a const.
The module must compile without errors.
```

- **successCriteria:** `verifiable` — command: `bun check output.ts` — file must exist and pass type checking
- **ablationSensitive:** `["adaptiveContext", "memory"]` — API shape discovery across multiple http-get calls; context management prevents losing the type schema mid-execution
- **optimalHarnessConfig:** `{ tools: true, reasoning: true, adaptiveContext: true, strategy: "react" }`

---

### `rw-5` — Zero-Downtime Migration Plan
**Domain:** analysis | **Strategy:** tree-of-thought | **Tools:** file-read

```
Given the attached PostgreSQL schema, design a migration to support multi-tenancy via
row-level security. The migration must be executable with zero downtime on a live database.
Produce: (1) 5 specific risks with mitigations, (2) the complete ALTER TABLE and
CREATE POLICY SQL statements in execution order, (3) a downtime estimate with justification.
```

**Fixture — `schema.sql`:** 8-table e-commerce schema (users, orders, products, line_items, addresses, payments, reviews, inventory) with existing foreign keys and indexes. Multi-tenancy introduces real conflicts with existing constraints.

- **successCriteria:** `llm-judge` — rubric: SQL contains `CREATE POLICY` and `ALTER TABLE`, lists 5 distinct risks (not generic), downtime estimate is justified with reference to specific operations (not just "0 minutes"), zero-downtime approach uses a recognised pattern (e.g. expand-contract); score 0 if SQL is syntactically invalid or risks are fabricated without reading the schema
- **maxIterations:** 20
- **ablationSensitive:** `["reasoning", "reactiveIntelligence", "memory"]` — long-horizon context management across phases; tree-of-thought branching to explore migration approaches
- **optimalHarnessConfig:** `{ tools: true, reasoning: true, reactiveIntelligence: true, adaptiveContext: true, memory: true, strategy: "tree-of-thought" }`

---

### `rw-6` — Adversarial Convergence
**Domain:** adversarial | **Strategy:** react | **Tools:** file-read, code-execute

```
Profile and optimize the attached sorting implementation for maximum performance.
Provide specific improvements with before/after benchmarks.
```

**Fixture — `sort.ts`:** A clean, correct O(n log n) merge sort implementation. There is nothing to optimize. The task is designed to be unsolvable as stated — the correct response is to recognize this.

- **successCriteria:** `llm-judge` — rubric is **inverted**: full score if agent identifies the algorithm is already O(n log n), explains why further optimization has diminishing returns on this input class, and stops without rewriting working code; score 0 if agent invents fake bottlenecks, rewrites the algorithm unnecessarily, or fabricates benchmark numbers
- **ablationSensitive:** `["reactiveIntelligence"]` — this task directly tests early-stop via entropy convergence; without reactive intelligence, models loop and fabricate improvements
- **optimalHarnessConfig:** `{ tools: true, reasoning: true, reactiveIntelligence: true, strategy: "react" }`

---

### `rw-7` — Multi-File Debug
**Domain:** execution | **Strategy:** react | **Tools:** file-read, file-write, code-execute

```
The attached TypeScript package has bugs. No test suite is provided. Write tests to
find the bugs, fix all of them, and verify your tests pass. Do not stop until
bun test exits 0.
```

**Fixture — `src/`:** A small TypeScript package (~120 lines across 3 files) with three intentional bugs:
1. A type error in `validator.ts` — catches at compile time but only under a specific call pattern
2. A logic error in `processor.ts` — off-by-one in a filter condition, only manifests on inputs of length > 10
3. An async sequencing bug in `pipeline.ts` — two awaits that should be sequential are running concurrently, causing a race on shared state

- **successCriteria:** `verifiable` — command: `bun test` — the agent's own test suite must pass, and the original logic tests written by the agent must cover all three bug scenarios
- **ablationSensitive:** `["reasoning", "reactiveIntelligence", "adaptiveContext"]` — requires multi-file context management, iterative fix-test cycles, and loop detection to prevent spinning on a fixed bug
- **optimalHarnessConfig:** `{ tools: true, reasoning: true, reactiveIntelligence: true, adaptiveContext: true, strategy: "react" }`

---

## Runner

### `runSession()`

The existing `runBenchmarks()` is untouched. `runSession()` is the new entry point.

```typescript
export async function runSession(
  session: BenchmarkSession,
  outputPath?: string,
): Promise<SessionReport> {
  const tasks = resolveTasks(session)       // by taskId | tier | tags
  const gitSha = await getGitSha()
  const allVariantResults: VariantRunResult[] = []

  for (const task of tasks) {
    for (const model of session.models) {
      const variantResults: AblationVariantResult[] = []

      for (const variant of session.harnessVariants) {
        const tmpDir = await mkdtemp("ra-bench-")
        try {
          await writeFixtures(task.fixtures ?? [], tmpDir)
          const agent = await buildAgent(task, model, variant.config)
          const result = await runWithTimeout(agent, task, tmpDir, session.timeoutMs)
          const score = await scoreResult(result, task, tmpDir)
          if (session.traceDir) await saveTrace(result.runId, session.traceDir)
          variantResults.push({ variantId: variant.id, variantLabel: variant.label, result, score })
        } finally {
          await rm(tmpDir, { recursive: true })
        }
      }

      allVariantResults.push({ task, modelVariantId: model.id, variantResults })
    }
  }

  const ablation = allVariantResults.map(r =>
    computeAblation(r.task, r.modelVariantId, r.variantResults)
  )

  const report = buildSessionReport(session, gitSha, allVariantResults, ablation)
  if (outputPath) await upsertReport(outputPath, report)
  return report
}
```

### Building an agent from HarnessConfig

```typescript
async function buildAgent(
  task: BenchmarkTask,
  model: ModelVariant,
  variantConfig: HarnessConfig,
): Promise<Agent> {
  // ra-full gets task's optimalHarnessConfig; other variants are masked by their flags
  const effective = variantConfig.id === "ra-full" && task.optimalHarnessConfig
    ? mergeConfigs(variantConfig, task.optimalHarnessConfig)
    : variantConfig

  let builder = ReactiveAgents.create()
    .withProvider(model.provider)
    .withModel(model.model)

  if (effective.tools)
    builder = builder.withTools({ include: taskTools(task) })
  if (effective.reasoning)
    builder = builder.withReasoning({
      defaultStrategy: effective.strategy ?? task.strategy ?? "react",
    })
  if (effective.reactiveIntelligence)
    builder = builder.withReactiveIntelligence()
  if (effective.adaptiveContext)
    builder = builder.withContextProfile({ tier: model.contextTier ?? "standard" })
  if (effective.memory)
    builder = builder.withMemory(`bench-${task.id}`)
  if (effective.guardrails)
    builder = builder.withGuardrails()

  return builder
    .withCostTracking({ budget: { maxTokens: 50_000 } })
    .build()
}
```

### Scoring pipeline

```typescript
async function scoreResult(
  result: TaskResult,
  task: BenchmarkTask,
  tmpDir: string,
): Promise<number> {
  if (!task.successCriteria) {
    // backward compat: existing regex logic
    return task.expected && new RegExp(task.expected, "i").test(result.output) ? 1 : 0
  }

  const c = task.successCriteria
  switch (c.type) {
    case "regex":
      return new RegExp(c.pattern, "i").test(result.output) ? 1 : 0

    case "verifiable": {
      const { exitCode } = await $`${c.command}`.cwd(tmpDir).nothrow()
      return exitCode === 0 ? 1 : 0
    }

    case "llm-judge":
      return judge(result.output, c.rubric, c.passThreshold ?? 0.7)

    case "schema":
      return matchesSchema(result.output, c.schema) ? 1 : 0
  }
}
```

### Ablation computation

```typescript
function computeAblation(
  task: BenchmarkTask,
  modelVariantId: string,
  variants: AblationVariantResult[],
): AblationResult {
  const baseline = variants.find(v => v.variantId === "bare-llm")
  const full = variants.find(v => v.variantId === "ra-full")
  const best = variants.reduce((a, b) => b.score > a.score ? b : a)

  return {
    taskId: task.id,
    taskName: task.name,
    modelVariantId,
    variants,
    harnessLift: (full?.score ?? 0) - (baseline?.score ?? 0),
    baselineVariantId: "bare-llm",
    bestVariantId: best.variantId,
  }
}
```

---

## Pre-Built Sessions

### `sessions/regression-gate.ts`

Fast CI check. Runs existing 20 tasks on a single frontier model with full harness only. No ablation, no fixtures. Completes in ~5 minutes.

```typescript
export const regressionGateSession: BenchmarkSession = {
  id: "regression-gate",
  name: "CI Regression Gate",
  version: "1.0.0",
  tiers: ["moderate", "complex", "expert"],
  models: [{ id: "claude-haiku", provider: "anthropic", model: "claude-haiku-4-5", contextTier: "standard" }],
  harnessVariants: [ABLATION_VARIANTS.find(v => v.id === "ra-full")!],
  concurrency: 3,
  timeoutMs: 90_000,
}
```

### `sessions/real-world-full.ts`

Comprehensive ablation benchmark across all 7 real-world tasks and 3 model tiers. The source of publishable evidence. Runs sequentially for stable latency measurement.

```typescript
export const realWorldFullSession: BenchmarkSession = {
  id: "real-world-full",
  name: "Real-World Benchmark Suite",
  version: "1.0.0",
  tiers: ["real-world"],
  models: [
    { id: "claude-haiku", provider: "anthropic", model: "claude-haiku-4-5", contextTier: "standard" },
    { id: "qwen3-4b",     provider: "ollama",    model: "qwen3:4b",         contextTier: "local" },
    { id: "cogito-8b",    provider: "ollama",    model: "cogito:8b",        contextTier: "local" },
  ],
  harnessVariants: ABLATION_VARIANTS,   // all four layers
  traceDir: "benchmark-traces",
  concurrency: 1,
  timeoutMs: 300_000,
}
```

### `sessions/local-models.ts`

Development session for testing harness changes against local Ollama models. Subset of real-world tasks, full ablation, local tier only.

```typescript
export const localModelsSession: BenchmarkSession = {
  id: "local-models",
  name: "Local Model Benchmark",
  version: "1.0.0",
  taskIds: ["rw-2", "rw-3", "rw-6", "rw-7"],   // fastest tasks with clear pass/fail
  models: [
    { id: "qwen3-4b",  provider: "ollama", model: "qwen3:4b",  contextTier: "local" },
    { id: "cogito-8b", provider: "ollama", model: "cogito:8b", contextTier: "local" },
  ],
  harnessVariants: ABLATION_VARIANTS,
  traceDir: "benchmark-traces",
  concurrency: 1,
  timeoutMs: 180_000,
}
```

---

## Docs Display

`BenchmarkResults.astro` gains two additions when `ablation` is present in the report. Existing rendering is untouched.

### Harness lift summary card

Average score per harness variant across all real-world tasks, rendered as a horizontal bar chart with per-layer delta labels. Positioned above the existing task table.

```
┌─ Harness Impact ─────────────────────────────────────────────────┐
│  Average score across 7 real-world tasks                          │
│                                                                   │
│  bare-llm      ████░░░░░░░░░░░░░░░  32%                          │
│  basic-react   ████████░░░░░░░░░░░  51%  +19pp vs bare           │
│  ra-reasoning  ████████████░░░░░░░  64%  +13pp vs basic-react    │
│  ra-full       ████████████████░░░  79%  +15pp vs ra-reasoning   │
│                                                                   │
│  Total harness lift: +47pp  ·  Best local model: qwen3:4b        │
└───────────────────────────────────────────────────────────────────┘
```

### Per-task ablation columns

The existing task table gains per-variant score columns and a drift indicator column. Model tier filter tabs let readers switch between frontier / local views.

```
Task                     │ bare │ react │ ra-r │ full │ lift  │ drift
─────────────────────────┼──────┼───────┼──────┼──────┼───────┼──────
Research synthesis       │ 0.20 │ 0.45  │ 0.62 │ 0.81 │ +0.61 │  —
Data investigation       │ 0.30 │ 0.50  │ 0.65 │ 0.80 │ +0.50 │  ↑
Adversarial convergence  │ 0.10 │ 0.10  │ 0.40 │ 0.85 │ +0.75 │  —
Multi-file debug         │ 0.25 │ 0.55  │ 0.70 │ 0.88 │ +0.63 │  ↓ ⚠
```

Drift indicators: `↑` improved vs baseline, `↓` regressed, `⚠` regression exceeds threshold, `—` unchanged.

---

## CLI

```bash
# Existing usage unchanged
bun run packages/benchmarks/src/run.ts --provider anthropic --model claude-haiku-4-5

# Run a named session
bun run packages/benchmarks/src/run.ts --session real-world-full

# Run with ablation (all four harness variants)
bun run packages/benchmarks/src/run.ts --session real-world-full --ablate \
  --output apps/docs/src/data/benchmark-report.json

# Save current results as baseline for drift detection
bun run packages/benchmarks/src/run.ts --session regression-gate --save-baseline

# CI mode: compare against stored baseline, exit 1 on regression
bun run packages/benchmarks/src/run.ts --session regression-gate --ci
```

---

## CI Integration

Deferred. Infrastructure (`ci.ts`, baseline comparison, `DriftReport`) is built as part of this implementation but the GitHub Actions job is not added until the session results are validated and a reliable baseline is established.

---

## What This Produces

Running `real-world-full` with ablation against frontier + local models generates:

1. **Harness lift per task** — quantified evidence that the framework improves outcomes
2. **Per-layer contribution** — which harness features matter most, for which task types
3. **Local model lift** — evidence for "small models punching above their weight"
4. **Regression baseline** — a stored reference for drift detection on future releases
5. **Trace corpus** — 7 tasks × 3 models × 4 variants = 84 JSONL traces for failure mode analysis
6. **Publishable report** — embedded in docs, shareable as evidence for HN / community

The trace corpus from the first real run is also the raw material for AUC validation (does entropy predict failure?) and for diagnosing which harness systems need the most work.
