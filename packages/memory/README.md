# @reactive-agents/memory

> Version: **0.10.2** — memory system for [Reactive Agents](https://docs.reactiveagents.dev/).

Four memory tiers — **Working**, **Semantic**, **Episodic**, **Procedural** — backed by
`bun:sqlite` with FTS5 full-text search (Tier 1) and optional `sqlite-vec` KNN vectors (Tier 2).
Plus an `ExperienceStore` for cross-agent learning, a background `MemoryConsolidator` (decay +
summarization), a Zettelkasten link index, and the `SessionStore` that powers gateway chat mode.

## Installation

```bash
bun add @reactive-agents/memory
```

> **Requires Bun** — uses `bun:sqlite` natively. Tier 2 also requires the `sqlite-vec` extension,
> which `bun:sqlite` loads at runtime.

## Memory tiers

| Service | Purpose | Backend |
|---|---|---|
| `WorkingMemoryService` | Short-term in-session items, LRU-evicted | SQLite (in-memory or file) |
| `SemanticMemoryService` | Long-term knowledge, FTS5 + optional vec | SQLite + FTS5 |
| `EpisodicMemoryService` | Conversation / session history (turns, snapshots) | SQLite |
| `ProceduralMemoryService` | Learned workflows / step sequences | SQLite |

Cross-cutting:

- **`ExperienceStore`** — per-(agent, model) records of tool patterns, error recoveries, success
  signals; consumed by the calibration system.
- **`MemoryConsolidatorService`** — background decay + summarization; rolls older episodic turns
  into compact summaries.
- **`ZettelkastenService`** — bidirectional links between memory entries.
- **`SessionStoreService`** — persistent (platform, sender) chat sessions (used by gateway chat
  mode).
- **`SkillStoreService`** / **`DebriefStoreService`** / **`PlanStoreService`** — auxiliary stores
  for the kernel and skill system.
- **`AgentMemoryFromMemoryService`** — port adapter that satisfies the narrow `AgentMemory` Tag in
  `@reactive-agents/core` from a `MemoryService` provider.

## Two retrieval tiers

- **Tier 1 — FTS5.** Fast, deterministic keyword search; no embeddings required.
  Best for short, key-term queries. Verbose natural-language queries should be decomposed first.
- **Tier 2 — vector search.** `sqlite-vec` KNN; requires an embedding provider (OpenAI,
  Anthropic-compatible, or Ollama).

## Quick example

```typescript
import { ReactiveAgents } from "@reactive-agents/runtime";

const agent = await ReactiveAgents.create()
  .withName("my-agent")
  .withProvider("anthropic")
  .withModel("claude-sonnet-4-20250514")
  .withMemory("1") // "1" = FTS5; "2" = vector embeddings
  .build();

const r1 = await agent.run("Remember that my favorite color is blue.");
const r2 = await agent.run("What's my favorite color?"); // recalls 'blue'
```

For finer control, `withMemory({ tier, dbPath, working, semantic, episodic, procedural })`
exposes per-service options.

## Direct service usage

```typescript
import { Effect, Layer } from "effect";
import {
  MemoryServiceLive,
  SemanticMemoryService,
  ExperienceStoreLive,
  createMemoryLayer,
} from "@reactive-agents/memory";

const layer = createMemoryLayer({ tier: "1", dbPath: "./memory.db" });

await Effect.runPromise(
  Effect.gen(function* () {
    const sem = yield* SemanticMemoryService;
    yield* sem.store({ content: "RAFT is a consensus algorithm...", tags: ["distsys"] });
    return yield* sem.search({ query: "consensus", limit: 5 });
  }).pipe(Effect.provide(layer)),
);
```

## Environment variables (Tier 2 only)

```bash
EMBEDDING_PROVIDER=openai          # openai | anthropic | ollama | custom
EMBEDDING_MODEL=text-embedding-3-small
OPENAI_API_KEY=sk-...
```

## Gateway chat session persistence

When `.withGateway()` and `.withChannels()` are combined in chat mode, the runtime uses
`SessionStoreService` from this package to persist `(platform, senderId)` conversations across
process restarts. Each session is windowed (40 turns / 8 KiB), compacted daily, and pruned by TTL.

## Experience store (cross-agent learning)

```typescript
import { ExperienceStore } from "@reactive-agents/memory";

const exp = yield* ExperienceStore;
yield* exp.record({
  agentId: "researcher",
  modelId: "claude-sonnet-4-20250514",
  toolName: "web-search",
  outcome: "success",
  /* ... */
});

const summary = yield* exp.queryByModel("claude-sonnet-4-20250514");
```

`ExperienceSummary` materialization feeds the calibration system in `@reactive-agents/llm-provider`.

## Documentation

- Memory guide: [docs.reactiveagents.dev/guides/memory/](https://docs.reactiveagents.dev/guides/memory/)
- Calibration: [docs.reactiveagents.dev/guides/calibration/](https://docs.reactiveagents.dev/guides/calibration/)
- Related: [`@reactive-agents/runtime`](../runtime/README.md),
  [`@reactive-agents/llm-provider`](../llm-provider/README.md),
  [`@reactive-agents/gateway`](../gateway/README.md).

## License

MIT
