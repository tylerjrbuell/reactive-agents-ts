# Benchmark Suite v2 Design

**Date:** 2026-04-19  
**Status:** Approved  
**Package:** `packages/benchmarks/`

---

## Problem

The existing benchmark suite (20 tasks, regex-match success, no ablation) answers one question: did the agent produce correct output? It does not answer what matters:

- Is the harness responsible for that correctness, or was it the model?
- Which harness layer contributes the most lift?
- How does the framework compare against LangChain, Mastra, or a developer's own loop?
- Can a local 4B model with the full harness outperform a raw frontier call?
- Did a code change regress any quality dimension — not just accuracy?
- Does the agent maintain memory through context compaction?
- Does it recover from tool failures, or break?
- Is it consistent across runs, or fragile?

Without answers to these, we cannot claim the harness makes agents better — we can only observe that agents with the harness pass tasks. This design produces layered, quantified, publishable evidence across every dimension that defines a high-performing agent.

---

## Goals

1. **Comprehensive quality measurement** — score agents across all 10 dimensions that define great agentic performance, not just task accuracy
2. **Genuine competitor comparison** — benchmark against real LangChain JS and Mastra implementations, not a hobbled internal baseline
3. **Ablation with 5 harness layers** — measure per-layer contribution from raw LLM through full harness
4. **Reliability measurement** — run each task N times, report mean + variance; consistency is a first-class metric
5. **Publishable evidence** — results embed in docs as proof of harness impact across tiers and dimensions
6. **Quality drift detection** — compare against stored baselines to catch regressions before releases
7. **Modular sessions** — named, versioned run configs that compose and extend
8. **Backward compatible** — existing 20 tasks, `runBenchmarks()`, and docs display untouched

---

## The 10 Agent Quality Dimensions

These dimensions define what "a great agent" means concretely. Every task in the suite is scored against the subset of dimensions it exercises. Together the 10 tasks provide full coverage.

| # | Dimension | What it measures |
|---|---|---|
| 1 | **Task Accuracy** | Did it solve the task correctly and completely? |
| 2 | **Reasoning Quality** | Did it think through the problem systematically? Correct hypotheses, sound logic, no non-sequiturs. |
| 3 | **Tool Mastery** | Right tool, right parameters, minimal redundant calls, no hallucinated tool results. |
| 4 | **Memory Fidelity** | Retains critical context across iterations and survives context compaction without losing key constraints. |
| 5 | **Loop Intelligence** | Stops at the right time. Doesn't over-iterate past success or under-iterate before completion. Detects repetition. |
| 6 | **Resilience** | Recovers from tool failures, unexpected inputs, and partial information. Finds fallbacks. Doesn't give up. |
| 7 | **Efficiency** | Accomplishes the task without wasted tokens, redundant searches, or unnecessary iterations. |
| 8 | **Reliability** | Low variance across multiple runs of the same task. Consistent behavior, not luck. |
| 9 | **Scope Discipline** | Delivers the right scope — not under-engineered, not over-engineered. Stays on goal. |
| 10 | **Honest Uncertainty** | Acknowledges limits. States assumptions. Does not hallucinate when uncertain. Asks for clarification when warranted. |

Each task in the suite scores 3–5 of these dimensions. The benchmark report shows per-dimension scores alongside the headline accuracy number.

---

## Architecture

All changes are additive to `packages/benchmarks/`. No new packages.

```
packages/benchmarks/
  src/
    task-registry.ts              ← RENAMED from tasks.ts; existing 20 tasks unchanged
    tasks/
      real-world.ts               ← NEW: 10 comprehensive real-world tasks
    session.ts                    ← NEW: BenchmarkSession, HarnessVariant, CompetitorVariant
    runner.ts                     ← EXTENDED: runSession() + competitor runner dispatch
    types.ts                      ← EXTENDED: multi-dim scoring, competitor variants, reliability
    judge.ts                      ← NEW: per-dimension LLM-as-judge rubrics
    ci.ts                         ← NEW: baseline comparison + drift detection (deferred activation)
    run.ts                        ← EXTENDED CLI: --session, --ablate, --runs, --ci flags
    sessions/
      regression-gate.ts          ← fast CI check on existing tasks
      real-world-full.ts          ← all 10 tasks, 3 model tiers, 5 variants, 3 runs each
      competitor-comparison.ts    ← LangChain + Mastra head-to-head
      local-models.ts             ← local Ollama development session
    competitors/
      langchain-runner.ts         ← NEW: LangChain JS ReAct agent adapter
      mastra-runner.ts            ← NEW: Mastra agent adapter

apps/docs/src/components/
  BenchmarkResults.astro          ← EXTENDED: dimension radar, ablation table, reliability bars
```

### Data flow

