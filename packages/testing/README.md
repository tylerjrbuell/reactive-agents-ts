# @reactive-agents/testing

Testing utilities for the [Reactive Agents](https://docs.reactiveagents.dev/) framework. **v0.10.3**

Mock services (LLM, tools, EventBus), assertion helpers, deterministic test scenarios, streaming assertions, trace assertions, and a Tier-1 deterministic scenario gate. Build reliable agent tests without real LLM calls or network access.

## Installation

```bash
bun add -d @reactive-agents/testing
```

## Quick Example

### Deterministic Scenarios

```typescript
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withName("test-agent")
  .withTestScenario([
    { toolCall: { name: "web-search", args: { query: "AI news" } } },
    { text: "Here is the summary of AI news." },
  ])
  .withTools({ tools: [mySearchTool] })
  .build();

const result = await agent.run("Find AI news");
```

### Streaming Assertions

```typescript
import { expectStream } from "@reactive-agents/testing";

await expectStream(agent.runStream("hello")).toEmitTextDeltas();
await expectStream(agent.runStream("hello")).toComplete({ within: 5000 });
await expectStream(agent.runStream("hello")).toEmitEvents([
  "TextDelta",
  "StreamCompleted",
]);
```

### Mock Services

```typescript
import {
  createMockLLM,
  createMockToolService,
  createMockEventBus,
  createTestLLMServiceLayer,
} from "@reactive-agents/testing";

const llm = createMockLLM([{ content: "Hello!" }]);
const tools = createMockToolService({ "my-tool": { result: "ok" } });
const bus = createMockEventBus(); // captures every published event for inspection

// Or wire a Layer for Effect-style tests:
const llmLayer = createTestLLMServiceLayer([{ content: "stub" }]);
```

### Assertion Helpers

```typescript
import {
  assertToolCalled,
  assertStepCount,
  assertCostUnder,
} from "@reactive-agents/testing";

assertToolCalled(result, "web-search");
assertStepCount(result, { max: 5 });
assertCostUnder(result, 0.01);
```

### Pre-built Scenario Fixtures

```typescript
import {
  createGuardrailBlockScenario,
  createBudgetExhaustedScenario,
  createMaxIterationsScenario,
} from "@reactive-agents/testing";

const fx = createGuardrailBlockScenario({ violation: "prompt-injection" });
// fx.input, fx.expectedError, fx.layer — drop into any test framework
```

### Trace Assertions

```typescript
import { expectTrace } from "@reactive-agents/testing";

expectTrace(result.trace).toContainPhase("guardrail");
expectTrace(result.trace).toEmitToolCall("calculator", { count: 1 });
```

## Tier-1 Scenario Gate (unstable)

Capture-and-diff regression gate for kernel-level scenarios. The gate records baseline outcomes and diffs subsequent runs to catch regressions:

```typescript
import {
  runGate,
  captureOutcome,
  diffOutcomes,
  readBaseline,
  writeBaseline,
} from "@reactive-agents/testing";

const baseline = readBaseline(BASELINE_PATH);
const outcomes = await runGate({ scenarios });
const diffs = diffOutcomes(baseline, outcomes);
```

> Marked `@unstable` — Tier-1 Gate has zero CI invocations as of v0.10.2 and the audit verdict for testing is SHRINK. See `AUDIT-overhaul-2026.md` §11 #40.

## Scenario Runner (unstable)

```typescript
import { runScenario, runCounterfactual } from "@reactive-agents/testing";

const result = await runScenario({ /* ScenarioConfig */ });
const cf = await runCounterfactual({ /* swap a step, replay, compare */ });
```

## Key Features

- **`withTestScenario()`** — sequential turn consumption with `text`, `toolCall`, `json`, and `error` turns
- **`expectStream()`** — streaming assertion API for `runStream()` output
- **`expectTrace()`** — assertions over emitted phase / tool / event traces
- **Mock LLM** — deterministic responses without API keys or network calls
- **Mock EventBus** — captures published events for inspection
- **Mock ToolService** — stub tool results for isolated testing
- **Scenario fixtures** — pre-built guardrail-block, budget-exhausted, max-iterations scenarios

## Key Exports

| Export                                                          | Purpose                                          |
| --------------------------------------------------------------- | ------------------------------------------------ |
| `createMockLLM`, `createMockLLMFromMap`, `createTestLLMServiceLayer` | Mock LLM providers                          |
| `createMockToolService`                                         | Stub tool registry                               |
| `createMockEventBus`                                            | Capturing EventBus                               |
| `assertToolCalled`, `assertStepCount`, `assertCostUnder`        | Result assertions                                |
| `createTestLLM`                                                 | Quick test-LLM helper                            |
| `expectStream`                                                  | Streaming-assertion DSL (unstable)               |
| `expectTrace`                                                   | Trace-assertion DSL                              |
| `createGuardrailBlockScenario`, `createBudgetExhaustedScenario`, `createMaxIterationsScenario` | Scenario fixtures |
| `runScenario`, `runCounterfactual`                              | Declarative scenario runner (unstable)           |
| `runGate`, `captureOutcome`, `diffOutcomes`, `archiveFailingTrace`, `readBaseline`, `writeBaseline`, `discoverScenarios`, `summarizeCoverage` | Tier-1 gate (unstable) |
| `MockLLMRule`, `CapturedEvent`, `CapturedToolCall`, `Tier1Baseline`, `ScenarioDiff` | Schemas + types |

## Documentation

Full documentation at [docs.reactiveagents.dev](https://docs.reactiveagents.dev/)

## License

MIT
