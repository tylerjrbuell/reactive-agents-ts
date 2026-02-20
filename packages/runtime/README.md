# @reactive-agents/runtime

The execution runtime for [Reactive Agents](https://tylerjrbuell.github.io/reactive-agents-ts/).

Contains the 10-phase `ExecutionEngine`, the `ReactiveAgentBuilder` fluent API, and `createRuntime()` — the function that wires all optional layers together.

## Installation

```bash
bun add @reactive-agents/runtime effect
```

Or install everything at once (recommended for new projects):

```bash
bun add reactive-agents effect
```

## Usage

### Builder API (recommended)

```typescript
import { ReactiveAgents } from "@reactive-agents/runtime";

const agent = await ReactiveAgents.create()
  .withName("my-agent")
  .withProvider("anthropic")
  .withModel("claude-sonnet-4-20250514")
  .withMemory("1")
  .withReasoning()
  .withGuardrails()
  .withCostTracking()
  .build();

const result = await agent.run("Explain the CAP theorem");
console.log(result.output);
console.log(result.metadata); // { duration, cost, tokensUsed, stepsCount }
```

### Effect API

```typescript
import { Effect } from "effect";
import { ReactiveAgents } from "@reactive-agents/runtime";

const program = Effect.gen(function* () {
  const agent = yield* ReactiveAgents.create()
    .withName("my-agent")
    .withProvider("anthropic")
    .buildEffect();

  return yield* agent.runEffect("What is the meaning of life?");
});

const result = await Effect.runPromise(program);
```

### Low-level `createRuntime()`

```typescript
import { createRuntime } from "@reactive-agents/runtime";
import { Effect } from "effect";

const runtime = createRuntime({
  agentId: "my-agent",
  provider: "anthropic",
  enableReasoning: true,
  enableGuardrails: true,
  enableCostTracking: true,
});
```

## The 10-Phase Execution Engine

Every task flows through:

1. **Bootstrap** — load memory context
2. **Guardrail** — safety checks on input
3. **Cost Route** — select optimal model
4. **Strategy Select** — choose reasoning strategy
5. **Think** — LLM completion
6. **Act** — tool execution
7. **Observe** — append results
8. **Verify** — fact-check output
9. **Memory Flush** — persist session
10. **Complete** — return result

Each phase supports `before`, `after`, and `on-error` lifecycle hooks.

## Documentation

Full documentation at [tylerjrbuell.github.io/reactive-agents-ts](https://tylerjrbuell.github.io/reactive-agents-ts/)
