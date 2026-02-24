---
title: Context Engineering
description: Model-adaptive context management for efficient, reliable agents.
---

Context engineering is the practice of **finding the smallest set of high-signal tokens that maximize the likelihood of desired outcomes**. Reactive Agents provides a systematic context engineering system that adapts to your model's capabilities.

## Model Context Profiles

Every model has different context capacity, latency characteristics, and instruction-following quality. Context Profiles let you tune all context-related thresholds to match your model tier.

### Tiers

| Tier | Models | Compaction | Tool Result Size | Rules |
|------|--------|-----------|-----------------|-------|
| `local` | Ollama, llama, phi, qwen | Every 4 steps | 400 chars | Simplified |
| `mid` | haiku, mini, flash | Every 6 steps | 800 chars | Standard |
| `large` | sonnet, gpt-4o | Every 8 steps | 1,200 chars | Standard |
| `frontier` | opus, o1, o3 | Every 12 steps | 2,000 chars | Detailed |

### Using Context Profiles

```typescript
// Use the tier auto-detection (inferred from model name)
const agent = await ReactiveAgents.create()
  .withProvider("ollama")
  .withModel("qwen3:4b")
  .withReasoning()
  .withTools()
  .withContextProfile({ tier: "local" })
  .build();

// Override specific thresholds
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withModel("claude-haiku-4-5-20251001")
  .withContextProfile({
    tier: "mid",
    toolResultMaxChars: 1000,   // Override default 800
    compactAfterSteps: 8,        // Start compacting later
  })
  .build();
```

### Profile Properties

| Property | Description |
|----------|-------------|
| `tier` | `"local" \| "mid" \| "large" \| "frontier"` |
| `compactAfterSteps` | Steps before older history is compacted |
| `fullDetailSteps` | Steps kept at full detail during compaction |
| `toolResultMaxChars` | Max chars for tool result in context |
| `rulesComplexity` | `"simplified" \| "standard" \| "detailed"` |
| `promptVerbosity` | `"minimal" \| "standard" \| "full"` |
| `toolSchemaDetail` | `"names-only" \| "names-and-types" \| "full"` |

## Progressive Context Compaction

As agents work through multi-step tasks, context grows. Reactive Agents uses a four-level progressive compaction strategy:

| Level | Applied To | Format |
|-------|-----------|--------|
| **Level 1 — Full Detail** | Last `fullDetailSteps` steps | Complete ReAct format |
| **Level 2 — Summary** | Steps within `compactAfterSteps` window | One-line preview |
| **Level 3 — Grouped** | Older steps | `"Steps 3-8: file-read ×2, file-write ×1"` |
| **Level 4 — Dropped** | Ancient steps without `preserveOnCompaction` | Removed entirely |

**Preservation rules**: Error observations and the first file-write per path are always preserved, regardless of their age.

## Context Budget

The budget system allocates tokens across context sections and adapts as iterations progress:

```typescript
import { allocateBudget, estimateTokens } from "@reactive-agents/reasoning";

const budget = allocateBudget(
  128_000,    // total model context tokens
  profile,    // ContextProfile
  3,          // current iteration
  10,         // max iterations
);

// budget.allocated.stepHistory  → tokens reserved for history
// budget.allocated.toolSchemas  → tokens for tool definitions
// budget.remaining              → tokens still available
```

## Scratchpad Tool

The `scratchpad-write` / `scratchpad-read` built-in tools let agents persist notes **outside the context window**. Notes survive compaction and are available across tool calls.

```
ACTION: scratchpad-write({"key": "plan", "content": "Step 1: search, Step 2: write report"})
Observation: {"saved": true, "key": "plan"}

ACTION: scratchpad-read({"key": "plan"})
Observation: {"key": "plan", "content": "Step 1: search, Step 2: write report"}
```

This implements Anthropic's recommended **structured note-taking** pattern for long-horizon tasks.

## Structured Tool Observations

Every tool result is now tracked as a typed `ObservationResult`:

```typescript
import { categorizeToolName, deriveResultKind } from "@reactive-agents/reasoning";

// Category is automatically derived from tool name
// "file-write"  → category: "file-write",  resultKind: "side-effect"
// "web-search"  → category: "web-search",  resultKind: "data"
// "file-read"   → category: "file-read",   resultKind: "data"
// any error     → category: "error",       preserveOnCompaction: true
```

## Real Sub-Agent Delegation

`.withAgentTool()` now creates real sub-agents with clean context windows:

```typescript
const coordinator = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning()
  .withTools()
  .withAgentTool("researcher", {
    name: "researcher",
    description: "Research specialist for web searches",
    provider: "anthropic",
    model: "claude-haiku-4-5-20251001",
    maxIterations: 5,
    systemPrompt: "You are a research specialist. Search the web and summarize findings.",
  })
  .build();

// coordinator can now call "researcher" as a tool
// Sub-agent runs with clean context + focused prompt
// Returns structured: { subAgentName, success, summary, tokensUsed }
```

Sub-agents are depth-limited to 3 levels (`MAX_RECURSION_DEPTH`) to prevent infinite delegation.

### Dynamic Sub-Agent Spawning

For ad-hoc delegation where you don't know ahead of time what sub-tasks the agent will need to delegate, use `.withDynamicSubAgents()`. This registers the built-in `spawn-agent` tool, which the model can invoke freely at runtime:

```typescript
const agent = await ReactiveAgents.create()
  .withTools()
  .withDynamicSubAgents({ maxIterations: 5 })
  .build();
```

The model calls `spawn-agent(task, name?, model?, maxIterations?)` whenever it decides a subtask benefits from a clean context window. Sub-agents inherit the parent's provider and model by default.

**Comparison:**

| Approach | When to use |
|---|---|
| `.withAgentTool("name", config)` | Named, purpose-built sub-agent with a specific role |
| `.withDynamicSubAgents()` | Ad-hoc delegation at model's discretion, unknown tasks |

Depth is capped at `MAX_RECURSION_DEPTH = 3`. Spawned sub-agents do not inherit the `spawn-agent` tool by default, naturally containing recursion.

## Tier-Aware Prompt Templates

Prompt templates automatically select tier-specific variants when available:

| Template | Available Tiers |
|---------|----------------|
| `reasoning.react-system` | base, `:local`, `:frontier` |
| `reasoning.react-thought` | base, `:local`, `:frontier` |

The system resolves `reasoning.react-system:local` first, then falls back to `reasoning.react-system`.

## Real-World Performance

Verified with cogito:14b (Ollama) across 9 scenarios:

| Category | Avg Steps | Avg Tokens | Avg Time |
|----------|-----------|-----------|---------|
| Tool use (S1-S5) | 6.3 | 1,899 | 4.1s |
| Error recovery (S6) | 10.0 | 2,630 | 5.1s |
| Compaction stress (S7) | 13.0 | 3,978 | 8.9s |
| Pure reasoning (S8) | 1.0 | 1,017 | 2.5s |
| **Overall (9 scenarios)** | **6.4** | **2,093** | **4.4s** |

All well within targets: <= 8 steps, <= 5,000 tokens, <= 15s.
