---
name: reasoning-strategy-selection
description: Select and configure the right reasoning strategy, native FC behavior, and output quality pipeline for any task type.
compatibility: Reactive Agents TypeScript projects using @reactive-agents/*
metadata:
  author: reactive-agents
  version: "2.0"
  tier: "capability"
---

# Reasoning Strategy Selection

## Agent objective

Produce a `.withReasoning()` call with the correct strategy, iteration budget, and tool gates for the task — with output quality pipeline active when format matters.

## When to load this skill

- Before configuring `.withReasoning()` for any non-trivial agent
- When the task has specific quality, format, or tool-use requirements
- When choosing between strategies for cost vs. capability tradeoffs

## Implementation baseline

```ts
// Default — adaptive works for most unknown workloads
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning({
    defaultStrategy: "adaptive",
    maxIterations: 12,
  })
  .withTools()
  .withVerification()          // runtime output quality check
  .withCostTracking({ perRequest: 0.30 })
  .build();
```

## Strategy selection guide

| Task type | Strategy | Why |
|-----------|----------|-----|
| Simple Q&A, classification, extraction | `"reactive"` | Single-pass, minimal tokens |
| Multi-step with knowable plan upfront | `"plan-execute-reflect"` | Structured decomposition + reflection |
| Open-ended research, exploration | `"adaptive"` | Auto-escalates when stuck |
| Ambiguous problems needing exploration | `"tree-of-thought"` | Branch multiple paths, prune weak ones |
| Quality-critical iterative refinement | `"reflexion"` | Self-critique loop improves output |
| Unknown complexity | `"adaptive"` | Best safe default |

```ts
// NOTE: strategy name is "plan-execute-reflect" — NOT "plan-execute"
.withReasoning({ defaultStrategy: "plan-execute-reflect", maxIterations: 15 })

// Auto-switch strategy when agent gets stuck (loop detected)
.withReasoning({
  defaultStrategy: "adaptive",
  enableStrategySwitching: true,
  maxStrategySwitches: 2,
  fallbackStrategy: "plan-execute-reflect",  // deterministic fallback (no LLM call)
})
```

## Key patterns

### Required tools gate

Forces the agent to call specific tools before the final answer is accepted:

```ts
.withTools()
.withRequiredTools({
  tools: ["web-search"],   // must be called at least once
  maxRetries: 3,           // retry if model skips
})

// Adaptive mode — framework infers which tools are required from task phrasing
.withRequiredTools({ adaptive: true })
```

### Output quality pipeline

The framework automatically extracts task intent (regex-based, no LLM call) and validates the output format. Supported `OutputFormat` values: `"markdown"`, `"json"`, `"csv"`, `"html"`, `"code"`, `"list"`, `"prose"`.

Hint the desired format in the task prompt and the pipeline validates + repairs if needed:

```ts
// "return as JSON" → framework detects json format, validates output, repairs if needed
await agent.run("Analyse the data and return the results as JSON with keys: summary, score, flags");
```

The `FinalizedOutput` shape: `{ output, formatValidated, synthesized, source, validationReason? }` — available in `result.metadata`.

### Observing strategy switches

Subscribe to EventBus events to track strategy decisions:

```ts
agent.on("StrategySwitchEvaluated", (e) => console.log("Evaluating switch:", e));
agent.on("StrategySwitched", (e) => console.log("Switched to:", e.newStrategy));
```

## Builder API reference

| Method | Key params | Default |
|--------|-----------|---------|
| `.withReasoning(opts?)` | `{ defaultStrategy?, maxIterations?, enableStrategySwitching?, maxStrategySwitches?, fallbackStrategy? }` | adaptive, 10 |
| `.withRequiredTools(cfg)` | `{ tools?: string[], adaptive?: boolean, maxRetries?: number }` | — |
| `.withMaxIterations(n)` | `number` | 10 |
| `.withVerification(opts?)` | `{ hallucinationDetection?, passThreshold?, useLLMTier? }` | — |

## Pitfalls

- `"plan-execute"` throws `StrategyNotFoundError` — the correct name is `"plan-execute-reflect"`
- `"reflexion"` is expensive — each iteration runs a self-critique LLM call; cap `maxIterations` at 6–8
- `"tree-of-thought"` spawns multiple branches — multiply expected token cost by branch factor
- `enableStrategySwitching: true` without `maxStrategySwitches` defaults to 2 — agent may not switch enough for complex tasks
- `withRequiredTools` without `withTools` does nothing — tools must be enabled first
- High `maxIterations` without `.withCostTracking()` can produce runaway costs on stuck agents
