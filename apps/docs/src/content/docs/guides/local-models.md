---
title: Local Models Guide
description: Choose the right local model for your task and configure Reactive Agents for optimal performance
---

# Local Models Guide

Reactive Agents is designed to work with local models via Ollama. The model-adaptive context system automatically tunes prompts, compaction, and truncation for smaller models — but choosing the right model for your task matters.

## Quick Setup

```bash
# Install Ollama (macOS/Linux)
curl -fsSL https://ollama.com/install.sh | sh

# Pull a recommended model
ollama pull qwen3:14b
```

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("ollama")
  .withModel("qwen3:14b")
  .withReasoning()
  .withTools()
  .withContextProfile({ tier: "local" })
  .build();
```

## Model Recommendations

### By Task Type

| Task | Recommended Model | Tier | Why |
|------|-------------------|------|-----|
| Simple Q&A (no tools) | `qwen3:4b` | local | Fast, low memory, good for chat |
| Tool-calling tasks | `qwen3:14b` | local | Best native FC accuracy at this size |
| Research with web search | `qwen3:14b` or `llama3.1:8b` | local | Reliable native function calling |
| Code generation | `qwen2.5-coder:14b` | local | Specialized for code tasks |
| Complex reasoning | `cogito:14b` | local | Extended thinking mode support |
| Multi-step planning | `qwen3:14b` with Plan-Execute | local | Structured plan generation |

### Model Comparison

| Model | Params | Context | Native FC | Instruction Following | Speed | Memory |
|-------|--------|---------|:---------:|:--------------------:|-------|--------|
| `qwen3:4b` | 4B | 32K | Fair | Fair | Fast | ~3GB |
| `llama3.1:8b` | 8B | 128K | Good | Good | Medium | ~5GB |
| `qwen3:8b` | 8B | 32K | Good | Good | Medium | ~5GB |
| `phi-4:14b` | 14B | 16K | Good | Fair | Medium | ~9GB |
| `qwen3:14b` | 14B | 32K | Best | Best | Slower | ~9GB |
| `cogito:14b` | 14B | 32K | Good | Good | Slower | ~9GB |
| `llama3.1:70b` | 70B | 128K | Excellent | Excellent | Slow | ~40GB |

**Legend:**
- **Native FC**: How reliably the model generates valid native function call (tool_use) responses
- **Instruction Following**: How well the model follows system prompt instructions and multi-step tasks
- **Speed**: Tokens per second on typical hardware (relative)
- **Memory**: Approximate VRAM/RAM required

## Context Profile Tiers

Always set the context profile to match your model:

```typescript
// Small models (<=8B params)
.withContextProfile({ tier: "local" })
// → Lean prompts, aggressive compaction after 6 steps, 800-char truncation

// Medium models (8B-30B params)
.withContextProfile({ tier: "mid" })
// → Balanced prompts, moderate compaction

// Large cloud models
.withContextProfile({ tier: "large" })
// → Full context, standard compaction

// Frontier models (Claude Opus, GPT-4, Gemini Pro)
.withContextProfile({ tier: "frontier" })
// → Maximum context, minimal compaction
```

**Important:** If you skip `.withContextProfile()`, the framework uses `"large"` tier defaults — which wastes tokens and confuses smaller models with verbose prompts.

## Strategy Recommendations for Local Models

Not all reasoning strategies work well on small models:

| Strategy | <=8B | 14B | 70B | Notes |
|----------|:----:|:---:|:---:|-------|
| **ReAct** | Good | Best | Best | Most reliable for local models |
| **Reflexion** | Poor | Fair | Good | Self-critique requires model quality |
| **Plan-Execute** | Poor | Fair | Good | Structured plan generation is fragile on small models |
| **Tree-of-Thought** | Poor | Poor | Fair | BFS scoring unreliable below 70B |
| **Adaptive** | Fair | Good | Best | Falls back to ReAct on small models (good) |

**Recommendation:** Use `"reactive"` (ReAct) as default strategy for all local models. Only use `"adaptive"` if you're running 14B+ and want automatic strategy selection.

## Common Pitfalls

### 1. Model hallucinates tool calls
**Symptom:** Agent calls tools that don't exist or uses wrong parameter names.
**Fix:** Use `.withContextProfile({ tier: "local" })` and keep tool count low (3-5 tools max). Use `.withTools({ include: [...] })` to limit visible tools.

### 2. Agent loops without making progress
**Symptom:** Agent repeats the same action or thought.
**Fix:** The circuit breaker will catch this, but you can reduce iterations with `.withMaxIterations(5)`. Consider simpler prompts.

### 3. Native function calling not supported or unreliable
**Symptom:** Agent fails to invoke tools or returns malformed tool call responses.
**Fix:** Switch to a model with better native FC support (`qwen3:14b` > `llama3.1:8b` for this). The framework uses native function calling (tool_use blocks) for all providers — the model must support the Ollama tool calling API. The `local` context profile uses simplified tool schemas to reduce parsing burden on smaller models.

### 4. Out of memory
**Symptom:** Ollama crashes or becomes unresponsive.
**Fix:** Use a smaller model or enable quantization: `ollama pull qwen3:14b-q4_K_M`. The q4 quantization uses ~60% less memory with minimal quality loss.

### 5. Sub-agents perform poorly
**Symptom:** Spawned sub-agents hallucinate or loop.
**Fix:** Known limitation — small models struggle with sub-agent tasks. Disable dynamic sub-agents (`.withDynamicSubAgents()`) for local models. Use static sub-agents with explicit task descriptions instead.

## Cost Comparison

| Setup | Monthly Cost | Latency | Quality |
|-------|-------------|---------|---------|
| Ollama + qwen3:14b (local) | $0 (electricity only) | 1-5s/response | Good for most tasks |
| Anthropic claude-haiku | ~$5-15/month | 0.5-2s | Better quality |
| Anthropic claude-sonnet | ~$15-50/month | 1-3s | Best quality |
| Ollama + llama3.1:70b (beefy local) | $0 | 3-10s | Near cloud quality |

## Full Example

```typescript
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withName("local-researcher")
  .withProvider("ollama")
  .withModel("qwen3:14b")
  .withReasoning({ defaultStrategy: "reactive" })
  .withTools({ include: ["web-search", "file-read", "file-write"] })
  .withContextProfile({ tier: "local" })
  .withMaxIterations(8)
  .withMemory()
  .withObservability({ verbosity: "normal" })
  .build();

const result = await agent.run("Research TypeScript testing frameworks and write a summary");
console.log(result.output);
console.log(result.metadata); // { duration, cost: 0, tokensUsed, stepsCount }
```
