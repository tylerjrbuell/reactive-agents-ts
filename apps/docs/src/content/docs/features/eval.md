---
title: Evaluation Framework
description: LLM-as-judge scoring, EvalStore persistence, regression detection, and custom dimensions via @reactive-agents/eval.
sidebar:
  order: 10
---

The `@reactive-agents/eval` package provides a structured framework for measuring agent quality. It uses an LLM-as-judge approach to score agent responses across multiple dimensions, persists results to SQLite, and detects regressions between agent versions.

## Quick Start

Define a suite, run it against an agent, and read results:

```typescript
import { EvalService, createEvalLayer } from "@reactive-agents/eval";
import { Effect } from "effect";

// 1. Define an eval suite
const suite = {
  id: "qa-suite-v1",
  name: "Q&A Quality Suite",
  description: "Tests factual accuracy and completeness of agent answers",
  cases: [
    {
      id: "case-001",
      name: "Capital city lookup",
      input: "What is the capital of France?",
      expectedOutput: "Paris",
      tags: ["geography", "factual"],
    },
    {
      id: "case-002",
      name: "Multi-step reasoning",
      input: "If a train travels 120 km in 2 hours, what is its average speed?",
      expectedOutput: "60 km/h",
      expectedBehavior: { maxSteps: 3 },
      tags: ["math", "reasoning"],
    },
  ],
  dimensions: ["accuracy", "relevance", "completeness", "safety"],
};

// 2. Run the suite via EvalService
const program = Effect.gen(function* () {
  const evalService = yield* EvalService;

  const run = yield* evalService.runSuite(suite, "claude-sonnet-4-6");

  console.log(`Passed: ${run.summary.passed}/${run.summary.totalCases}`);
  console.log(`Avg score: ${run.summary.avgScore.toFixed(3)}`);
  console.log(`Avg latency: ${run.summary.avgLatencyMs.toFixed(0)}ms`);
  console.log(`Total cost: $${run.summary.totalCostUsd.toFixed(5)}`);
});

// 3. Provide the eval layer (requires LLMService)
await Effect.runPromise(
  program.pipe(Effect.provide(createEvalLayer()))
);
```

## Scoring Dimensions

Each dimension scores a response from **0.0** (worst) to **1.0** (best). The LLM judge receives the input, the actual agent output, and optionally the expected output, then returns a score.

| Dimension | What It Measures | Function |
|---|---|---|
| `accuracy` | Factual correctness vs. expected output | `scoreAccuracy` |
| `relevance` | How well the response addresses the input | `scoreRelevance` |
| `completeness` | Whether all parts of the request are answered | `scoreCompleteness` |
| `safety` | Absence of harmful, biased, or inappropriate content | `scoreSafety` |
| `cost-efficiency` | Quality per dollar spent (no LLM call required) | `scoreCostEfficiency` |

### Cost-Efficiency Scoring

The cost-efficiency dimension does not call an LLM. It computes quality per dollar using the formula:

```
score = overallQuality / max(costUsd, 0.0001) / 1000
```

A response with quality `1.0` at cost `$0.001` achieves a score of `1.0`. Higher cost or lower quality reduces the score. The result is clamped to `[0.0, 1.0]`.

### Custom Dimensions

Any string not matching the five built-in names is evaluated using a generic LLM-as-judge prompt:

```typescript
const suite = {
  // ...
  dimensions: ["accuracy", "tone", "conciseness"], // "tone" and "conciseness" use generic judge
};
```

The generic judge asks the LLM to score the custom dimension on a 0.0–1.0 scale and returns the parsed value.

### Scoring Individual Cases

Use `runCase` to score a single case with an actual agent output you provide:

```typescript
const result = yield* evalService.runCase(
  evalCase,           // EvalCase
  "claude-sonnet-4-6",         // agentConfig label
  ["accuracy", "relevance"],   // dimensions to score
  "Paris is the capital of France.",  // actualOutput from your agent
  {
    latencyMs: 1200,
    costUsd: 0.00043,
    tokensUsed: 512,
    stepsExecuted: 3,
  },
);

console.log(result.overallScore);   // 0.0–1.0
console.log(result.passed);         // overallScore >= passThreshold
result.scores.forEach(({ dimension, score }) =>
  console.log(`  ${dimension}: ${score.toFixed(3)}`)
);
```

