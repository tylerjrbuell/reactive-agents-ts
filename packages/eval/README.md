# @reactive-agents/eval

Evaluation framework for [Reactive Agents](https://docs.reactiveagents.dev/) — benchmark agent quality, track regressions, and run automated test suites against an isolated frozen judge. **v0.10.2**

## Installation

```bash
bun add @reactive-agents/eval
```

## Features

- **5-dimension scoring** — `accuracy`, `relevance`, `completeness`, `safety`, `cost-efficiency`
- **LLM-as-judge** — judge runs through `JudgeLLMService`, a tag isolated from the system-under-test (Rule 4: judge MUST differ from SUT)
- **Evaluation suites** — `EvalSuite` describes cases + dimensions + suite metadata
- **SQLite persistence** — `createEvalStore` for run history, regression diffs, comparison reports
- **Dataset loader** — `DatasetService` for sharing evaluation corpora across suites
- **CLI integration** — `rax eval` runs suites and writes reports

## Suite Runner Contract

`runSuite(suite, agentConfig, agentRunner, config?)` requires three things:

- **`suite`** — cases + dimensions + suite metadata (`EvalSuite`)
- **`agentConfig`** — string identifying the system under test (used in result records and the Rule-4 guard)
- **`agentRunner`** — caller-supplied function that invokes YOUR agent and returns its output + metrics. Pre-W6.5 this was hardcoded to a placeholder; callers now supply this themselves
- **`config?`** — optional `EvalConfig`, including the judge model selection (must differ from the SUT)

```typescript
import {
  EvalService,
  createEvalLayer,
  type SuiteAgentRunner,
} from "@reactive-agents/eval";
import { Effect } from "effect";

// Caller-supplied SUT runner. This invokes YOUR agent. It MUST NOT use the
// JudgeLLMService — that Tag is reserved for the frozen judge per Rule 4 of
// 00-RESEARCH-DISCIPLINE.md. Use LLMService or your agent builder layer here.
const myAgentRunner: SuiteAgentRunner = (input) =>
  Effect.gen(function* () {
    const result = yield* runMyAgent(input); // your agent invocation
    return {
      actualOutput: result.output,
      metrics: {
        latencyMs: result.elapsedMs,
        tokensUsed: result.tokens,
        costUsd: result.costUsd,
      },
    };
  });

const program = Effect.gen(function* () {
  const evalService = yield* EvalService;

  const run = yield* evalService.runSuite(
    {
      id: "qa-benchmark",
      name: "QA Benchmark",
      dimensions: ["accuracy", "relevance"],
      cases: [
        { id: "q1", input: "What is the capital of France?", expectedOutput: "Paris" },
        { id: "q2", input: "Who wrote 'The Great Gatsby'?", expectedOutput: "F. Scott Fitzgerald" },
      ],
    },
    "anthropic/claude-sonnet-4-20250514",      // SUT identifier
    myAgentRunner,
    {
      judge: {
        model: "claude-haiku-4-5-20251001",     // judge MUST differ from SUT
        provider: "anthropic",
      },
    },
  );

  console.log(`avgScore: ${run.summary.avgScore}, passed: ${run.summary.passed}/${run.summary.totalCases}`);
});
```

The judge LLM is wired separately via `JudgeLLMService` so the judge code path is fully isolated from the SUT. See `createEvalLayer` JSDoc for layer composition.

## Dimensions

| Dimension         | What it measures                                     | Scorer                  |
| ----------------- | ---------------------------------------------------- | ----------------------- |
| `accuracy`        | Factual correctness against expected output          | `scoreAccuracy`         |
| `relevance`       | How well the response addresses the question         | `scoreRelevance`        |
| `completeness`    | Coverage of all aspects of the expected answer       | `scoreCompleteness`     |
| `safety`          | Absence of harmful, biased, or inappropriate content | `scoreSafety`           |
| `cost-efficiency` | Token usage and cost relative to quality             | `scoreCostEfficiency`   |

Each dimension scorer is a standalone Effect that takes the LLM tag + scoring params and returns a `DimensionScore`.

## Persistence

```typescript
import { createEvalStore, makeEvalServicePersistentLive } from "@reactive-agents/eval";

const store = createEvalStore("./eval-history.db");
// `makeEvalServicePersistentLive(store)` wires automatic persistence
// — every `runSuite` call writes to SQLite for diffing and regression checks.
```

`EvalStore` exposes `listRuns`, `getRun`, `compareRuns`, `getRegressions` for downstream tooling.

## Key Exports

| Export                                                                | Purpose                                          |
| --------------------------------------------------------------------- | ------------------------------------------------ |
| `EvalService`, `EvalServiceLive`, `makeEvalServiceLive`               | Suite runner with frozen-judge isolation         |
| `makeEvalServicePersistentLive`                                       | Persistent variant wired to `EvalStore`          |
| `JudgeLLMService`                                                     | Frozen-judge tag (Rule 4 isolation)              |
| `DatasetService`, `DatasetServiceLive`                                | Dataset loader                                   |
| `createEvalStore`                                                     | SQLite-backed history                            |
| `createEvalLayer`                                                     | Factory for the runtime layer                    |
| `scoreAccuracy`, `scoreRelevance`, `scoreCompleteness`, `scoreSafety`, `scoreCostEfficiency` | Per-dimension scorers   |
| `SuiteAgentRunner`, `EvalSuite`, `EvalCase`, `EvalRun`, `EvalRunSummary`, `JudgeConfig`, `EvalConfig` | Schemas + types |
| `EvalError`, `BenchmarkError`, `DatasetError`                         | Tagged errors                                    |

## Documentation

- Full docs: [docs.reactiveagents.dev](https://docs.reactiveagents.dev/)
- Eval guide: [docs.reactiveagents.dev/guides/evaluation/](https://docs.reactiveagents.dev/guides/evaluation/)

## License

MIT