```
BenchmarkSession config
        ↓
  runSession()
        ├── for each task × model × variant × run[1..N]
        │   ├── write fixtures to isolated temp dir
        │   ├── dispatch to agent builder (internal) or competitor runner
        │   ├── agent.run(task.prompt)
        │   ├── score each relevant dimension
        │   └── save trace (if traceDir set)
        ├── aggregate: mean + variance per dimension per task+model+variant
        ├── computeAblation() — diff variants, compute harness lift per dimension
        └── checkDrift() — compare to baseline (if --ci)
              ↓
        SessionReport (extends MultiModelReport)
              ↓
  apps/docs/src/data/benchmark-report.json
```

---

## Type System

### Harness variants — 5 canonical layers

```typescript
// session.ts

export const ABLATION_VARIANTS: ReadonlyArray<HarnessVariant> = [
  {
    type: "internal",
    id: "bare-llm",
    label: "Bare LLM",
    config: {},                    // single API call, no tools, no loop
  },
  {
    type: "competitor",
    id: "langchain-react",
    label: "LangChain ReAct",
    framework: "langchain",        // runs via competitors/langchain-runner.ts
  },
  {
    type: "competitor",
    id: "mastra-agent",
    label: "Mastra Agent",
    framework: "mastra",           // runs via competitors/mastra-runner.ts
  },
  {
    type: "internal",
    id: "ra-reasoning",
    label: "RA Reasoning",
    config: { tools: true, reasoning: true, adaptiveContext: true },
  },
  {
    type: "internal",
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
- `bare-llm → langchain-react`: what a battle-tested open-source loop buys over a raw call
- `langchain-react → mastra-agent`: how two established competitors compare
- `mastra-agent → ra-reasoning`: what RA's strategy sophistication adds over competitors
- `ra-reasoning → ra-full`: what reactive intelligence specifically contributes
- `bare-llm → ra-full`: total harness lift — the headline number

### Variant types

```typescript
export type HarnessVariant = InternalVariant | CompetitorVariant

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
  readonly framework: "langchain" | "mastra"
  readonly frameworkConfig?: Record<string, unknown>
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

### Session config

```typescript
export interface BenchmarkSession {
  readonly id: string
  readonly name: string
  readonly version: string
  readonly taskIds?: ReadonlyArray<string>
  readonly tiers?: ReadonlyArray<Tier>
  readonly tags?: ReadonlyArray<string>
  readonly models: ReadonlyArray<ModelVariant>
  readonly harnessVariants: ReadonlyArray<HarnessVariant>
  readonly runs?: number                        // repeat each task N times for reliability; default 1
  readonly traceDir?: string
  readonly concurrency?: number
  readonly timeoutMs?: number
}

export interface ModelVariant {
  readonly id: string
  readonly provider: ProviderName
  readonly model: string
  readonly contextTier?: "local" | "standard" | "large" | "frontier"
}
```

### Multi-dimensional scoring

```typescript
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
  readonly score: number              // 0–1
  readonly evidence?: string          // judge's reasoning (for LLM-judged dims)
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
  // aggregated across runs:
  readonly meanScores: ReadonlyArray<DimensionScore>
  readonly variance: number           // standard deviation of accuracy scores across runs
  readonly meanTokens: number
  readonly meanDurationMs: number
  readonly passRate: number           // fraction of runs where accuracy >= passThreshold
}
```

### Ablation and session results

```typescript
export interface AblationResult {
  readonly taskId: string
  readonly taskName: string
  readonly modelVariantId: string
  readonly variants: ReadonlyArray<TaskVariantReport>
  readonly harnessLift: number        // ra-full accuracy − bare-llm accuracy
  readonly perDimensionLift: ReadonlyArray<{ dimension: QualityDimension; lift: number }>
  readonly bestVariantId: string
  readonly baselineVariantId: string  // "bare-llm"
}

export interface SessionReport extends MultiModelReport {
  readonly sessionId: string
  readonly sessionVersion: string
  readonly gitSha: string
  readonly ablation?: ReadonlyArray<AblationResult>
  readonly dimensionSummary?: ReadonlyArray<{   // average score per dimension across all tasks
    dimension: QualityDimension
    byVariant: ReadonlyArray<{ variantId: string; meanScore: number }>
  }>
  readonly drift?: DriftReport
}
```

### Extended BenchmarkTask

