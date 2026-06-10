# @reactive-agents/benchmarks

> **Private package — not published to npm.** Internal evaluation suite for the [Reactive Agents](https://docs.reactiveagents.dev/) framework. **v0.10.3**

In-repo benchmark suite that measures real-world agent performance against live LLM providers — latency, token usage, cost, and correctness. Drives the regression gate, ablation matrix, drift detection, and competitor-comparison sessions on `refactor/overhaul`.

The package is `private: true` and is consumed only by in-tree scripts and CI. The v1 surface (`runBenchmarks`, `BENCHMARK_TASKS`) is stable for in-repo callers; the v2 surface (sessions, ablation, drift, real-world tasks) is `@unstable` per `AUDIT-overhaul-2026.md` §11 #15 (verdict DEFER).

## Usage

### Via CLI (rax)

```bash
rax bench --provider anthropic --model claude-sonnet-4-6
rax bench --provider openai     --tiers simple,moderate
rax bench --provider ollama     --model qwen3:14b --tiers trivial,simple
```

### v1 — Programmatic

```typescript
import { runBenchmarks, getTasksByTier, BENCHMARK_TASKS } from "@reactive-agents/benchmarks";

const report = await runBenchmarks({
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  tiers: ["simple", "moderate"],
  timeoutMs: 120_000,
});

console.log(`Passed: ${report.summary.passed}/${report.summary.totalTasks}`);
console.log(`Total tokens: ${report.summary.totalTokens}`);
console.log(`Avg latency: ${report.summary.avgLatencyMs}ms`);

// Filter tasks
const simpleTasks = getTasksByTier("simple"); // BenchmarkTask[]
```

### v2 — Sessions, Ablation, Drift (unstable)

```typescript
import {
  runSession,
  aggregateRuns,
  computeAllAblation,
  summarizeDimensions,
  scoreTask,
  computeDrift,
  loadBaseline,
  saveBaseline,
  REAL_WORLD_TASKS,
  ABLATION_VARIANTS,
  regressionGateSession,
  realWorldFullSession,
  competitorComparisonSession,
  localModelsSession,
} from "@reactive-agents/benchmarks";
```

Sessions describe a full benchmark run (tasks × ablations × judges × drift checks). The `regressionGateSession` is the canonical CI session.

## Tasks

- **20 v1 tasks** across 5 complexity tiers — `trivial`, `simple`, `moderate`, `complex`, `expert`
- **Real-world v2 tasks** — `REAL_WORLD_TASKS` extends the suite with longer-form, multi-step scenarios

## Competitor Runners

`COMPETITOR_RUNNERS` wraps reference implementations from common frameworks for head-to-head comparison: AI SDK, LangChain/LangGraph, Mastra, OpenAI Agents, LlamaIndex. Used by `competitorComparisonSession`.

## Key Features

- **5 complexity tiers** — trivial, simple, moderate, complex, expert
- **Overhead measurement** — `OverheadMeasurement` isolates framework internals from raw LLM latency
- **Multi-model reports** — `MultiModelReport` compares results across providers and models
- **Per-tier breakdown** — pass rate and average latency grouped by complexity
- **Dimensional rubrics** — v2 sessions score on multiple judge dimensions, not just pass/fail
- **Drift detection** — `computeDrift` compares to a saved baseline; `exceedsThreshold` gates CI
- **CLI integration** — `rax bench` with provider, model, and tier filters

## Report Output

Each run produces a `BenchmarkReport` with per-task results and an aggregate summary including total duration, token usage, estimated cost, and pass/fail counts broken down by tier. v2 sessions emit richer reports with per-dimension scores, ablation deltas, and drift summaries.

## Key Exports

### v1 (stable in-repo)

| Export                                                    | Purpose                          |
| --------------------------------------------------------- | -------------------------------- |
| `runBenchmarks`                                           | Top-level v1 runner              |
| `BENCHMARK_TASKS`, `getTasksByTier`                       | Task registry                    |
| `BenchmarkTask`, `TaskResult`, `OverheadMeasurement`, `BenchmarkReport`, `MultiModelReport`, `Tier`, `RunnerOptions` | Schemas + types |

### v2 (unstable)

| Export                                                                                  | Purpose                            |
| --------------------------------------------------------------------------------------- | ---------------------------------- |
| `runSession`, `aggregateRuns`, `computeAllAblation`, `summarizeDimensions`              | Session runner                     |
| `REAL_WORLD_TASKS`, `ABLATION_VARIANTS`, `resolveTasks`, `mergeConfigs`, `getVariant`   | Real-world tasks + ablation matrix |
| `scoreTask`, `computeReliability`, `matchSuccessCriteria`, `parsePartialCreditScore`    | Judging                            |
| `computeDrift`, `exceedsThreshold`, `saveBaseline`, `loadBaseline`                      | Drift detection                    |
| `regressionGateSession`, `realWorldFullSession`, `competitorComparisonSession`, `localModelsSession` | Pre-built sessions       |
| `COMPETITOR_RUNNERS`, `CompetitorRunner`                                                | Competitor framework wrappers      |

## Documentation

- Full docs: [docs.reactiveagents.dev](https://docs.reactiveagents.dev/)
- Benchmarking notes: see `harness-reports/` and `docs/superpowers/debriefs/` for empirical data per release

## License

MIT
