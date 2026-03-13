---
title: "Choosing a Reasoning Strategy"
description: "Decision tree and performance characteristics for selecting the right reasoning strategy"
---

Reactive Agents ships five reasoning strategies. Picking the right one has a significant impact on token usage, latency, and answer quality. This guide helps you make that choice systematically.

## Decision Tree

```
What kind of task are you running?
│
├─ Single-step Q&A, no tools needed
│   └─ Use agent.chat() — direct LLM call, no ReAct loop overhead
│
├─ Multi-step with tools, general tasks
│   └─ ReAct (default)
│       .withReasoning()
│
├─ Needs a structured step-by-step plan
│   └─ Plan-Execute-Reflect
│       .withReasoning({ defaultStrategy: "plan-execute-reflect" })
│
├─ Quality-critical, factual accuracy matters
│   └─ Reflexion
│       .withReasoning({ defaultStrategy: "reflexion" })
│
├─ Creative, exploratory, or ambiguous problem
│   └─ Tree-of-Thought
│       .withReasoning({ defaultStrategy: "tree-of-thought" })
│
├─ Mixed workload — task type varies per subtask
│   └─ Adaptive
│       .withReasoning({ defaultStrategy: "adaptive", adaptive: { enabled: true } })
│
└─ Unknown complexity, want automatic switching when stuck
    └─ Enable strategy switching
        .withReasoning({ enableStrategySwitching: true })
```

## Strategy Comparison

| Strategy | Avg Tokens | Latency | Iterations | Best For | Min Model Size |
|---|---|---|---|---|---|
| ReAct | Low–Med | Fast | 3–10 | Tool-use tasks, API calls, lookups | 4B+ |
| Plan-Execute-Reflect | Med–High | Medium | 5–15 | Structured workflows, multi-file tasks | 14B+ |
| Reflexion | Medium | Medium | 3–8 | Factual Q&A, accuracy-critical | 8B+ |
| Tree-of-Thought | High | Slow | 5–20 | Creative writing, ambiguous problems | 14B+ |
| Adaptive | Varies | Varies | Varies | Mixed workloads, changing task types | 8B+ |

## Strategy Deep Dives

### ReAct (Reason + Act)

The default strategy. Each iteration follows: Think → Act (tool call) → Observe (result) → repeat until the task is complete.

**Strengths:**
- Fast and token-efficient
- Works reliably on 4B+ models
- Best fit for tool-heavy tasks (API calls, file operations, lookups)

**Requirements:** Tools must be registered via `.withTools()`.

---

### Plan-Execute-Reflect

Generates a structured JSON plan before taking any action, then executes each step individually (via tool call or LLM analysis), and reflects after completion to refine or replan.

**Strengths:**
- Handles complex multi-step workflows with dependencies between steps
- Produces structured, auditable output
- Plans are persisted in SQLite for inspection and replay

**Requirements:** A 14B+ model is recommended for reliable JSON plan generation. `.withMemory()` is recommended so the plan store has a backing layer.

---

### Reflexion

Adds a self-evaluation loop: Think → Act → Evaluate answer quality → If insufficient, revise with critique → repeat. Prior critiques are stored in episodic memory and used to improve subsequent attempts.

**Strengths:**
- Self-correcting — identifies and addresses gaps in its own reasoning
- High accuracy on factual tasks
- Learns from prior run critiques across sessions when episodic memory is enabled

**Requirements:** 8B+ model. Benefits significantly from episodic memory via `.withMemory({ tier: "standard" })`.

---

### Tree-of-Thought

Generates multiple candidate thoughts at each step, scores them, and expands the most promising branches (BFS or DFS). Only the highest-scoring path is executed.

**Strengths:**
- Explores multiple solution paths before committing
- Best for creative, ambiguous, or open-ended problems
- Tolerates underspecified prompts better than linear strategies

**Requirements:** 14B+ model. Token usage is significantly higher than other strategies — budget accordingly.

---

### Adaptive

Selects the most appropriate strategy per-iteration based on observed task characteristics. Simple analytical steps are routed to fast strategies; complex or uncertain steps are escalated.

**Strengths:**
- Handles mixed workloads where task complexity shifts mid-run
- Routes simple steps to fast strategies, reducing unnecessary overhead
- No single-strategy lock-in

**Requirements:** Must explicitly set `adaptive: { enabled: true }` in the reasoning options. An 8B+ model is recommended.

---

## Automatic Strategy Switching

When you enable strategy switching, the framework monitors execution and can automatically switch to a different strategy mid-run if the current one appears to be stuck.

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning({
    enableStrategySwitching: true,  // default: false
    maxStrategySwitches: 2,         // default: 1
  })
  .build();
