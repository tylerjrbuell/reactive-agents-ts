---
name: cost-budget-enforcement
description: Enforce per-task, daily, and monthly budgets with complexity-aware routing and graceful degradation.
compatibility: Reactive Agents projects using cost tracking and budget policies.
metadata:
  author: reactive-agents
  version: "1.0"
---

# Cost Budget Enforcement

Use this skill to keep agent execution financially predictable.

## Agent objective

When building budget-aware agents, produce implementations that:

- Set clear per-task and aggregate budget constraints.
- Route strategy/model choices by task value and complexity.
- Surface budget state in runtime metadata and logs.

## What this skill does

- Applies per-task and aggregate budget caps.
- Routes model/strategy by complexity and budget headroom.
- Triggers fallbacks when budgets approach limits.

## Baseline policy

- Hard cap: per-task maximum spend.
- Soft cap: warning threshold (for example 80%).
- Escalation: degrade strategy/model before hard-fail.

## Implementation pattern

- Enable cost tracking early in the execution lifecycle.
- Include cost metadata in verification and observability outputs.
- Fail fast on breached hard budget constraints.

## Expected implementation output

- Builder chain with `.withCostTracking()` and complementary verification/observability.
- Policy configuration covering per-task and daily/monthly ceilings.
- Runtime behavior that degrades gracefully before hard failure.

## Code Examples

### Enabling Cost Tracking

To track token usage and estimate costs, use the `.withCostTracking()` builder method. The cost and token count will be available in the `metadata` of the result object.

```typescript
import { ReactiveAgents } from "@reactive-agents/runtime";

const agent = await ReactiveAgents.create()
  .withName("cost-tracked-agent")
  .withProvider("anthropic")
  // Enable cost tracking
  .withCostTracking()
  .build();

const result = await agent.run("What is the capital of France?");

const cost = result.metadata.cost ?? 0;
const tokens = result.metadata.tokensUsed ?? 0;

console.log(`Output: ${result.output}`);
console.log(`Tokens used: ${tokens}`);
console.log(`Estimated cost: $${cost.toFixed(6)}`);
```

### Daily Token Budget via Gateway Policies

For persistent agents with daily token caps, use the gateway's built-in policy engine. It tracks token usage via the EventBus and emits a `BudgetExhausted` event when the daily limit is hit.

```typescript
import { ReactiveAgents } from "@reactive-agents/runtime";

const agent = await ReactiveAgents.create()
  .withName("budget-agent")
  .withProvider("anthropic")
  .withCostTracking()
  .withGateway({
    policies: {
      dailyTokenBudget: 50_000,   // Hard cap: 50k tokens per day
      maxActionsPerHour: 30,      // Rate limit: 30 tool calls per hour
    },
  })
  .build();

// Subscribe to budget events for monitoring
await agent.subscribe("BudgetExhausted", (event) => {
  console.warn(`Budget hit: ${event.tokensUsed} / ${event.dailyBudget} tokens`);
});
```

### Manual Per-Run Budget Check

For non-gateway agents, check cost metadata after each run:

```typescript
let totalCost = 0;
const dailyBudget = 1.00; // $1.00

async function runWithBudget(prompt: string) {
  if (totalCost >= dailyBudget) {
    console.error("Daily budget exceeded. Halting operations.");
    return;
  }

  const result = await agent.run(prompt);
  const runCost = result.metadata.cost ?? 0;
  totalCost += runCost;

  console.log(`Run cost: $${runCost.toFixed(6)}, Total: $${totalCost.toFixed(6)}`);
  return result;
}
```

## Pitfalls to avoid

- Tracking cost only after execution completes.
- No policy for daily and monthly aggregate budgets.
- High-complexity strategy defaults on low-value tasks.
