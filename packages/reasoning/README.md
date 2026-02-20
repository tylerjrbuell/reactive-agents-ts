# @reactive-agents/reasoning

Reasoning strategies for the [Reactive Agents](https://tylerjrbuell.github.io/reactive-agents-ts/) framework.

Adds structured thinking to agents via ReAct, Plan-Execute, and Tree-of-Thought strategies.

## Installation

```bash
bun add @reactive-agents/reasoning effect
```

## Strategies

| Strategy | Description | Best For |
|----------|-------------|----------|
| `reactive` | ReAct loop: Think → Act → Observe | Tool-using agents |
| `plan-execute` | Plan all steps, then execute | Multi-step tasks |
| `tree-of-thought` | Explore multiple branches | Complex reasoning |

## Usage

```typescript
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withName("researcher")
  .withProvider("anthropic")
  .withReasoning()  // defaults to ReAct
  .build();

const result = await agent.run("Analyze the trade-offs between TCP and UDP");
```

The reasoning strategy is selected automatically based on task complexity, or you can specify it:

```typescript
.withReasoning({ strategy: "plan-execute" })
```

## How ReAct Works

```
Thought: I need to find information about X
Action: search("X")
Observation: [search results]
Thought: Based on the results, I can conclude...
FINAL ANSWER: [conclusion]
```

## Documentation

Full documentation at [tylerjrbuell.github.io/reactive-agents-ts/guides/reasoning/](https://tylerjrbuell.github.io/reactive-agents-ts/guides/reasoning/)
