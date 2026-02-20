# @reactive-agents/orchestration

Multi-agent orchestration for the [Reactive Agents](https://tylerjrbuell.github.io/reactive-agents-ts/) framework.

Coordinate fleets of agents in parallel or sequential workflows, with typed message passing and failure handling.

## Installation

```bash
bun add @reactive-agents/orchestration effect
```

## Features

- **Parallel execution** — run multiple agents concurrently, collect results
- **Sequential pipelines** — chain agents where each step's output feeds the next
- **Typed handoffs** — Effect-TS schemas validate inter-agent messages
- **Failure isolation** — one agent failing doesn't crash the whole workflow

## Usage

```typescript
import { ReactiveAgents } from "reactive-agents";
import { createOrchestration } from "@reactive-agents/orchestration";

const workflow = createOrchestration({
  name: "research-pipeline",
  steps: [
    { agent: "searcher", input: (ctx) => ctx.query },
    { agent: "summarizer", input: (ctx) => ctx.previousResult },
    { agent: "critic", input: (ctx) => ctx.previousResult },
  ],
});

const result = await workflow.run({ query: "Latest advances in fusion energy" });
```

## Documentation

Full documentation at [tylerjrbuell.github.io/reactive-agents-ts](https://tylerjrbuell.github.io/reactive-agents-ts/)
