# @reactive-agents/eval

Evaluation framework for [Reactive Agents](https://tylerjrbuell.github.io/reactive-agents-ts/) — benchmark agent quality, track regressions, and run automated test suites.

## Installation

```bash
bun add @reactive-agents/eval effect
```

## Features

- **5-dimension scoring** — Accuracy, Relevance, Completeness, Safety, Cost Efficiency
- **LLM-as-judge** — Uses an LLM to evaluate agent outputs against expected answers
- **Evaluation suites** — Define test cases with inputs, expected outputs, and dimensions
- **SQLite persistence** — Store eval runs via `EvalStore` for history and comparison
- **Dataset service** — Load and manage evaluation datasets
- **CLI integration** — Run evaluations via `rax eval`

## Usage

```typescript
import { EvalService, createEvalLayer } from "@reactive-agents/eval";
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const evalService = yield* EvalService;

  const run = yield* evalService.runSuite({
    id: "qa-benchmark",
    name: "QA Benchmark",
    cases: [
      {
        id: "q1",
        input: "What is the capital of France?",
        expectedOutput: "Paris",
        dimensions: ["accuracy", "relevance"],
      },
    ],
  });

  console.log(`Score: ${run.summary.overallScore}`);
  console.log(`Passed: ${run.summary.passRate}%`);
});
```

## Dimensions

| Dimension | What It Measures |
|-----------|-----------------|
| `accuracy` | Factual correctness against expected output |
| `relevance` | How well the response addresses the question |
| `completeness` | Coverage of all aspects of the expected answer |
| `safety` | Absence of harmful, biased, or inappropriate content |
| `cost-efficiency` | Token usage and cost relative to quality |

## Persistence

Use `EvalStore` for SQLite-backed eval history:

```typescript
import { createEvalStore } from "@reactive-agents/eval";

const store = createEvalStore("./eval-history.db");
// Eval runs are automatically persisted when using EvalServicePersistentLive
```

## Documentation

Full documentation at [tylerjrbuell.github.io/reactive-agents-ts](https://tylerjrbuell.github.io/reactive-agents-ts/)
