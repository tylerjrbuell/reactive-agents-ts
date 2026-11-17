---
title: Memory, learning and context
description: >-
  Builder reference for withMemory, cross-run learning, debriefs, skill persistence, consolidation, RAG documents and task context.
sidebar:
  order: 4
topic: config-reference
related:
  - reference/builder-api
  - guides/memory
  - guides/context-engineering
---

Methods that give the agent state beyond a single run: memory layers, cross-run learning and debriefs, document retrieval and background task context. Part of the [builder reference](/reference/builder-api/).

## Memory

| Method       | Signature                                         | Description                                                                                                                                                                         |
| ------------ | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `withMemory` | `(options?: MemoryOptions \| "1" \| "2") => this` | Enable memory — **OFF by default as of v0.12** (a bare build is stateless). Prefer `.withMemory()` or `.withMemory({ tier: "enhanced", ... })`. Strings `"1"` / `"2"` still work with a deprecation warning (`"1"` → standard, `"2"` → enhanced). Also enabled by `HarnessProfile.balanced()` / `.intelligent()`. |

### MemoryOptions

| Field                 | Type                              | Default / notes                                                  |
| --------------------- | --------------------------------- | ---------------------------------------------------------------- |
| `tier`                | `"standard" \| "enhanced"`        | `"standard"` — enhanced = 4-layer memory + embeddings            |
| `dbPath`              | `string`                          | SQLite path (default `~/.reactive-agents/memory/{agentId}/memory.db`) |
| `maxEntries`          | `number`                          | Compaction cap                                                   |
| `capacity`            | `number`                          | Working memory slots (default `7`)                               |
| `evictionPolicy`      | `"fifo" \| "lru" \| "importance"` | Working set eviction                                             |
| `retainDays`          | `number`                          | Episodic retention                                               |
| `importanceThreshold` | `number`                          | Semantic inclusion threshold                                     |

## Learning, documents and task context

| Method                               | Description                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `withExperienceLearning()`           | `ExperienceStore` cross-agent tips                                                                                                                                                                                                                                                                                                                                                                           |
| `withLearning(opts?)`                | Enable the cross-run learning store: `{ tier?: "standard" \| "enhanced", dbPath? }`. Experience + skill learning that compounds across sessions.                                                                                                                                                                                                                                                              |
| `withDebrief(enabled?)`              | Synthesize and store a post-run debrief. Unset, it follows `withMemory()` (on with memory, off without). `withDebrief()` turns it on with memory off (only the debrief table is written, to the memory database path); `withDebrief(false)` turns it off with memory on. Config key: `debrief`. |
| `withSkillPersistence(enabled?)`     | Persist learned `SkillRecord`s across process restarts (SQLite-backed). Defaults to `true` when called; also enabled by `HarnessProfile.intelligent()`.                                                                                                                                                                                                                                                       |
| `withMemoryConsolidation(config?)`   | Background consolidation: `{ threshold?, decayFactor?, pruneThreshold? }`                                                                                                                                                                                                                                                                                                                                    |
| `withSelfImprovement()`              | Strategy outcome logging for later bootstrap hints                                                                                                                                                                                                                                                                                                                                                           |
| `withDocuments(docs, options?)`      | Chunk + index `DocumentSpec[]` into the agent's own document store; retrieval is served through the unified `find` meta-tool. Enables tools if needed. Each agent searches only its own store; pass `{ store: createDocumentStore() }` (the same store) to several builders to share documents between them |
| `withTaskContext(record)`            | `Record<string, string>` of background facts injected into reasoning context — distinct from system prompt instructions                                                                                                                                                                                                                                                                                      |
