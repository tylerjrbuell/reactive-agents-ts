---
title: Common builder stacks
description: Copy-paste ReactiveAgents.create() chains — tools, memory, streaming, Agent as Data — with links to the full API reference.
---

Use this page to assemble **realistic builder chains**. For every method, default, and env var, see the authoritative references:

- **[Builder API](/reference/builder-api/)** — signatures, option types, `ReactiveAgent` methods, events, and `AgentResult`.
- **[Configuration](/reference/configuration/)** — grouped checklist of builder methods and high-level defaults.

For a first end-to-end walkthrough, see [Quickstart](/guides/quickstart/) and [Your first agent](/guides/your-first-agent/).

## Patterns that stay true across stacks

1. **Start from** `ReactiveAgents.create()` — default name is `"agent"`, default provider is **`"test"`** until you call `.withProvider(...)`.
2. **Finish with** `.build()` (async) or `.buildEffect()` (Effect) — see [Effect-TS primer](/concepts/effect-ts/).
3. **Dispose** agents that use MCP stdio or other subprocess tools: prefer **`await using`**, **`runOnce()`**, or **`dispose()`** — [Resource management](/reference/builder-api/#resource-management).
4. **Custom tools and hooks** return **Effect** — `import { Effect } from "effect"` and use `Effect.succeed` / `Effect.fail` / `Effect.gen` as needed.

## Stack A — Direct LLM (no reasoning loop)

Single-shot Q&A; no tools, no multi-step loop. Smallest surface area.

```typescript
import { ReactiveAgents } from "reactive-agents";

await using agent = await ReactiveAgents.create()
  .withName("qa-bot")
  .withProvider("anthropic")
  .withModel("claude-sonnet-4-20250514")
  .build();

const result = await agent.run("Explain what a functor is in one paragraph.");
console.log(result.output);
```

## Stack B — ReAct + built-in tools

Enables the reasoning kernel and the default tool registry (file I/O, web search when keys exist, etc.). With `.withTools()`, **Conductor meta-tools** (`brief`, `find`, `pulse`, `recall`) default **on** unless you pass `.withMetaTools(false)` — see [Tools](/guides/tools/) and [Builder API — MetaToolsConfig](/reference/builder-api/#metatoolsconfig).

```typescript
import { ReactiveAgents } from "reactive-agents";

await using agent = await ReactiveAgents.create()
  .withName("tool-agent")
  .withProvider("anthropic")
  .withModel("claude-sonnet-4-20250514")
  .withReasoning()
  .withTools()
  .build();

const result = await agent.run("Use web-search to find today's date in UTC and reply with one sentence.");
console.log(result.output);
```

## Stack C — Memory + reasoning + debrief context

`.withMemory()` uses the **standard** tier by default (SQLite + FTS5; no embedding API required). Use **`{ tier: "enhanced" }`** when you want vector similarity (embedding provider + env). Debrief-style artifacts are tied to memory + reasoning — details in [Debrief & chat](/features/debrief-chat/) and [Memory](/guides/memory/).

```typescript
import { ReactiveAgents } from "reactive-agents";

await using agent = await ReactiveAgents.create()
  .withName("researcher")
  .withProvider("anthropic")
  .withModel("claude-sonnet-4-20250514")
  .withMemory() // or .withMemory({ tier: "enhanced" })
  .withReasoning()
  .withTools()
  .build();

const result = await agent.run("Summarize the project goals in three bullets.");
if (result.debrief) console.log(result.debrief.summary);
```

## Stack D — Safer, observable runs

Guardrails toggle **injection / PII / toxicity** detectors (all default **on** when guardrails are enabled). Observability drives the **metrics dashboard** at `normal+` verbosity. Cost tracking enforces **USD** budgets when you pass limits.

```typescript
import { ReactiveAgents } from "reactive-agents";

await using agent = await ReactiveAgents.create()
  .withName("production-shape")
  .withProvider("anthropic")
  .withModel("claude-sonnet-4-20250514")
  .withReasoning()
  .withTools()
  .withGuardrails({ toxicity: true, injection: true, pii: true })
  .withObservability({ verbosity: "normal", live: false })
  .withCostTracking({ perRequest: 0.25, daily: 10 })
  .build();

await agent.run("Draft a short status update for the team.");
```

## Stack E — Token streaming

`.withStreaming()` sets the default density for **`agent.runStream()`** (`tokens` vs `full`). You can override per call. See [Streaming](/features/streaming/) and [Streaming responses](/cookbook/streaming-responses/).

```typescript
import { ReactiveAgents } from "reactive-agents";

await using agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withModel("claude-sonnet-4-20250514")
  .withReasoning()
  .withStreaming({ density: "tokens" })
  .build();

for await (const event of agent.runStream("Write a haiku about TypeScript.")) {
  if (event._tag === "TextDelta") process.stdout.write(event.text);
  if (event._tag === "StreamCompleted") console.log("\nDone.");
}
```

## Stack F — Agent as Data (serialize / restore)

`toConfig()` captures the builder state as **`AgentConfig`**. Use **`agentConfigToJSON`** / **`agentConfigFromJSON`** (from `reactive-agents`) for strings. Some runtime-only fields (e.g. custom ICS functions) are not round-tripped — see [Builder API — Agent as Data](/reference/builder-api/#agent-as-data-toconfig--serialization).

```typescript
import {
  ReactiveAgents,
  agentConfigToJSON,
  agentConfigFromJSON,
} from "reactive-agents";

const builder = ReactiveAgents.create()
  .withName("saved-agent")
  .withProvider("anthropic")
  .withModel("claude-sonnet-4-20250514")
  .withReasoning()
  .withTools();

const json = agentConfigToJSON(builder.toConfig());
const restored = await ReactiveAgents.fromJSON(json);
await using agent = await restored.build();
await agent.run("Ping.");
```

## Stack G — Adaptive strategy

If **`defaultStrategy` is `"adaptive"`**, you must set **`adaptive: { enabled: true }`** — [Reasoning](/guides/reasoning/), [Builder API — ReasoningOptions](/reference/builder-api/#reasoningoptions).

```typescript
import { ReactiveAgents } from "reactive-agents";

await using agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withModel("claude-sonnet-4-20250514")
  .withReasoning({
    defaultStrategy: "adaptive",
    adaptive: { enabled: true },
  })
  .withTools()
  .build();

await agent.run("Plan then execute: list two pros and two cons of serverless agents.");
```

## Related cookbook pages

| Topic | Page |
|-------|------|
| Custom tools | [Building tools](/cookbook/building-tools/) |
| Streaming details | [Streaming responses](/cookbook/streaming-responses/) |
| Tests | [Testing agents](/cookbook/testing-agents/) |
| Multi-agent | [Multi-agent patterns](/cookbook/multi-agent-patterns/) |

## More guides

| Goal | Guide or reference |
|------|-------------------|
| Lifecycle hooks | [Hooks](/guides/hooks/) |
| MCP servers | [Builder API — MCP](/reference/builder-api/#mcp) |
| Sub-agents | [Sub-agents](/guides/sub-agents/) |
| Effect composition | [Effect-TS primer](/concepts/effect-ts/) |
