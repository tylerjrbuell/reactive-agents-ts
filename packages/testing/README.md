# @reactive-agents/testing

Testing utilities for the [Reactive Agents](https://docs.reactiveagents.dev/) framework.

Mock services, assertion helpers, deterministic test scenarios, and streaming assertions for building reliable agent tests without real LLM calls.

## Installation

```bash
bun add @reactive-agents/testing --dev
```

## Usage

### Deterministic Test Scenarios

```typescript
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
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
await expectStream(agent.runStream("hello")).toEmitEvents(["TextDelta", "StreamCompleted"]);
```

### Mock Services

```typescript
import { createMockLLM, createMockToolService, createMockEventBus } from "@reactive-agents/testing";

const llm = createMockLLM([{ content: "Hello!" }]);
const tools = createMockToolService({ "my-tool": { result: "ok" } });
const bus = createMockEventBus();
```

### Assertion Helpers

```typescript
import { assertToolCalled, assertStepCount, assertCostUnder } from "@reactive-agents/testing";

assertToolCalled(result, "web-search");
assertStepCount(result, { max: 5 });
assertCostUnder(result, 0.01);
```

## Key Features

- **`withTestScenario()`** — sequential turn consumption with text, toolCall, json, and error turns
- **`expectStream()`** — streaming assertion API for `runStream()` output
- **Mock LLM** — deterministic responses without API keys or network calls
- **Mock EventBus** — captures published events for inspection
- **Mock ToolService** — stub tool results for isolated testing
- **Scenario fixtures** — pre-built guardrail block, budget exhausted, and max iteration scenarios

## Documentation

Full documentation at [docs.reactiveagents.dev](https://docs.reactiveagents.dev/)

## License

MIT
