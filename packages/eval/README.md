# @reactive-agents/eval

> Evaluation suites for Reactive Agents: deterministic graders for typed results, a frozen LLM judge for the rest, and SQLite run history with regression checks.

> **Stability:** unstable. Types and service shapes may change between minor versions.

## Install

```bash
bun add @reactive-agents/eval
# or: npm install @reactive-agents/eval
```

## Usage

Grade a typed agent result with no LLM call. Deterministic checks run first; an LLM judge is the fallback.

```ts
import { gradeOutput } from "@reactive-agents/eval";

const grade = gradeOutput(
  {
    fields: { status: "ok" },
    checks: [{ kind: "approx", path: "/total", value: 10, tolerance: 0.01 }],
  },
  JSON.stringify({ status: "ok", total: 10.004, note: "extra keys are ignored" }),
);

console.log(grade.verdict); // "pass" | "fail" | "inconclusive"
```

An expectation that declares nothing grades `inconclusive`, never `pass`. Output that is not JSON fails.

To run a whole suite, supply your own agent runner. The judge is wired through `JudgeLLMService`, separate from the agent under test, and must be a different model:

```ts
import { Effect } from "effect";
import { EvalService, type SuiteAgentRunner } from "@reactive-agents/eval";

declare const runMyAgent: (input: string) => Effect.Effect<{ output: string }>;

const agentRunner: SuiteAgentRunner = (input) =>
  runMyAgent(input).pipe(Effect.map((r) => ({ actualOutput: r.output })));

const program = Effect.gen(function* () {
  const evals = yield* EvalService;
  const run = yield* evals.runSuite(
    {
      id: "qa",
      name: "QA",
      description: "Basic factual questions",
      dimensions: ["accuracy"],
      cases: [{ id: "q1", name: "Capital of France", input: "Capital of France?", expectedOutput: "Paris" }],
    },
    "my-agent-v1", // identifier of the system under test
    agentRunner,
  );
  console.log(run.summary.avgScore);
});
```

Provide `createEvalLayer()` plus a `JudgeLLMService` implementation when running `program`; see the `createEvalLayer` JSDoc for composition. `makeEvalServicePersistentLive(createEvalStore("./eval.db"))` records every run to SQLite for comparison and `checkRegression`.

## API

| Export | Use it when |
|---|---|
| `gradeOutput`, `gradeStructured`, `gradeFields`, `gradeSchema` | You can compute the grade from data: field equality, numeric tolerance, contains, regex, length, type, schema validity. |
| `gradeRubric`, `gradeCase` | A rubric-based judgment is needed after deterministic checks. |
| `EvalService`, `makeEvalServicePersistentLive` | You run suites, compare runs or check regressions. |
| `JudgeLLMService`, `JudgeFromLLMServiceLive` | You wire the frozen judge. |
| `createEvalStore` | You want SQLite run history. |
| `DatasetService` | You load evaluation corpora shared across suites. |
| `scoreAccuracy`, `scoreRelevance`, `scoreCompleteness`, `scoreSafety`, `scoreCostEfficiency` | You score one dimension directly. |
| `summarizeRepeats`, `confidenceInterval95`, `minimumDetectableEffect` | You aggregate repeated runs and need to know if a gap is noise. |
| `EvalSuite`, `EvalCase`, `EvalRun`, `EvalConfig`, `SuiteAgentRunner` | You type suites, runs and runners. |

## Documentation

- [Eval](https://docs.reactiveagents.dev/features/eval/)

## Runtime

Bun >= 1.1.0 (recommended) or Node.js 22.5+. The run store uses SQLite.

## License

MIT. See [LICENSE](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/LICENSE).
