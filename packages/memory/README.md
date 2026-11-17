# @reactive-agents/memory

> Four-layer SQLite memory (working, semantic, episodic, procedural) with FTS5 search and optional vector retrieval, for agents built with Reactive Agents.

> **Stability:** unstable. Cross-run learning stores (experience, skills) are still settling their schema; pin exact versions if you depend on them.

## Install

```bash
bun add @reactive-agents/memory
# or: npm install @reactive-agents/memory
```

Most apps enable memory through the builder in `@reactive-agents/runtime` (also re-exported by `reactive-agents`). Install this package directly to use the services on their own.

## Usage

Memory is opt-in and off by default.

```ts
import { ReactiveAgents } from "@reactive-agents/runtime";

const agent = await ReactiveAgents.create()
  .withName("my-agent")
  .withProvider("anthropic")
  .withModel("claude-sonnet-4-6")
  .withMemory() // standard tier: FTS5 keyword retrieval, no embeddings needed
  .build();

await agent.run("Remember that my favorite color is blue.");
const result = await agent.run("What's my favorite color?");
```

`.withMemory({ tier: "enhanced" })` adds `sqlite-vec` KNN retrieval and needs an embedding provider. Without `dbPath`, the store lives at `~/.reactive-agents/memory/<agentId>/memory.db`. All options, tiers and environment variables are in the memory guide below.

## API

| Export | Use it when |
|---|---|
| `createMemoryLayer(tier, config)` | You want the memory services as an Effect `Layer` outside the builder. `tier` is `"1"` or `"2"`. |
| `WorkingMemoryService` | Short-term, LRU-evicted in-session items. |
| `SemanticMemoryService` | Long-term facts with FTS5 search (`LIKE` fallback on Node). |
| `EpisodicMemoryService` | Session history: turns and snapshots. |
| `ProceduralMemoryService` | Learned workflows and step sequences. |
| `MemoryService` | One facade over the four layers. |
| `ExperienceStore` | Per-(agent, model) tool patterns and outcomes; feeds calibration in `@reactive-agents/llm-provider`. |
| `MemoryConsolidatorService` | Background decay and summarization of older episodic turns. |
| `ZettelkastenService` | Bidirectional links between memory entries. |
| `SessionStoreService` | Persistent (platform, sender) chat sessions used by gateway chat mode. |
| `SkillStoreService`, `DebriefStoreService`, `PlanStoreService` | Auxiliary stores for the kernel and skill system. |
| `AgentMemoryFromMemoryService` | Adapter that satisfies the `AgentMemory` tag in `@reactive-agents/core`. |

## Documentation

- [Memory guide](https://docs.reactiveagents.dev/guides/memory/)

## Runtime

Bun >= 1.1.0 (recommended) or Node.js 22.5+. Node's built-in SQLite has no FTS5, so search falls back to `LIKE`. Vector search needs the `sqlite-vec` extension.

## License

MIT. See [LICENSE](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/LICENSE).
