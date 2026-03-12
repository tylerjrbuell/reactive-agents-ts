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
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning({ enableStrategySwitching: true, maxStrategySwitches: 2 })
  .build();
```

For a direct conversational query with no tool use, skip the ReAct loop entirely:

```typescript
const result = await agent.chat("What is the capital of France?");
console.log(result.answer);
```

`agent.chat()` routes directly to the LLM without invoking any reasoning strategy, making it significantly faster and cheaper for simple Q&A.
