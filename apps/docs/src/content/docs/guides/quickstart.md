---
title: Quickstart
description: Build your first Reactive Agent in 5 minutes.
---

## Prerequisites

- [Bun](https://bun.sh) v1.1+ (or Node.js 20+)
- An API key from [Anthropic](https://console.anthropic.com) or [OpenAI](https://platform.openai.com)

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
bun add reactive-agents effect
```

## 2. Set Up Environment

```bash
echo 'ANTHROPIC_API_KEY=sk-ant-...' > .env
```

## 3. Build an Agent

Create `src/agent.ts`:

```typescript
import { ReactiveAgents } from "reactive-agents";

async function main() {
  const agent = await ReactiveAgents.create()
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
  .withMemory("1")          // Tier 1: FTS5 search
  .withReasoning()           // ReAct reasoning loop
  .withGuardrails()          // Input safety checks
  .withCostTracking()        // Budget enforcement
  .build();
```

## What's Next?

- [Your First Agent](/guides/your-first-agent/) — A deeper walkthrough
- [Memory](/guides/memory/) — How agent memory works
- [Reasoning](/guides/reasoning/) — Understanding reasoning strategies
- [Architecture](/concepts/architecture/) — The full layer system