```typescript
export type Tier = "trivial" | "simple" | "moderate" | "complex" | "expert" | "real-world"

export type SuccessCriteria =
  | { readonly type: "regex"; readonly pattern: string }
  | { readonly type: "verifiable"; readonly command: string; readonly partialCredit?: boolean }
  | { readonly type: "llm-judge"; readonly rubric: string; readonly passThreshold?: number }
  | { readonly type: "schema"; readonly schema: Record<string, unknown> }

export interface TaskFixture {
  readonly path: string
  readonly content: string
}

export interface DimensionRubric {
  readonly dimension: QualityDimension
  readonly rubric: string             // prompt given to the judge for this dimension
  readonly weight?: number            // contribution to overall score; default equal weight
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
  readonly successCriteria?: SuccessCriteria
  readonly dimensionRubrics?: ReadonlyArray<DimensionRubric>
  readonly fixtures?: ReadonlyArray<TaskFixture>
  readonly optimalHarnessConfig?: HarnessConfig   // ra-full uses this as ceiling
  readonly primaryDimensions?: ReadonlyArray<QualityDimension>  // which dims this task exercises
  readonly domain?: string
  readonly tags?: ReadonlyArray<string>
}
```

---

## Task Suite — 10 Real-World Tasks

Each task is designed around the principle: **does passing this task prove the harness is doing its job?** Tasks that would pass without the harness are excluded. Primary dimensions and the harness systems under test are explicit for every task.

---

### `rw-1` — Research Synthesis with Source Conflict
**Domain:** research | **Strategy:** plan-execute  
**Primary dimensions:** Accuracy, Reasoning, Honest Uncertainty  
**Tools:** web-search

```
Research the top 3 embedded or edge-deployable vector databases with TypeScript support
available in 2025. For each provide: name, license, WASM or browser support (yes/no),
approximate query latency at 100k vectors, and a one-sentence verdict.

Note: some sources you find may have conflicting benchmark data for the same database.
Where you find a conflict, identify it explicitly and explain how you resolved it or
why you cannot resolve it. Output the final answer as a JSON array.
Use only databases you can verify actually exist.
```

**Fixtures:** none  
**successCriteria:** `llm-judge` — rubric: 3 real database names, actual license identifiers, a latency figure per entry, explicit handling of at least one data conflict, valid JSON array; score 0 if any database is fabricated  
**dimensionRubrics:**
- Accuracy: are the databases real, licenses correct, JSON valid?
- Reasoning: does it form a search plan before executing? Does it synthesize rather than copy-paste?
- Honest Uncertainty: does it flag conflicting data rather than silently pick one source?

**ablationSensitive:** `["memory", "adaptiveContext"]` — context management across multiple searches  
**optimalHarnessConfig:** `{ tools: true, reasoning: true, memory: true, adaptiveContext: true, strategy: "plan-execute" }`

---

### `rw-2` — Data Investigation with Red Herring
**Domain:** analysis | **Strategy:** react  
**Primary dimensions:** Reasoning, Accuracy, Loop Intelligence  
**Tools:** file-read, code-execute

```
Analyze the attached sales data. Identify what caused the revenue drop on day 2.
Name the specific cause, quantify the dollar impact, and recommend one concrete fix.
```

**Fixtures:** `sales-data.csv` — 3 days, ~300 rows. Two anomalies on day 2: (A) a sitewide promotional discount applied to all orders — obvious, looks like the cause, accounts for only 12% of the drop; (B) a specific high-value SKU going out of stock mid-afternoon — the real cause, accounts for 88% of the drop. Agent must rule out the red herring.  
**successCriteria:** `llm-judge` — rubric: identifies out-of-stock SKU as primary cause, quantifies correctly, recommendation targets restocking not promotion removal; score 0 if only the discount is named without examining SKU data  
**dimensionRubrics:**
- Reasoning: does it form multiple hypotheses and eliminate them systematically?
- Accuracy: correct primary cause identified with correct dollar figure?
- Loop Intelligence: does it converge on correct answer without excessive re-examination of already-ruled-out causes?

**ablationSensitive:** `["reasoning", "reactiveIntelligence"]`  
**optimalHarnessConfig:** `{ tools: true, reasoning: true, reactiveIntelligence: true, strategy: "react" }`

---

### `rw-3` — Open-Ended Analysis, No Recipe
**Domain:** automation | **Strategy:** plan-execute  
**Primary dimensions:** Accuracy, Scope Discipline, Reasoning  
**Tools:** file-read, file-write, code-execute

```
Analyze employees.csv and write a report to report.md surfacing whatever you think
is most actionable for leadership. Show your reasoning.
```

**Fixtures:** `employees.csv` — 50 rows, 4 departments, salary + tenure + performance score columns. Engineering dept: 40% above company salary average, below-average performance scores. No instructions on what to compute or how to format.  
**successCriteria:** `llm-judge` — rubric: report.md exists, contains a data table, surfaces Engineering outlier, gives a recommendation grounded in data; score 0 if report only describes data without identifying the actionable finding  
**dimensionRubrics:**
- Scope Discipline: does it deliver a focused, actionable report without scope creep? Does it avoid over-engineering (charts, graphs, statistical tests) when a table and paragraph suffice?
- Reasoning: does its analysis logic lead correctly from data to recommendation?
- Accuracy: is the finding about Engineering correct and quantified?

