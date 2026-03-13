---
name: reasoning-strategy-selection
description: Select and configure the right Reactive Agents reasoning strategy for task complexity, latency, and cost constraints.
compatibility: Reactive Agents TypeScript projects using the reasoning layer.
metadata:
  author: reactive-agents
  version: "1.1"
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
5. Enable `enableStrategySwitching` when task complexity is unpredictable — automatically escalates on loop detection.
6. Add guardrails and verification when confidence is below thresholds.

## Implementation baseline

```ts
.withReasoning({
  defaultStrategy: "adaptive",
  maxIterations: 8,
  // Optional: auto-switch strategy if the agent gets stuck
  // enableStrategySwitching: true,
  // maxStrategySwitches: 2,
})
.withVerification()
.withCostTracking()
```

## Strategy switching

When `enableStrategySwitching: true`, the framework detects loop patterns (repeated tool calls, repeated thoughts, consecutive think-only steps) and automatically switches to a better strategy mid-run.

```ts
// LLM evaluator picks the best strategy to switch to
.withReasoning({ enableStrategySwitching: true, maxStrategySwitches: 2 })

// Deterministic switch — no LLM call, always switches to plan-execute-reflect
.withReasoning({ enableStrategySwitching: true, fallbackStrategy: "plan-execute-reflect" })
```

Subscribe to `StrategySwitchEvaluated` and `StrategySwitched` EventBus events for observability.

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