```

### What triggers a switch

The kernel runner detects a loop condition when any of the following occur repeatedly within a sliding window of recent steps:

- The same tool is called with identical arguments multiple times
- The same thought text appears in consecutive iterations
- Multiple consecutive `think` steps occur without any `act` step in between

When a loop is detected, the framework pauses execution and evaluates whether to continue with the current strategy or hand off to a different one.

### Evaluation mechanism

By default, an **LLM evaluator** is called with the current task, the last few steps, and a summary of the stuck pattern. It returns a recommended strategy and a rationale. The evaluation result is surfaced as an EventBus event (`StrategySwitchEvaluated`) before any switch occurs.

If you want deterministic switching without an extra LLM call, set `fallbackStrategy` directly:

```typescript
.withReasoning({
  enableStrategySwitching: true,
  fallbackStrategy: "plan-execute-reflect",  // skip LLM evaluator, always switch to this
})
```

When `fallbackStrategy` is set, the evaluator is bypassed and the agent switches immediately to the named strategy.

### Handoff context

When a strategy switch occurs, the new strategy receives a `StrategyHandoff` object containing:
- The task description
- All steps completed so far (thoughts, actions, observations)
- The stuck pattern that triggered the switch
- The evaluator's rationale (or `"fallback"` if `fallbackStrategy` was used)

This ensures the new strategy can pick up where the old one left off rather than restarting from scratch.

### EventBus events

Two events are emitted around strategy switches. Subscribe to them via `agent.subscribe()` for observability or custom logic:

| Event | When emitted | Key fields |
|-------|-------------|------------|
| `StrategySwitchEvaluated` | After the evaluator runs, before switching | `taskId`, `fromStrategy`, `recommendedStrategy`, `rationale`, `willSwitch` |
| `StrategySwitched` | After the switch completes | `taskId`, `fromStrategy`, `toStrategy`, `switchNumber`, `stepsCarriedOver` |

```typescript
await agent.subscribe("StrategySwitchEvaluated", (event) => {
  console.log(`[eval] ${event.fromStrategy} → ${event.recommendedStrategy}: ${event.rationale}`);
});

await agent.subscribe("StrategySwitched", (event) => {
  console.log(`[switch ${event.switchNumber}] ${event.fromStrategy} → ${event.toStrategy}`);
  console.log(`  ${event.stepsCarriedOver} steps carried over`);
});
```

### Switch cap

`maxStrategySwitches` (default: 1) limits how many times the strategy can change within a single run. Once the cap is reached, the framework continues with the last active strategy regardless of further loop detection, and logs a warning.

### When to use it

Strategy switching is most useful when:
- You're running tasks with **unknown complexity** and don't want to over-provision (e.g., start with ReAct, escalate to Plan-Execute-Reflect only if needed)
- You're experimenting with agent behavior and want a safety net against runaway loops
- You're running a **mixed workload** where the primary task is clear but subtasks may vary

For tasks where you already know the complexity profile, it's more token-efficient to pick the right strategy upfront using the decision tree above.

---

## Local Model Recommendations

### 4B models (e.g., phi-4-mini, gemma-3-4b)

Use **ReAct only**. Keep `maxIterations` at 10 or below. Avoid Plan-Execute-Reflect — these models struggle to produce reliable structured JSON plans and tend to loop.

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("ollama")
  .withReasoning({ maxIterations: 10 })
  .build();
```

### 8B models (e.g., llama-3.1-8b, gemma-3-12b)

ReAct and Reflexion are both viable. Plan-Execute-Reflect is experimental — it works for simple plans but may produce malformed JSON on complex multi-step tasks.

### 14B models (e.g., qwen3-14b, phi-4-14b)

All five strategies are viable. Plan-Execute-Reflect produces reliable structured plans at this tier. This is the recommended minimum for production use with complex workflows.

### 70B+ models (e.g., llama-3.3-70b, qwen3-72b)

All strategies work at their best. Tree-of-Thought and Plan-Execute-Reflect are particularly strong at this tier and are appropriate for quality-critical production workloads.

---

## Configuration Examples

```typescript
// Default: ReAct
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning()
  .build();

// Plan-Execute-Reflect
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning({ defaultStrategy: "plan-execute-reflect" })
  .build();

// Reflexion with episodic memory
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning({ defaultStrategy: "reflexion" })
  .withMemory({ tier: "standard" })
  .build();

// Tree-of-Thought
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning({ defaultStrategy: "tree-of-thought" })
  .build();

// Adaptive
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning({ defaultStrategy: "adaptive", adaptive: { enabled: true } })
  .build();

// Dynamic strategy switching (auto-switches when stuck)
// See "Automatic Strategy Switching" section above for full options and EventBus events
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning({
    enableStrategySwitching: true,
    maxStrategySwitches: 2,
    // fallbackStrategy: "plan-execute-reflect",  // optional: skip LLM evaluator
  })
  .build();
```

For a direct conversational query with no tool use, skip the ReAct loop entirely:

```typescript
const result = await agent.chat("What is the capital of France?");
console.log(result.answer);
```

`agent.chat()` routes directly to the LLM without invoking any reasoning strategy, making it significantly faster and cheaper for simple Q&A.