**ablationSensitive:** `["reasoning", "reactiveIntelligence"]` — loop detection prevents repeated file rewrites  
**optimalHarnessConfig:** `{ tools: true, reasoning: true, reactiveIntelligence: true, strategy: "plan-execute" }`

---

### `rw-4` — API Integration with Type Safety
**Domain:** execution | **Strategy:** react  
**Primary dimensions:** Tool Mastery, Accuracy, Efficiency  
**Tools:** http-get, file-write, code-execute

```
Using the JSONPlaceholder API at https://jsonplaceholder.typicode.com, fetch all posts
by user ID 3, enrich each post with its comment count, and write a TypeScript module
to output.ts that exports a typed EnrichedPost[] array as a const. The module must
compile without errors.
```

**successCriteria:** `verifiable` — command: `bun check output.ts`  
**dimensionRubrics:**
- Tool Mastery: does it use http-get correctly? Does it avoid redundant API calls (fetching comments it already has)?
- Accuracy: does the TypeScript type correctly model the API response? Does it compile?
- Efficiency: how many http-get calls does it make relative to the minimum required?

**ablationSensitive:** `["adaptiveContext", "memory"]`  
**optimalHarnessConfig:** `{ tools: true, reasoning: true, adaptiveContext: true, strategy: "react" }`

---

### `rw-5` — Zero-Downtime Migration Plan
**Domain:** planning | **Strategy:** tree-of-thought  
**Primary dimensions:** Reasoning, Memory Fidelity, Accuracy  
**Tools:** file-read

```
Given the attached PostgreSQL schema, design a migration to support multi-tenancy via
row-level security. The migration must be executable with zero downtime on a live database.
Produce: (1) 5 specific risks with mitigations, (2) the complete ALTER TABLE and CREATE
POLICY SQL statements in execution order, (3) a downtime estimate with justification.
```

**Fixtures:** `schema.sql` — 8-table e-commerce schema (users, orders, products, line_items, addresses, payments, reviews, inventory) with foreign keys and indexes that create real RLS conflicts  
**successCriteria:** `llm-judge` — rubric: SQL contains `CREATE POLICY` and valid `ALTER TABLE`, 5 distinct schema-specific risks (not generic), downtime estimate justified with specific operations referenced, zero-downtime approach uses a recognised pattern; score 0 if SQL is syntactically invalid or risks are generic  
**dimensionRubrics:**
- Reasoning: does it explore multiple migration approaches before settling? Does it identify real conflicts in the schema?
- Memory Fidelity: does it maintain the zero-downtime constraint consistently throughout all SQL statements, not just in the introduction?
- Accuracy: are the SQL statements syntactically valid and logically correct for the given schema?

**maxIterations:** 20  
**ablationSensitive:** `["reasoning", "reactiveIntelligence", "memory"]`  
**optimalHarnessConfig:** `{ tools: true, reasoning: true, reactiveIntelligence: true, adaptiveContext: true, memory: true, strategy: "tree-of-thought" }`

---

### `rw-6` — Adversarial Convergence
**Domain:** adversarial | **Strategy:** react  
**Primary dimensions:** Loop Intelligence, Honest Uncertainty, Efficiency  
**Tools:** file-read, code-execute

```
Profile and optimize the attached sorting implementation for maximum performance.
Provide specific improvements with before/after benchmarks.
```

**Fixtures:** `sort.ts` — clean, correct O(n log n) merge sort. Nothing to optimize.  
**successCriteria:** `llm-judge` — **inverted rubric**: full score if agent correctly identifies the algorithm is already O(n log n), explains why further optimization yields diminishing returns, and stops without rewriting working code; score 0 if it invents fake bottlenecks, rewrites unnecessarily, or fabricates benchmark numbers  
**dimensionRubrics:**
- Loop Intelligence: does it stop after one or two analytical passes? Does it avoid running the same profiling code repeatedly?
- Honest Uncertainty: does it explicitly state that no meaningful optimization exists, rather than hedging or inventing minor changes?
- Efficiency: does it reach the correct conclusion in minimal iterations?

**ablationSensitive:** `["reactiveIntelligence"]` — early-stop via entropy convergence is the primary harness contribution  
**optimalHarnessConfig:** `{ tools: true, reasoning: true, reactiveIntelligence: true, strategy: "react" }`

---

### `rw-7` — Multi-File Debug, No Test Suite
**Domain:** execution | **Strategy:** react  
**Primary dimensions:** Tool Mastery, Resilience, Accuracy  
**Tools:** file-read, file-write, code-execute

