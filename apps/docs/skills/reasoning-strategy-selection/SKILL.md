---
name: reasoning-strategy-selection
description: Select and configure the right Reactive Agents reasoning strategy for task complexity, latency, and cost constraints.
compatibility: Reactive Agents TypeScript projects using the reasoning layer.
metadata:
  author: reactive-agents
  version: "1.0"
---

# Reasoning Strategy Selection

Use this skill to pick and tune reasoning behavior before implementing task logic.

## Agent objective

When implementing task-specific reasoning, generate code that:

- Selects strategy based on complexity and uncertainty.
- Keeps iteration budgets aligned with cost constraints.
- Adds verification for high-stakes outputs.

## What this skill does

- Maps task types to `reactive`, `plan-execute`, `tree-of-thought`, `reflexion`, or `adaptive` strategies.
- Balances confidence and token/cost budgets.
- Recommends escalation and fallback rules for low-confidence outputs.

## Decision pattern

1. Start with `adaptive` for unknown workloads.
2. Use `reactive` for repetitive low-complexity tasks.
3. Use `plan-execute` for structured multi-step execution flows.
4. Use `tree-of-thought` for branching exploration of difficult problems.
5. Add guardrails and verification when confidence is below thresholds.

## Implementation baseline

```ts
.withReasoning({
  defaultStrategy: "adaptive",
  maxIterations: 8,
})
.withVerification()
.withCostTracking()
```

## Code Examples

### Comparing Reasoning Strategies

This example demonstrates how to specify a reasoning strategy for an agent. The `withReasoning` method allows you to set the `defaultStrategy` for the agent's thinking process.

The code iterates through a list of strategies (`reactive`, `plan-execute-reflect`, `adaptive`) and runs the same task with each one, showing how the choice of strategy can affect the outcome and the number of steps required.

*Source: [apps/examples/src/reasoning/19-reasoning-strategies.ts](apps/examples/src/reasoning/19-reasoning-strategies.ts)*

```typescript
import { ReactiveAgents } from "@reactive-agents/runtime";

const TASK = "Explain in one sentence why agent memory is important for multi-turn conversations.";

const strategies = [
  "reactive",
  "plan-execute-reflect",
  "adaptive",
] as const;

for (const strategy of strategies) {
  const agent = await ReactiveAgents.create()
    .withName(`strategy-${strategy}`)
    .withProvider("anthropic")
    .withReasoning({ defaultStrategy: strategy })
    .withMaxIterations(5)
    .build();

  const result = await agent.run(TASK);
  console.log(`[${strategy}] ${result.metadata.stepsCount} steps: ${result.output}`);
}
```

## Expected implementation output

- A builder chain with explicit `.withReasoning({ defaultStrategy, maxIterations })`.
- Strategy rationale tied to task type (reactive, plan-execute, tree-of-thought, reflexion, adaptive).
- Validation checks for quality/cost tradeoffs under realistic prompts.

## Pitfalls to avoid

- Hard-coding expensive strategies for all tasks.
- High iteration caps without budget enforcement.
- Skipping verification on high-stakes outputs.