## EvalCase Schema

```typescript
type EvalCase = {
  id: string;                   // Unique identifier for this case
  name: string;                 // Human-readable name
  input: string;                // The prompt sent to the agent
  expectedOutput?: string;      // Reference answer (optional — accuracy uses it if present)
  expectedBehavior?: {
    shouldUseTool?: string;     // Name of a tool the agent should call
    shouldAskUser?: boolean;    // Whether the agent should request clarification
    maxSteps?: number;          // Maximum reasoning steps allowed
    maxCost?: number;           // Maximum cost in USD
  };
  tags?: string[];              // Arbitrary labels for filtering
};
```

`expectedOutput` is optional. When provided, the `accuracy` scorer compares the agent's output against it. When omitted, the scorer evaluates factual correctness in isolation.

## EvalSuite Schema

```typescript
type EvalSuite = {
  id: string;
  name: string;
  description: string;
  cases: EvalCase[];
  dimensions: string[];         // Dimensions to score — built-in or custom
  config?: {
    parallelism?: number;       // Concurrent scoring requests
    timeoutMs?: number;         // Per-case timeout in milliseconds
    retries?: number;           // Retry count on transient failures
  };
};
```

## EvalRun and Results

`runSuite` returns an `EvalRun`:

```typescript
type EvalRun = {
  id: string;           // UUID generated per run
  suiteId: string;
  timestamp: Date;
  agentConfig: string;  // Label passed to runSuite/runCase
  results: EvalResult[];
  summary: EvalRunSummary;
};

type EvalRunSummary = {
  totalCases: number;
  passed: number;                             // overallScore >= passThreshold
  failed: number;
  avgScore: number;                           // Mean overallScore across all cases
  avgLatencyMs: number;
  totalCostUsd: number;
  dimensionAverages: Record<string, number>;  // Per-dimension mean scores
};

type EvalResult = {
  caseId: string;
  timestamp: Date;
  agentConfig: string;
  scores: DimensionScore[];       // One entry per dimension
  overallScore: number;           // Mean of all dimension scores
  actualOutput: string;
  latencyMs: number;
  costUsd: number;
  tokensUsed: number;
  stepsExecuted: number;
  passed: boolean;
  error?: string;
};

type DimensionScore = {
  dimension: string;
  score: number;        // 0.0–1.0
  details?: string;     // Optional explanation from the judge
};
```

## EvalStore — Persistent Results

By default, `EvalServiceLive` stores history in memory. Use `makeEvalServicePersistentLive` (backed by `bun:sqlite`) for durable history across runs:

```typescript
import { makeEvalServicePersistentLive } from "@reactive-agents/eval";
import { Effect } from "effect";

const persistentLayer = makeEvalServicePersistentLive("./eval-history.db");

const program = Effect.gen(function* () {
  const evalService = yield* EvalService;

  // This run is written to eval-history.db
  const run = yield* evalService.runSuite(suite, "agent-v1.2");

  // Load the 10 most recent runs for this suite
  const history = yield* evalService.getHistory("qa-suite-v1", { limit: 10 });
  console.log(`${history.length} past runs loaded`);
});

await Effect.runPromise(
  program.pipe(Effect.provide(persistentLayer))
);
```

### EvalStore Interface

The underlying store exposes four operations:

```typescript
interface EvalStore {
  saveRun(run: EvalRun): Effect.Effect<void>;
  loadHistory(suiteId: string, options?: { limit?: number }): Effect.Effect<readonly EvalRun[]>;
  loadRun(runId: string): Effect.Effect<EvalRun | null>;
  compareRuns(runId1: string, runId2: string): Effect.Effect<{
    improved: string[];
    regressed: string[];
    unchanged: string[];
  } | null>;
}
```

You can also create a store directly and wire it to a custom eval layer:

```typescript
import { createEvalStore, makeEvalServiceLive } from "@reactive-agents/eval";

const store = createEvalStore("./my-evals.db");
const layer = makeEvalServiceLive(store);
```

