# @reactive-agents/testing

> Mock LLM, tool and EventBus services, assertion helpers and deterministic scenarios for testing Reactive Agents without API keys or network access.

> **Stability:** unstable. The scenario runner and Tier-1 gate are `@unstable` and may change or shrink between minor versions.

## Install

```bash
bun add -d @reactive-agents/testing
# or: npm install -D @reactive-agents/testing
```

## Usage

Script an agent's turns with `.withTestScenario()` from the builder, then assert on the run:

```ts
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withName("test-agent")
  .withTestScenario([
    { toolCall: { name: "web-search", args: { query: "AI news" } } },
    { text: "Here is the summary of AI news." },
  ])
  .build();

const result = await agent.run("Find AI news");
```

Use the mock services and assertions directly in unit tests:

```ts
import {
  createMockLLM,
  createMockToolService,
  createMockEventBus,
  assertToolCalled,
} from "@reactive-agents/testing";

const llm = createMockLLM([{ match: "hello", response: "Hi there" }]);
const tools = createMockToolService({ "my-tool": { result: "ok" } });
const bus = createMockEventBus(); // bus.events captures every published event

// after exercising your code:
assertToolCalled(tools.calls, "my-tool");
```

Assert on streams:

```ts
import { ReactiveAgents } from "reactive-agents";
import { expectStream } from "@reactive-agents/testing";

const agent = await ReactiveAgents.create()
  .withName("stream-agent")
  .withTestScenario([{ text: "hello" }])
  .build();

await expectStream(agent.runStream("hello")).toComplete({ within: 5000 });
```

## API

| Export | Use it when |
|---|---|
| `createMockLLM`, `createMockLLMFromMap`, `createTestLLMServiceLayer` | You need a deterministic LLM (pattern rules or fixed responses). |
| `createMockToolService` | You stub tool results and record calls. |
| `createMockEventBus` | You capture published events. |
| `assertToolCalled`, `assertStepCount`, `assertCostUnder` | You assert on tool calls, step count and cost. |
| `expectStream` | You assert on `runStream()` output. |
| `expectTrace` | You assert on phases, tool calls and events in a trace. |
| `createGuardrailBlockScenario`, `createBudgetExhaustedScenario`, `createMaxIterationsScenario` | You want a prebuilt scenario fixture. |
| `runScenario`, `runCounterfactual` | You run declarative scenarios (unstable). |
| `runGate`, `captureOutcome`, `diffOutcomes`, `readBaseline`, `writeBaseline` | You diff kernel scenario outcomes against a baseline (unstable). |

## Documentation

- [Testing agents](https://docs.reactiveagents.dev/cookbook/testing-agents/)

## Runtime

Bun >= 1.1.0 (recommended) or Node.js 22.5+.

## License

MIT. See [LICENSE](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/LICENSE).
