---
name: memory-consolidation
description: Configure working, episodic, semantic, and procedural memory with consolidation rules optimized for local and frontier models.
compatibility: Reactive Agents projects using @reactive-agents/memory.
metadata:
  author: reactive-agents
  version: "1.0"
---

# Memory Consolidation

Use this skill when memory quality and retrieval cost matter.

## Agent objective

When implementing memory-heavy agents, generate designs that:

- Keep task-local state in working memory.
- Promote only high-confidence durable knowledge.
- Prevent context growth from reducing execution quality.

## What this skill does

- Designs memory tier usage for task lifecycle.
- Defines promotion/consolidation triggers.
- Reduces context bloat through summarization and retrieval ranking.

## Workflow

1. Keep active task state in working memory only.
2. Persist outcomes and traces in episodic memory.
3. Promote durable facts to semantic memory on confidence thresholds.
4. Store repeatable successful patterns in procedural memory.
5. Compress old context and retain retrieval pointers.

## Validation checklist

- Retrieval returns relevant facts in top-k results.
- Token usage decreases after consolidation.
- Repeated task quality improves from procedural matches.

## Code Examples

### Multi-Turn Conversational Agent

This example demonstrates how to enable memory for an agent, allowing it to persist information across multiple turns of a conversation. The `.withMemory()` builder method enables the memory layer, which is backed by SQLite for persistence.

The agent is asked a series of related questions. Because memory is enabled, it can use the context from previous turns to provide more informed answers in later turns.

*Source: [apps/examples/src/foundations/03-multi-turn-memory.ts](apps/examples/src/foundations/03-multi-turn-memory.ts)*

```typescript
import { ReactiveAgents } from "@reactive-agents/runtime";

// ...

const agent = await ReactiveAgents.create()
  .withName("conversational")
  .withProvider("anthropic")
  .withMemory("1") // Use a unique ID for the memory session
  .withMaxIterations(3)
  .build();

const questions = [
  "What is TypeScript and why is it useful?",
  "What is Effect-TS and what problems does it solve?",
  "How do TypeScript and Effect-TS compare and complement each other?",
];

for (const q of questions) {
  const result = await agent.run(q);
  console.log(`Q: ${q}\nA: ${result.output}\n`);
}
```

## Expected implementation output

- A clear memory-tier policy for working, episodic, semantic, and procedural data.
- Retrieval/promotion criteria that can be tested with repeated tasks.
- Observability hooks for memory effectiveness and drift.

## Session persistence

For multi-turn conversations that need to survive process restarts, enable session persistence:

```ts
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withMemory("1")
  .withReasoning()
  .build();

// Persistent session — saved to SQLite via SessionStoreService
const session = agent.session({ persist: true, id: "user-session-42" });
await session.chat("Start researching quantum computing");
// On next process start, restore the session by passing the same id:
const restored = agent.session({ persist: true, id: "user-session-42" });
await restored.chat("Continue where we left off");
```

Session persistence requires `.withMemory()` to be enabled (memory layer provides the SQLite store).

## Background consolidation

```ts
// Enable background decay + consolidation
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withMemory("2")
  .withMemoryConsolidation({
    threshold: 50,       // Trigger consolidation after 50 episodic entries
    decayFactor: 0.05,   // 5% importance decay per consolidation cycle
    pruneThreshold: 0.1, // Prune entries with importance below 10%
  })
  .build();
```

## Pitfalls to avoid

- Dumping full transcripts into every prompt.
- Promoting low-confidence facts into semantic memory.
- Never pruning stale episodic artifacts.
- Using `agent.session({ persist: true })` without `.withMemory()` — it silently no-ops.
