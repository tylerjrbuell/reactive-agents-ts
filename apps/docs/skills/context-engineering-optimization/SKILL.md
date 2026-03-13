---
name: context-engineering-optimization
description: Optimize prompt context for model tier, latency, and token budget using prioritization, compression, and tiered loading.
compatibility: Reactive Agents projects using context profiles and memory retrieval.
metadata:
  author: reactive-agents
  version: "1.0"
---

# Context Engineering Optimization

Use this skill to improve output quality while reducing token waste.

## Agent objective

When implementing context-sensitive agents, generate code that:

- Chooses an explicit context profile for the selected model/provider.
- Preserves token headroom for tool observations and reflection.
- Applies compaction/compression for long-running tasks.

## What this skill does

- Configures model-aware context profiles and token budgets.
- Uses progressive compaction and result compression to reduce context bloat.
- Prioritizes high-signal memory/tool outputs before lower-value history.

## Workflow

1. Rank context by task relevance.
2. Apply a context profile appropriate for the selected model tier.
3. Enable compaction/compression for long-running multi-step tasks.
4. Re-rank and refresh context after each major tool call.

## Baseline guidance

- Reserve ~20% token headroom for tool results and reflection.
- Re-rank after each major step.
- Prefer concise tool result summaries over raw payload replay.

## Expected implementation output

- Builder configuration using reasoning/context options appropriate to workload.
- Prompt assembly logic that ranks high-signal context first.
- Verification step showing reduced token overhead without quality regression.

## Code Examples

### Using Context Profiles

Context profiles automatically adjust prompt construction, context window size, and tool schema richness to match the capabilities of the underlying model. Use `.withContextProfile()` to select a tier.

There are four tiers:
- `local`: For small, local models (e.g., Llama 3 8B). Aggressive compression, minimal prompts.
- `mid`: For mid-range models (e.g., Gemini 1.5 Flash). Balanced approach.
- `large`: For large, powerful models (e.g., GPT-4 Turbo). More detailed context.
- `frontier`: For state-of-the-art models (e.g., Claude 3.5 Sonnet). Maximum context, rich schemas.

```typescript
import { ReactiveAgents } from "@reactive-agents/runtime";

// For a small, local model, use the 'local' tier
const localAgent = await ReactiveAgents.create()
  .withName("local-tier-agent")
  .withProvider("ollama") // Assuming an Ollama provider is configured
  .withModel("llama3")
  .withContextProfile({ tier: "local" })
  .build();

// For a powerful, frontier model, use the 'frontier' tier
const frontierAgent = await ReactiveAgents.create()
  .withName("frontier-tier-agent")
  .withProvider("anthropic")
  .withModel("claude-3.5-sonnet-20240620")
  .withContextProfile({ tier: "frontier" })
  .build();
```

### Tool Result Compression

For long-running tasks with many tool calls, the context can grow very large. The framework automatically compresses tool results to save tokens. This is enabled by default when you use `.withTools()`. You can configure it via `.withTools({ resultCompression: ... })`.

```typescript
import { ReactiveAgents } from "@reactive-agents/runtime";

const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withTools({
    resultCompression: {
      budget: 2000,         // Max chars for compressed tool result
      previewItems: 5,      // Items shown for JSON arrays/objects
      autoStore: true,      // Overflow stored in scratchpad automatically
      codeTransform: true,  // Apply pipe transforms (| transform: <expr>)
    }
  })
  .build();
```

## Pitfalls to avoid

- Full-history stuffing for every request.
- No token headroom for tool observations.
- Static context windows regardless of task complexity.
