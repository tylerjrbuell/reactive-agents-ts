---
name: recipe-research-agent
description: Full recipe for a web research agent with memory, semantic search, hallucination verification, and source-cited synthesis.
compatibility: Reactive Agents TypeScript projects using @reactive-agents/*
metadata:
  author: reactive-agents
  version: "2.0"
  tier: "recipe"
---

# Recipe: Research Agent

## What this builds

A research agent that searches the web, retrieves full page content, deduplicates findings against past research in persistent memory, verifies factual accuracy, and returns a cited summary.

## Skills loaded by this recipe

- `reasoning-strategy-selection` — plan-execute-reflect strategy
- `memory-patterns` — enhanced memory for cross-session recall
- `tool-creation` — allowedTools configuration
- `quality-assurance` — hallucination detection

## Complete implementation

```ts
import { ReactiveAgents } from "@reactive-agents/runtime";

const agent = await ReactiveAgents.create()
  .withName("researcher")
  .withProvider("anthropic")
  .withReasoning({
    defaultStrategy: "plan-execute-reflect",
    maxIterations: 20,
  })
  .withTools({
    allowedTools: ["web-search", "http-get", "checkpoint", "recall", "final-answer"],
  })
  .withMemory({
    tier: "enhanced",
    dbPath: "./memory/research.db",
  })
  .withVerification({
    hallucinationDetection: true,
    hallucinationThreshold: 0.15,
    passThreshold: 0.75,
  })
  .withObservability({ verbosity: "normal" })
  .withSystemPrompt(`
    You are a research agent. For every research task:

    1. Use recall("topic keywords") to check for prior research on this topic.
    2. Use web-search to find 3-5 authoritative sources.
    3. Use http-get to retrieve full content from the most relevant pages.
    4. Checkpoint your raw findings before synthesizing.
    5. Synthesize a comprehensive answer with inline citations (source URL).
    6. Do not state facts you cannot attribute to a retrieved source.
  `)
  .build();

// Run a one-shot research task
const result = await agent.run(
  "What are the latest developments in quantum error correction?"
);
console.log(result.output);
console.log(`Cost: $${result.cost?.total.toFixed(4)}`);

// Run multiple research tasks in sequence (memory persists between runs)
const topics = [
  "Quantum error correction breakthroughs 2025",
  "Topological qubits vs superconducting qubits comparison",
  "Timeline for fault-tolerant quantum computers",
];

for (const topic of topics) {
  const r = await agent.run(topic);
  console.log(`\n## ${topic}\n${r.output}`);
}

// Clean up
await agent.dispose();
```

## Customization options

### Add RAG documents alongside web search

```ts
.withDocuments([
  { id: "internal-wiki", content: wikiContent, metadata: { source: "wiki" } },
  { id: "product-docs", content: docsContent, metadata: { source: "docs" } },
])
.withTools({
  allowedTools: ["rag-search", "web-search", "http-get", "recall", "checkpoint"],
})
// rag-search queries .withDocuments() content
// recall queries past research in memory
// web-search searches the live web
```

### Cost-bounded research

```ts
.withCostTracking({ perSession: 0.50, daily: 5.0 })
// Stops if a single research task would exceed $0.50
```

### Lighter model for broad searches

```ts
.withProvider("anthropic")
.withModel("claude-haiku-4-5-20251001")
// Use a cheaper model for initial searches; results still verified
```

## Expected output shape

```ts
const result = await agent.run("Research topic...");
// result.output   — markdown string with synthesis and citations
// result.cost     — { input: number, output: number, total: number } (USD)
// result.steps    — KernelStep[] with tool call details
// result.metadata — { iterations: number, strategy: string }
```

## Pitfalls

- `http-get` on large pages returns truncated content — set a generous `maxOutputChars` if deep content retrieval is needed
- `recall` only searches memory that was previously checkpointed — instruct the agent to checkpoint findings after each session
- `hallucinationDetection: true` adds one extra LLM call per verification pass — budget accordingly
- `plan-execute-reflect` with `maxIterations: 20` can do up to 20 tool calls — set a `perSession` budget in `.withCostTracking()` for cost control
