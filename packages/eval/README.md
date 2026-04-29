# @reactive-agents/eval

Evaluation framework for [Reactive Agents](https://docs.reactiveagents.dev/) — benchmark agent quality, track regressions, and run automated test suites.

## Installation

```bash
bun add @reactive-agents/eval
```

## Features

- **5-dimension scoring** — Accuracy, Relevance, Completeness, Safety, Cost Efficiency
- **LLM-as-judge** — Uses an LLM to evaluate agent outputs against expected answers
- **Evaluation suites** — Define test cases with inputs, expected outputs, and dimensions
- **SQLite persistence** — Store eval runs via `EvalStore` for history and comparison
- **Dataset service** — Load and manage evaluation datasets
- **CLI integration** — Run evaluations via `rax eval`

## Usage

`runSuite(suite, agentConfig, agentRunner, config?)` requires three things:

- **`suite`**: cases + dimensions + suite metadata
- **`agentConfig`**: a string identifying the system under test (used in result records and the Rule-4 guard)
- **`agentRunner`**: a function that takes the case input, runs the SUT (your agent), and returns its actual output + metrics. Pre-W6.5 this was hardcoded to a placeholder, which made every score meaningless — callers now supply this themselves.

```typescript
import { EvalService, createEvalLayer, type SuiteAgentRunner } from "@reactive-agents/eval";
import { Effect } from "effect";

// Caller-supplied SUT runner. This invokes YOUR agent. It MUST NOT use the
// JudgeLLMService — that Tag is reserved for the frozen judge per Rule 4 of
// 00-RESEARCH-DISCIPLINE.md. Use LLMService or your agent builder layer here.
const myAgentRunner: SuiteAgentRunner = (input) =>
  Effect.gen(function* () {
    const result = yield* runMyAgent(input); // your agent invocation
    return {
      actualOutput: result.output,
      metrics: { latencyMs: result.elapsedMs, tokensUsed: result.tokens, costUsd: result.costUsd },
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
      ],
    },
    "openai/gpt-4o", // SUT identifier
    myAgentRunner,
    { judge: { model: "claude-haiku-4-5", provider: "anthropic" } }, // judge MUST differ from SUT
  );

  console.log(`avgScore: ${run.summary.avgScore}, passed: ${run.summary.passed}/${run.summary.totalCases}`);
});
```

The judge LLM is wired separately via `JudgeLLMService` (see `createEvalLayer` JSDoc) so the judge code path is fully isolated from the SUT.

## Dimensions

| Dimension         | What It Measures                                     |
| ----------------- | ---------------------------------------------------- |
| `accuracy`        | Factual correctness against expected output          |
| `relevance`       | How well the response addresses the question         |
| `completeness`    | Coverage of all aspects of the expected answer       |
| `safety`          | Absence of harmful, biased, or inappropriate content |
| `cost-efficiency` | Token usage and cost relative to quality             |

## Persistence

Use `EvalStore` for SQLite-backed eval history:

```typescript
import { createEvalStore } from "@reactive-agents/eval";

const store = createEvalStore("./eval-history.db");
// Eval runs are automatically persisted when using EvalServicePersistentLive
```

## Documentation

Full documentation at [docs.reactiveagents.dev](https://docs.reactiveagents.dev/)