```
The attached TypeScript package has bugs. No test suite is provided. Write tests to
find the bugs, fix all of them, and verify your tests pass. Do not stop until
bun test exits 0.
```

**Fixtures:** `src/` — small TypeScript package (~120 lines, 3 files) with three intentional bugs:
1. `validator.ts` — a type error that only manifests under a specific call pattern
2. `processor.ts` — off-by-one in a filter condition, only triggers on inputs of length > 10
3. `pipeline.ts` — two awaits that should be sequential run concurrently, causing a race on shared state

**successCriteria:** `verifiable` — command: `bun test`, `partialCredit: true` — count passing test files  
**dimensionRubrics:**
- Tool Mastery: does it use code-execute correctly to find failures rather than guessing? Does it avoid rerunning tests it already knows the result of?
- Resilience: when its first fix attempt doesn't fully solve a bug, does it adapt rather than repeating the same fix?
- Accuracy: are all three bugs found and fixed, with tests that would catch regression?

**ablationSensitive:** `["reasoning", "reactiveIntelligence", "adaptiveContext"]`  
**optimalHarnessConfig:** `{ tools: true, reasoning: true, reactiveIntelligence: true, adaptiveContext: true, strategy: "react" }`

---

### `rw-8` — Memory Under Compaction Pressure
**Domain:** memory | **Strategy:** plan-execute  
**Primary dimensions:** Memory Fidelity, Reliability, Accuracy  
**Tools:** file-read, file-write, code-execute

```
You are building a data processing pipeline in 5 phases. Phase 1 establishes the
constraints that all subsequent phases must satisfy. Complete all 5 phases in order.

PHASE 1 CONSTRAINT (remember this for all phases):
- All monetary values must use integer cents, never floating-point dollars
- All timestamps must be Unix epoch milliseconds, never ISO strings
- All IDs must be prefixed with the entity type: "user_", "order_", "product_"

Now complete the following phases using these constraints:
Phase 2: Write a TypeScript type definition file (types.ts) for User, Order, Product
Phase 3: Write a data generator (generate.ts) that creates 5 sample records of each type
Phase 4: Write a validator (validate.ts) that checks all constraints are met
Phase 5: Run the validator against the generated data and report results
```

**successCriteria:** `verifiable` — command: checks that types.ts, generate.ts, validate.ts exist and that running `bun run generate.ts && bun run validate.ts` exits 0  
**dimensionRubrics:**
- Memory Fidelity: do all generated files consistently use integer cents (not dollars), epoch milliseconds (not ISO strings), and prefixed IDs? Violations in any phase indicate memory loss of the Phase 1 constraint.
- Reliability: does it complete all 5 phases consistently across runs without drifting on the constraints?
- Accuracy: does the validator correctly detect violations?

**maxIterations:** 25  
**ablationSensitive:** `["memory", "adaptiveContext"]` — this task is specifically designed to fail without memory; the constraint must survive at least one context compaction  
**optimalHarnessConfig:** `{ tools: true, reasoning: true, adaptiveContext: true, memory: true, strategy: "plan-execute" }`

---

### `rw-9` — Resilience Under Tool Failure
**Domain:** resilience | **Strategy:** react  
**Primary dimensions:** Resilience, Tool Mastery, Accuracy  
**Tools:** http-get, file-read, file-write

```
Fetch today's cryptocurrency prices for BTC, ETH, and SOL from the CoinGecko API
and write a summary to prices.md with current price, 24h change, and market cap.
The API endpoint is: https://api.coingecko.com/api/v3/simple/price
```

**Runtime behavior:** The test harness wraps `http-get` to return HTTP 503 on the first two attempts, then succeeds on the third. Additionally, `fallback-prices.json` is written to the fixture directory — a static snapshot agents can discover via `file-read` if they look for fallback data.  
**successCriteria:** `llm-judge` — rubric: prices.md exists with prices for all 3 assets and a 24h change figure; accepts either live data or a clearly-labeled fallback snapshot  
**dimensionRubrics:**
- Resilience: does it retry after 503? Does it find and use the fallback file if retries fail? Does it complete the task despite the failures?
- Tool Mastery: does it correctly interpret the 503 error and understand it should retry vs. accept failure?
- Accuracy: does prices.md contain correct structure with all 3 assets?

**ablationSensitive:** `["reactiveIntelligence", "reasoning"]`  
**optimalHarnessConfig:** `{ tools: true, reasoning: true, reactiveIntelligence: true, strategy: "react" }`

---

### `rw-10` — Ambiguous Requirements, Scope Under Pressure
**Domain:** adversarial | **Strategy:** react  
**Primary dimensions:** Honest Uncertainty, Scope Discipline, Reasoning  
**Tools:** file-write

