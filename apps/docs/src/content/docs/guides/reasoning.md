---
title: Reasoning
description: Understanding agent reasoning strategies.
---

The reasoning layer provides structured thinking strategies that go beyond simple LLM completions.

## Available Strategies

### ReAct (Default)

A Thought-Action-Observation loop:

1. **Think** — The agent reasons about the current state
2. **Act** — If needed, the agent calls a tool
3. **Observe** — The agent incorporates the result
4. Repeat until a final answer is reached

Best for: Tasks requiring tool use, multi-step reasoning, and iterative refinement.

### Plan-Execute

1. Generate a structured plan with numbered steps
2. Execute each step sequentially
3. Verify against the original plan

Best for: Complex tasks with clear decomposition.

### Tree-of-Thought

Explores multiple reasoning branches in parallel, evaluating each for promise before proceeding.

Best for: Creative tasks, problem-solving with multiple valid approaches.

### Reflexion

Attempts a task, reflects on the result, and retries with learned insights.

Best for: Tasks where quality matters more than speed.

## Enabling Reasoning

```typescript
const agent = await ReactiveAgents.create()
  .withReasoning()  // Uses default ReAct strategy
  .build();
```

## Custom Strategies

Register custom reasoning strategies:

```typescript
import { Effect } from "effect";

const agent = await ReactiveAgents.create()
  .withReasoning()
  .build();

// Access the reasoning service through Effect
// to register custom strategies
```

## Without Reasoning

When reasoning is not enabled, the agent uses a direct LLM loop:
- Send messages to the LLM
- If the LLM requests tool calls, execute them
- Append results and repeat
- Stop when the LLM returns a final response

This is faster but less structured than a full reasoning strategy.
