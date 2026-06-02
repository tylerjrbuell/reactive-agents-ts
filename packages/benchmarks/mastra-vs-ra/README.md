# packages/benchmarks/mastra-vs-ra

**Private** head-to-head benchmark: Reactive Agents vs Mastra.

Not published. Not part of release. Used to characterize where each framework wins / falls short before deciding whether to publicize. Lives under `@reactive-agents/benchmarks` (moved from the repo-root `bench/` dir 2026-06-01 to consolidate all competition/benchmark code in one package). It is a standalone runnable (own `package.json`, own `node_modules`), not a workspace member.

## Layout

```
packages/benchmarks/mastra-vs-ra/
  package.json
  tasks.ts        # shared task corpus (10-12 tasks, 6 categories)
  tools.ts        # per-framework tool factories from shared ToolSpec
  verifier.ts    # deterministic output verification (contains-any / contains-all / regex / long-form)
  runner.ts       # matrix runner: tier × task × framework, writes results/*.json + .csv
  smoke-ollama.ts # one-task smoke before full sweep
  results/        # per-run output
```

## Tiers

| id | provider | model | cost per 1M in/out |
|----|----------|-------|--------------------|
| `frontier` | Anthropic | `claude-sonnet-4-6` | $3 / $15 |
| `mini` | OpenAI | `gpt-4o-mini` | $0.15 / $0.60 |
| `local` | Ollama | `qwen3.5:latest` | $0 / $0 |

## Run

```bash
cd packages/benchmarks/mastra-vs-ra
bun install

# Smoke test first
bun smoke-ollama.ts

# Full matrix (all tiers, all tasks, both frameworks)
bun runner.ts

# Subset selection via env
BENCH_TIER=local                  bun runner.ts
BENCH_TIER=mini,local             bun runner.ts
BENCH_TASKS=k1,t1                 bun runner.ts
BENCH_FRAMEWORKS=ra               bun runner.ts
```

## Output

Each run writes:

- `results/cells-<timestamp>.json` — full per-cell records
- `results/cells-<timestamp>.csv` — flat CSV for spreadsheet analysis

Plus a stdout summary table with success rate / tokens / cost / avg duration per (tier, framework).

## Fairness notes

- Both frameworks build a fresh agent per task — no warm cache advantage.
- Tools have identical names, descriptions, parameters, and behaviors across frameworks. Only the framework-native shape differs (RA's `ToolDefinition` + Effect handler vs Mastra's `{ id, inputSchema, execute }`).
- Same model ID across both. Same `maxIterations` / `maxSteps` budget.
- Deterministic verifier — no LLM-as-judge variance (yet). LLM-judge added in v2 only if substring matchers become a bottleneck.
- 180s per-cell timeout. Exceptions are recorded, not retried.