```
Our user onboarding is underperforming. Improve it.

Here is everything we have: users sign up, confirm email, and are shown a dashboard.
Drop-off is 40% between signup and dashboard. Fix this.
```

**Fixtures:** none — the requirements are intentionally incomplete  
**successCriteria:** `llm-judge` — rubric: agent either (A) explicitly states 2+ assumptions it must make due to missing context before proceeding, OR (B) asks targeted clarifying questions that would unlock a real solution, AND produces a deliverable that is scoped to what the information supports. Score 0 if agent invents specific metrics, A/B test results, or user research it was not given, or produces a 10-page strategy document for a 2-sentence brief.  
**dimensionRubrics:**
- Honest Uncertainty: does it acknowledge what it doesn't know (stack, platform, user type, actual drop-off reason) rather than assuming?
- Scope Discipline: is the output proportional to the information provided? Does it resist the urge to over-deliver?
- Reasoning: if it makes assumptions, are they reasonable and explicitly stated?

**ablationSensitive:** `["reactiveIntelligence", "reasoning"]`  
**optimalHarnessConfig:** `{ tools: true, reasoning: true, reactiveIntelligence: true, strategy: "react" }`

---

## Competitor Runner Interface

LangChain and Mastra runners implement a shared interface so the session runner dispatches them identically to internal variants.

```typescript
// competitors/types.ts

export interface CompetitorRunner {
  readonly id: string
  readonly label: string
  run(
    task: BenchmarkTask,
    model: ModelVariant,
    tmpDir: string,
    timeoutMs: number,
  ): Promise<TaskResult>
}
```

```typescript
// competitors/langchain-runner.ts
// Uses: @langchain/core, @langchain/openai, @langchain/community (dev deps)

export const langchainRunner: CompetitorRunner = {
  id: "langchain-react",
  label: "LangChain ReAct",
  async run(task, model, tmpDir, timeoutMs) {
    // createReactAgent with same tools mapped to LangChain tool format
    // same model via ChatOpenAI / ChatAnthropic
    // run task.prompt, collect output, return TaskResult
  },
}
```

```typescript
// competitors/mastra-runner.ts
// Uses: @mastra/core (dev dep)

export const mastraRunner: CompetitorRunner = {
  id: "mastra-agent",
  label: "Mastra Agent",
  async run(task, model, tmpDir, timeoutMs) {
    // Mastra Agent with same tools and model
    // run task.prompt, collect output, return TaskResult
  },
}
```

