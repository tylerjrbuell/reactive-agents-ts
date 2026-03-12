---
title: "Migrating from LangChain.js"
description: "Side-by-side guide for moving agents from LangChain.js to Reactive Agents"
---

This guide maps LangChain.js concepts to their Reactive Agents equivalents and shows side-by-side code examples for common patterns.

## Concept Mapping

| LangChain.js | Reactive Agents |
|---|---|
| `ChatOpenAI` / `ChatAnthropic` | `.withProvider("openai")` / `.withProvider("anthropic")` |
| `AgentExecutor` | `ReactiveAgent` (built by `ReactiveAgents.create().build()`) |
| `DynamicStructuredTool` | `ToolDefinition` + handler object |
| `BufferMemory` / `ConversationSummaryMemory` | `.withMemory({ tier: "standard" })` |
| `RunnableSequence` / `Chain` | Reasoning strategies (ReAct, Plan-Execute-Reflect, etc.) |
| `CallbackManager` | `.withHook()` (10-phase lifecycle) |
| `OutputParser` | `OutputFormat` on `AgentResult` |

---

## Agent Creation

**LangChain.js**

```typescript
import { ChatOpenAI } from "@langchain/openai";
import { AgentExecutor, createOpenAIFunctionsAgent } from "langchain/agents";
import { pull } from "langchain/hub";

const llm = new ChatOpenAI({ model: "gpt-4o", temperature: 0 });
const prompt = await pull("hwchase17/openai-functions-agent");
const agent = await createOpenAIFunctionsAgent({ llm, tools, prompt });
const executor = new AgentExecutor({ agent, tools });

const result = await executor.invoke({ input: "What is the weather in NYC?" });
console.log(result.output);
```

**Reactive Agents**

```typescript
import { ReactiveAgents } from "@reactive-agents/runtime";

const agent = await ReactiveAgents.create()
  .withProvider("openai")
  .withTools()
  .withReasoning()
  .build();

const result = await agent.run("What is the weather in NYC?");
console.log(result.output);
```

---

## Tool Registration

**LangChain.js**

```typescript
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

const weatherTool = new DynamicStructuredTool({
  name: "get_weather",
  description: "Get current weather for a location",
  schema: z.object({
    location: z.string().describe("City name"),
  }),
  func: async ({ location }) => {
    return `Weather in ${location}: sunny, 72F`;
  },
});
```

**Reactive Agents**

```typescript
import type { AgentTool } from "@reactive-agents/tools";

const weatherTool: AgentTool = {
  definition: {
    name: "get_weather",
    description: "Get current weather for a location",
    parameters: [
      {
        name: "location",
        type: "string",
        description: "City name",
        required: true,
      },
    ],
    riskLevel: "low",
    timeoutMs: 30000,
    requiresApproval: false,
    source: "function",
  },
  handler: async (params) => {
    const { location } = params as { location: string };
    return `Weather in ${location}: sunny, 72F`;
  },
};

const agent = await ReactiveAgents.create()
  .withProvider("openai")
  .withTools({ tools: [weatherTool] })
  .build();
```

---

## Callbacks to Hooks

LangChain.js uses a `CallbackManager` with event-named handler functions. Reactive Agents uses a typed 10-phase lifecycle with explicit `phase` and `timing` fields.

The 10 phases in order: `bootstrap`, `guardrail`, `strategy`, `think`, `act`, `observe`, `verify`, `memory-flush`, `audit`, `complete`.

**LangChain.js**

```typescript
import { AgentExecutor } from "langchain/agents";

const executor = new AgentExecutor({
  agent,
  tools,
  callbacks: [
    {
      handleLLMStart(llm, messages) {
        console.log("LLM starting:", messages);
      },
      handleToolEnd(output) {
        console.log("Tool finished:", output);
      },
    },
  ],
});
```

**Reactive Agents**

```typescript
import { Effect } from "effect";

const agent = await ReactiveAgents.create()
  .withProvider("openai")
  .withTools()
  .withHook({
    phase: "think",
    timing: "before",
    handler: (ctx) => {
      console.log("LLM starting, iteration:", ctx.iteration);
      return Effect.succeed(ctx);
    },
  })
  .withHook({
    phase: "act",
    timing: "after",
    handler: (ctx) => {
      console.log("Tool finished:", ctx.lastToolResult);
      return Effect.succeed(ctx);
    },
  })
  .build();
```

Hooks receive a typed `ExecutionContext` and must return `Effect.succeed(ctx)` (or a modified context) to continue execution. Returning a failed Effect cancels the current phase.

---

## Memory Setup

**LangChain.js**

```typescript
import { BufferMemory } from "langchain/memory";
import { ConversationChain } from "langchain/chains";

const memory = new BufferMemory();
const chain = new ConversationChain({ llm, memory });

await chain.call({ input: "Hi, my name is Alice" });
await chain.call({ input: "What is my name?" });
```

**Reactive Agents**

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("openai")
  .withMemory({ tier: "standard" })
  .build();

const result1 = await agent.run("Hi, my name is Alice");
const result2 = await agent.run("What is my name?");
```

Reactive Agents provides a 4-layer memory architecture:

| Tier | Layers Active | Use Case |
|---|---|---|
| `"basic"` | Working only | Stateless single-run agents |
| `"standard"` | Working + Episodic | Conversational agents with history |
| `"enhanced"` | Working + Episodic + Procedural + Semantic | Research agents, long-running tasks |

The `semantic` layer supports vector similarity search via SQLite + embeddings. The `procedural` layer stores learned tool-use patterns across runs.

---

## Key Differences

- **Explicit 10-phase lifecycle** — every execution passes through named phases (`bootstrap` through `complete`), each hookable, vs LangChain's implicit chain execution where instrumentation points vary by chain type.

- **Effect-TS composition** — services, hooks, and layers are composed using [Effect-TS](https://effect.website/) for typed errors and dependency injection. LangChain uses Promise chains and class inheritance.

- **5 built-in reasoning strategies** — ReAct, Plan-Execute-Reflect, Reflexion, Tree-of-Thought, and Adaptive are available via `.withReasoning({ strategy: "..." })`. LangChain requires separate agent type constructors for different reasoning patterns.

- **Built-in cost tracking, guardrails, and verification** — add `.withCostTracking()`, `.withGuardrails()`, or `.withVerification()` to the builder. No third-party plugins or manual wiring required.

- **EventBus observability auto-wired** — adding `.withObservability()` subscribes `MetricsCollector` to all lifecycle events automatically. A formatted dashboard is printed on completion without manual instrumentation.

- **TypeScript-first with typed errors** — `AgentResult` carries `output`, `debrief`, `format`, and `terminatedBy` fields. Hook handlers and strategy functions have explicit Effect-TS error channels rather than thrown exceptions.