## Regression Detection

Compare two runs to detect quality regressions between agent versions:

```typescript
const program = Effect.gen(function* () {
  const evalService = yield* EvalService;

  const history = yield* evalService.getHistory("qa-suite-v1", { limit: 2 });
  const [baseline, current] = history;

  // Detailed comparison per dimension (delta threshold: 0.02)
  const diff = yield* evalService.compare(baseline, current);
  // { improved: ["relevance"], regressed: ["accuracy"], unchanged: ["safety", "completeness"] }

  // Binary pass/fail regression check (default threshold: 0.05)
  const regression = yield* evalService.checkRegression(current, baseline);
  if (regression.hasRegression) {
    console.error("Regression detected:");
    regression.details.forEach((d) => console.error(`  ${d}`));
    // accuracy: 0.712 < baseline 0.798 (delta -0.086)
  }
});
```

`compare` classifies each dimension as `improved`, `regressed`, or `unchanged` using a 0.02 delta threshold. `checkRegression` applies the configurable `regressionThreshold` (default: `0.05`) and returns structured details for any dimension that falls below baseline.

## Configuration

`EvalConfig` controls evaluation behaviour. All fields are optional and fall back to `DEFAULT_EVAL_CONFIG`:

```typescript
type EvalConfig = {
  passThreshold?: number;        // Min overallScore to pass a case (default: 0.7)
  regressionThreshold?: number;  // Min drop to count as regression (default: 0.05)
  defaultDimensions?: string[];  // Fallback dimensions (default: ["accuracy","relevance","completeness","safety"])
  parallelism?: number;          // Concurrent LLM scoring calls (default: 3)
  timeoutMs?: number;            // Per-case timeout in ms (default: 30000)
  retries?: number;              // Retry count on failure (default: 1)
};
```

Pass config overrides as the third argument to `runSuite`:

```typescript
yield* evalService.runSuite(suite, "agent-v2", {
  passThreshold: 0.8,
  parallelism: 5,
  timeoutMs: 60_000,
});
```

## Integration Pattern

The typical pattern is to run your agent, capture the output and metrics, then score it with `runCase`:

```typescript
import { ReactiveAgents } from "@reactive-agents/runtime";
import { EvalService, makeEvalServicePersistentLive } from "@reactive-agents/eval";
import { Effect } from "effect";

const evalCase = {
  id: "case-001",
  name: "Capital lookup",
  input: "What is the capital of France?",
  expectedOutput: "Paris",
};

const program = Effect.gen(function* () {
  const evalService = yield* EvalService;

  // Run your agent
  const start = Date.now();
  const agent = await ReactiveAgents.create()
    .withProvider("anthropic")
    .build();
  const agentResult = await agent.run(evalCase.input);

  // Score the output
  const evalResult = yield* evalService.runCase(
    evalCase,
    "claude-sonnet-4-6",
    ["accuracy", "relevance", "completeness", "safety", "cost-efficiency"],
    agentResult.output,
    {
      latencyMs: Date.now() - start,
      costUsd: agentResult.metrics?.costUsd ?? 0,
      tokensUsed: agentResult.metrics?.tokensUsed ?? 0,
      stepsExecuted: agentResult.metrics?.stepsCount ?? 0,
    },
  );

  console.log(`Overall: ${evalResult.overallScore.toFixed(3)} — ${evalResult.passed ? "PASS" : "FAIL"}`);
  evalResult.scores.forEach(({ dimension, score }) =>
    console.log(`  ${dimension}: ${score.toFixed(3)}`)
  );
});

await Effect.runPromise(
  program.pipe(Effect.provide(makeEvalServicePersistentLive()))
);
```

## Layer Factory

`createEvalLayer` provides both `EvalService` and `DatasetService`. It requires `LLMService` from `@reactive-agents/llm-provider` to be in scope:

```typescript
import { createEvalLayer } from "@reactive-agents/eval";

// In-memory (no persistence)
const layer = createEvalLayer();

// Persistent SQLite (recommended for CI)
const persistentLayer = makeEvalServicePersistentLive("./eval-history.db");
```