Competitor runners get the same task prompt, same model and API key, same tools (mapped to their framework's tool format), and the same timeout. The comparison is purely about what the framework adds, not model or tool access differences.

---

## Scoring Model

### Per-dimension scoring

Each task declares which dimensions it exercises via `primaryDimensions` and provides rubrics via `dimensionRubrics`. The judge evaluates each dimension independently.

```typescript
// judge.ts

export async function scoreTask(
  output: string,
  task: BenchmarkTask,
  tmpDir: string,
  runTokens: number,
  runIterations: number,
): Promise<ReadonlyArray<DimensionScore>>

// Accuracy: handled by successCriteria (regex | verifiable | llm-judge)
// Efficiency: computed from runTokens vs. task's expectedMinTokens estimate
// Reliability: computed from variance across runs (not per-run — session-level aggregation)
// All others: LLM-as-judge using task's dimensionRubrics
```

### Partial credit for verifiable tasks

When `successCriteria.type === "verifiable"` and `partialCredit: true`, the runner parses test output to count passing tests and returns a fractional score. A task with 3 bugs where the agent fixes 2 scores 0.67, not 0.

### Reliability as a first-class metric

```typescript
function computeReliability(runs: ReadonlyArray<RunScore>): number {
  if (runs.length < 2) return 1  // single run: no variance data
  const scores = runs.map(r => r.dimensions.find(d => d.dimension === "accuracy")?.score ?? 0)
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length
  const variance = scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length
  return 1 - Math.sqrt(variance)  // 1 = perfectly consistent, 0 = completely random
}
```

---

## Runner

### `runSession()`

```typescript
export async function runSession(
  session: BenchmarkSession,
  outputPath?: string,
): Promise<SessionReport> {
  const tasks = resolveTasks(session)
  const gitSha = await getGitSha()
  const taskVariantReports: TaskVariantReport[] = []

  for (const task of tasks) {
    for (const model of session.models) {
      for (const variant of session.harnessVariants) {
        const runScores: RunScore[] = []
        const runCount = session.runs ?? 1

        for (let i = 0; i < runCount; i++) {
          const tmpDir = await mkdtemp("ra-bench-")
          try {
            await writeFixtures(task.fixtures ?? [], tmpDir)
            const result = await dispatch(task, model, variant, tmpDir, session.timeoutMs)
            const dimensions = await scoreTask(result.output, task, tmpDir, result.tokensUsed, result.iterations)
            if (session.traceDir) await saveTrace(result.runId, session.traceDir)
            runScores.push({ runIndex: i, dimensions, ...result })
          } finally {
            await rm(tmpDir, { recursive: true })
          }
        }

        taskVariantReports.push(aggregateRuns(task, model.id, variant, runScores))
      }
    }
  }

  const ablation = computeAllAblation(taskVariantReports)
  const dimensionSummary = summarizeDimensions(taskVariantReports)
  const report = buildSessionReport(session, gitSha, taskVariantReports, ablation, dimensionSummary)

  if (outputPath) await upsertReport(outputPath, report)
  return report
}
```

### Agent dispatch

```typescript
async function dispatch(
  task: BenchmarkTask,
  model: ModelVariant,
  variant: HarnessVariant,
  tmpDir: string,
  timeoutMs = 120_000,
): Promise<TaskResult> {
  if (variant.type === "competitor") {
    const runner = COMPETITOR_RUNNERS[variant.framework]
    return runWithTimeout(() => runner.run(task, model, tmpDir, timeoutMs), timeoutMs)
  }

  // internal variant
  const effective = variant.id === "ra-full" && task.optimalHarnessConfig
    ? mergeConfigs(variant.config, task.optimalHarnessConfig)
    : variant.config

  const agent = await buildAgent(task, model, effective)
  return runWithTimeout(() => runAgent(agent, task, tmpDir), timeoutMs)
}
```

---

## Pre-Built Sessions

### `sessions/regression-gate.ts`

Fast CI check. Existing 20 tasks, frontier model, full harness only, single run. ~5 minutes.

```typescript
export const regressionGateSession: BenchmarkSession = {
  id: "regression-gate",
  name: "CI Regression Gate",
  version: "1.0.0",
  tiers: ["moderate", "complex", "expert"],
  models: [{ id: "claude-haiku", provider: "anthropic", model: "claude-haiku-4-5", contextTier: "standard" }],
  harnessVariants: [ABLATION_VARIANTS.find(v => v.id === "ra-full")!],
  runs: 1,
  concurrency: 3,
  timeoutMs: 90_000,
}
```

### `sessions/real-world-full.ts`

Full evidence session. All 10 real-world tasks × 3 model tiers × 5 ablation variants × 3 runs. The source of publishable results.

```typescript
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
  harnessVariants: ABLATION_VARIANTS,
  runs: 3,
  traceDir: "benchmark-traces",
  concurrency: 1,
  timeoutMs: 300_000,
}
```

### `sessions/competitor-comparison.ts`

Head-to-head comparison. Subset of tasks that expose the biggest differentiation points.

```typescript
export const competitorComparisonSession: BenchmarkSession = {
  id: "competitor-comparison",
  name: "Competitor Head-to-Head",
  version: "1.0.0",
  taskIds: ["rw-1", "rw-2", "rw-7", "rw-8", "rw-9"],  // research, reasoning, debug, memory, resilience
  models: [
    { id: "claude-haiku", provider: "anthropic", model: "claude-haiku-4-5", contextTier: "standard" },
  ],
  harnessVariants: ABLATION_VARIANTS,  // includes langchain-react and mastra-agent
  runs: 3,
  traceDir: "benchmark-traces",
  concurrency: 1,
  timeoutMs: 180_000,
}
```

### `sessions/local-models.ts`

Development session for testing harness changes against local Ollama models.

```typescript
export const localModelsSession: BenchmarkSession = {
  id: "local-models",
  name: "Local Model Benchmark",
  version: "1.0.0",
  taskIds: ["rw-2", "rw-3", "rw-6", "rw-8", "rw-9"],
  models: [
    { id: "qwen3-4b",  provider: "ollama", model: "qwen3:4b",  contextTier: "local" },
    { id: "cogito-8b", provider: "ollama", model: "cogito:8b", contextTier: "local" },
  ],
  harnessVariants: [
    ABLATION_VARIANTS.find(v => v.id === "bare-llm")!,
    ABLATION_VARIANTS.find(v => v.id === "ra-full")!,
  ],
  runs: 3,
  traceDir: "benchmark-traces",
  concurrency: 1,
  timeoutMs: 180_000,
}
```

---

## Docs Display

### Dimension radar chart

A spider/radar chart showing mean score per dimension for each variant. Renders when `dimensionSummary` is present. One chart per model tier.

```
              Task Accuracy
                  1.0
                  │
    Reasoning  ───┼───  Tool Mastery
              /   │   \
             /    │    \
 Honest   ──┤     │     ├──  Memory
 Uncertainty \    │    /
              \   │   /
    Scope  ───┼───┴───┼───  Loop Intel
    Discipline  0.0    Resilience

  ── bare-llm    ·· langchain    ── ra-full
```

### Harness lift summary card

```
┌─ Harness Impact — Real-World Tasks ────────────────────────────────┐
│  Average accuracy across 10 tasks                                   │
│                                                                     │
│  bare-llm       ████░░░░░░░░░░░░░░░  28%                           │
│  langchain-react ███████░░░░░░░░░░░  46%  +18pp                    │
│  mastra-agent   ████████░░░░░░░░░░░  51%  +5pp                     │
│  ra-reasoning   ████████████░░░░░░░  65%  +14pp                    │
│  ra-full        ████████████████░░░  81%  +16pp                    │
│                                                                     │
│  Total RA lift: +53pp over bare-llm · +35pp over best competitor   │
└─────────────────────────────────────────────────────────────────────┘
```

### Per-task ablation table

Columns: variant scores + reliability (variance) + drift vs baseline.

```
Task                    │ bare │ lc  │ ma  │ ra-r │ full │ reli │ lift  │ drift
────────────────────────┼──────┼─────┼─────┼──────┼──────┼──────┼───────┼──────
Research synthesis      │ 0.20 │ 0.48│ 0.52│ 0.64 │ 0.82 │ 0.91 │ +0.62 │  —
Memory under pressure   │ 0.05 │ 0.18│ 0.22│ 0.45 │ 0.88 │ 0.95 │ +0.83 │  ↑
Adversarial convergence │ 0.10 │ 0.12│ 0.15│ 0.42 │ 0.87 │ 0.89 │ +0.77 │  —
Resilience under failure│ 0.15 │ 0.40│ 0.45│ 0.62 │ 0.85 │ 0.92 │ +0.70 │  ↓ ⚠
```

Reliability column: 1.0 = perfectly consistent across 3 runs, 0.0 = random. Drift: `↑` improved, `↓` regressed, `⚠` exceeds threshold.

---

## CLI

```bash
# Existing usage — unchanged
bun run packages/benchmarks/src/run.ts --provider anthropic --model claude-haiku-4-5

# Named session with all variants
bun run packages/benchmarks/src/run.ts --session real-world-full \
  --output apps/docs/src/data/benchmark-report.json

# Competitor head-to-head
bun run packages/benchmarks/src/run.ts --session competitor-comparison

# Run each task 3 times for reliability data
bun run packages/benchmarks/src/run.ts --session local-models --runs 3

# Save baseline for drift detection
bun run packages/benchmarks/src/run.ts --session regression-gate --save-baseline

# CI regression gate
bun run packages/benchmarks/src/run.ts --session regression-gate --ci
```

---

## CI Integration

Deferred. The `ci.ts` module and `DriftReport` type are implemented as part of this work but the GitHub Actions job is not added until a reliable baseline is established from real runs. Infrastructure is ready to activate.

---

## Coverage Map

| Dimension | Tasks that score it |
|---|---|
| Task Accuracy | All 10 |
| Reasoning Quality | rw-1, rw-2, rw-5, rw-10 |
| Tool Mastery | rw-4, rw-7, rw-9 |
| Memory Fidelity | rw-5, rw-8 |
| Loop Intelligence | rw-2, rw-6 |
| Resilience | rw-7, rw-9 |
| Efficiency | rw-4, rw-6 |
| Reliability | All (via multi-run variance) |
| Scope Discipline | rw-3, rw-10 |
| Honest Uncertainty | rw-1, rw-6, rw-10 |

Every dimension is covered by at least 2 tasks. No dimension is tested by only one task.

---

## What This Produces

Running `real-world-full` generates:

1. **Per-dimension scores** — quantified evidence across all 10 quality dimensions, not just accuracy
2. **Competitor comparison** — RA vs. LangChain vs. Mastra on the same tasks, same models
3. **Per-layer ablation** — which harness features contribute the most lift and on which dimensions
4. **Local model lift** — evidence that 4B models with the full harness outperform raw frontier calls on specific task classes
5. **Reliability data** — variance across 3 runs reveals fragility that accuracy alone hides
6. **Trace corpus** — 10 tasks × 3 models × 5 variants × 3 runs = 450 JSONL traces for failure mode analysis and AUC validation
7. **Regression baseline** — a stored reference for drift detection on future releases
8. **Publishable report** — embedded in docs, sharable as community evidence

The trace corpus from the first real run also directly addresses the open AUC validation issue: 450 traces including runs that will fail (bare-llm on hard tasks) gives the entropy predictor the failure corpus it needs.
