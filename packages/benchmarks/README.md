# @reactive-agents/benchmarks

Benchmark suite for the [Reactive Agents](https://docs.reactiveagents.dev/) framework.

20 tasks across 5 complexity tiers (trivial, simple, moderate, complex, expert) that measure real-world agent performance — latency, token usage, cost, and correctness — against live LLM providers.

## Installation

```bash
bun add @reactive-agents/benchmarks
```

## Usage

### Via CLI

```bash
rax bench --provider anthropic --model claude-sonnet-4-20250514
rax bench --provider openai --tiers simple,moderate
```

### Programmatic

```typescript
import { runBenchmarks, getTasksByTier } from "@reactive-agents/benchmarks";

const report = await runBenchmarks({
  provider: "anthropic",
  model: "claude-sonnet-4-20250514",
  tiers: ["simple", "moderate"],
  timeoutMs: 120_000,
});

console.log(`Passed: ${report.summary.passed}/${report.summary.totalTasks}`);
console.log(`Total tokens: ${report.summary.totalTokens}`);
console.log(`Avg latency: ${report.summary.avgLatencyMs}ms`);
```

### Filter Tasks

```typescript
import { BENCHMARK_TASKS, getTasksByTier } from "@reactive-agents/benchmarks";

const simpleTasks = getTasksByTier("simple");
// Returns BenchmarkTask[] for the "simple" tier
```

## Key Features

- **5 complexity tiers** — trivial, simple, moderate, complex, expert
- **20 benchmark tasks** — covering reasoning, tool use, and multi-step workflows
- **Overhead measurement** — isolates framework internals from LLM latency
- **Multi-model reports** — compare results across providers and models
- **Per-tier breakdown** — pass rate and average latency grouped by complexity
- **CLI integration** — run benchmarks via `rax bench` with filtering options

## Report Output

Each run produces a `BenchmarkReport` with per-task results and an aggregate summary including total duration, token usage, estimated cost, and pass/fail counts broken down by tier.

## Documentation

Full documentation at [docs.reactiveagents.dev](https://docs.reactiveagents.dev/)

## License

MIT
