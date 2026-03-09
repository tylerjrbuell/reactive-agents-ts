---
title: Quickstart
description: Build your first Reactive Agent in 5 minutes.
---

## Prerequisites

- [Bun](https://bun.sh) v1.1+ (or Node.js 20+)
- An API key from [Anthropic](https://console.anthropic.com), [Gemini](https://ai.google.dev/), [LiteLLM](https://www.litellm.ai) or [OpenAI](https://platform.openai.com)

The fastest path through this guide is the `rax` workflow (`Rax` = Reactive Agents Executable).

## 1. Create a Project

Using the CLI:

```bash
bunx rax init my-agent-app --template standard
cd my-agent-app
bun install
```

Or manually:

```bash
mkdir my-agent-app && cd my-agent-app
bun init -y
bun add reactive-agents
```

:::note[Effect dependency]
`effect` ships as a dependency of `reactive-agents` and is installed automatically. Only add it explicitly (`bun add effect`) if your own code imports from `effect` directly.
:::

## 2. Set Up Environment

```bash
echo 'ANTHROPIC_API_KEY=sk-ant-...' > .env
echo 'GOOGLE_API_KEY=...' >> .env
echo 'TAVILY_API_KEY=tvly-...' >> .env
echo 'LITELLM_API_KEY=...' >> .env
echo 'OPENAI_API_KEY=...' >> .env

```

## 3. Build an Agent

Create `src/agent.ts`:

```typescript
import { ReactiveAgents } from "reactive-agents";

async function main() {
  // await using disposes the agent automatically when the block exits
  await using agent = await ReactiveAgents.create()
    .withName("my-first-agent")
    .withProvider("anthropic")
    .withModel("claude-sonnet-4-20250514")
    .build();

  const result = await agent.run("What are the three laws of thermodynamics?");

  console.log("Output:", result.output);
  console.log("Duration:", result.metadata.duration, "ms");
  console.log("Steps:", result.metadata.stepsCount);
}

main();
```

:::tip[Resource cleanup]
Always dispose agents that use MCP servers or other subprocess-based tools — otherwise the process will hang on open pipes. Use `await using` for automatic cleanup, or [`runOnce()`](../../reference/builder-api/#runonceinput-string-promiseagentresult) for one-shot scripts. See [Resource Management](../../reference/builder-api/#resource-management) for all three patterns.
:::

## 4. Run It

```bash
bun run src/agent.ts
```

## 5. Add Capabilities

Enable memory, reasoning, and safety:

```typescript
const agent = await ReactiveAgents.create()
  .withName("research-agent")
  .withProvider("anthropic")
  .withModel("claude-sonnet-4-20250514")
  .withMemory("1") // Tier 1: FTS5 search
  .withReasoning() // ReAct reasoning loop
  .withGuardrails() // Input safety checks
  .withCostTracking() // Budget enforcement
  .build();
```

## What's Next?

- [Your First Agent](../your-first-agent/) — A deeper walkthrough
- [Choosing a Stack](../choosing-a-stack/) — Pick provider/model/memory defaults quickly
- [Agent Skills](../agent-skills/) — Publish reusable implementation skills for coding agents
- [Memory](../memory/) — How agent memory works
- [Reasoning](../reasoning/) — Understanding reasoning strategies
- [Troubleshooting](../troubleshooting/) — Diagnose common failures fast
- [Architecture](../../concepts/architecture/) — The full layer system
