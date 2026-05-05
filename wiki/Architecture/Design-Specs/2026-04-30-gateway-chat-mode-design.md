# Gateway Chat Mode + Memory Distillery Audit

**Date:** 2026-04-30
**Branch:** refactor/overhaul
**Status:** Approved for implementation planning

---

## Overview

Two related problems addressed in this spec:

1. **Memory bugs** — episodic memory assembled by `ExecutionEngine` was never reaching the LLM due to two independent bugs in the context rendering pipeline. These are partially fixed in the working tree and need to ship.

2. **Gateway chat mode** — channel messages (e.g., incoming Signal texts) are currently routed through `agent.run()` (full ReAct loop, no conversation history). The gateway needs a dedicated chat mode that maintains per-sender `AgentSession` instances with memory-enriched context, cross-restart persistence, and a system prompt nudge for long-running tool tasks to keep users informed mid-execution.

---

## Part 1: Memory Bug Audit

### Bug 1 — `priorContext` silently dropped (`context-manager.ts`)

`ExecutionEngine` assembles episodic + semantic memory into a `memCtx` string and passes it to the reasoning layer as `input.priorContext`. `buildIterationSystemPrompt()` received the field but never rendered it — it was silently ignored.

**Fix (in working tree):** Insert `priorContext` as section 2 of the system prompt in both `minimal` and `full` rendering modes, immediately before the task description. This positions cross-run memory where the LLM processes it before the current task, which is the correct ordering.

**Status:** Correct, ships as-is.

### Bug 2 — Episodic injection gated behind `enableSelfImprovement` (`execution-engine.ts`)

Episodic memory injection was conditional on `config.enableSelfImprovement` and only processed `strategy-outcome` / `reflexion-critique` event types. Standard `task-completed` episodes from gateway heartbeats and crons were invisible to the LLM even when memory was configured.

**Fix (in working tree):** Remove the `enableSelfImprovement` gate. Inject all episodic event types (cap: 15 rows, 600 chars/row) under a `--- Recent episodic memory ---` header. `strategy-outcome` / `reflexion-critique` rows retain their `[✓/✗ strategy]` prefix; all other rows use `[eventType] body`.

**Status:** Correct, ships as-is.

### Gap — Direct-LLM chat path is blind to episodic memory

The two fixes above apply only to ReAct loop runs via `ExecutionEngine`. When `agent.chat()` routes to `directChat()` (the fast, no-tools path), it builds context from `_lastDebrief` / `_lastRunObservations` — not from episodic memory. Gateway chat sessions will frequently use this path for conversational turns. Without a separate episodic injection mechanism, chat context is limited to the last `agent.run()` debrief.

**Fix:** `GatewayChatManager` (see Part 2) queries episodic memory directly and injects it via a new `ChatOptions.extraContext?: string` field. This is a two-line change to `chat.ts` — `directChat()` merges `extraContext` into the system context summary when present.

### Gap — `ChatTurn` events not logged as episodic rows

`publishChatTurnEvents()` fires `ChatTurn` events onto the EventBus. Unless a subscriber calls `logEpisode()`, these events never land in the episodic store — meaning chat conversations don't enrich the memory that future ReAct runs (crons, heartbeats) can see. This breaks the cross-mode memory continuity that makes a gateway agent feel coherent across conversation and task modes.

**Fix:** `GatewayChatManager` subscribes to `ChatTurn` events (or logs episodes directly after each `session.chat()` call) with `eventType: 'chat-turn'` and a condensed content string (`${sender}: ${userMsg} → ${assistantReply.slice(0, 300)}`).

---

## Part 2: Gateway Chat Mode

### Goals

- Channel messages routed to `AgentSession.chat()` by default (configurable)
- Per-sender sessions: each allowed sender gets an independent conversation thread
- Sessions persist across gateway restarts via `SessionStoreService`
- Session TTL: configurable, default 30 days inactivity
- Episodic context (recent gateway run outcomes) injected into chat context
- Full agent run capability for tool-requiring messages (no iteration cap)
- System prompt nudge for long-running tool tasks to proactively inform users mid-run
- Chat history windowed before LLM calls to prevent context overflow

### Config API

Two new fields added to `GatewayOptions.channels`:

```typescript
channels?: {
  // ... existing fields ...

  /**
   * How incoming channel messages are handled.
   * - 'chat' (default): route to AgentSession.chat() with conversation history and memory
   * - 'task': original behavior — each message triggers a standalone agent.run()
   */
  mode?: 'chat' | 'task'

  /**
   * Days of inactivity before a persisted chat session expires and is pruned.
   * Default: 30. Requires withMemory() to be configured for persistence.
   */
  sessionTtlDays?: number
}
```

Usage in `main.ts`:

```typescript
.withGateway({
  channels: {
    accessPolicy: 'allowlist',
    allowedSenders: [RECIPIENT || ''],
    unknownSenderAction: 'skip',
    mode: 'chat',          // default — explicit here for clarity
    sessionTtlDays: 30,    // default
  },
})
```

### Architecture: `GatewayChatManager`

New file: `packages/runtime/src/gateway-chat.ts`

This class owns the per-sender conversation lifecycle. It is not exported from the package — it is internal to `builder.ts`. `start()` creates an instance and delegates channel message handling to it.

**Why not `AgentSession`:** Gateway channel agents must use MCP tools (e.g., `signal/send_message_to_user`) to send replies. `AgentSession.chat()` auto-routes to `directChat()` (no tools) for conversational messages, which produces a text reply that is never sent to the user. Gateway chat always needs the full ReAct loop. `GatewayChatManager` therefore maintains its own per-sender `ChatMessage[]` history and calls `executeEvent()` directly — identical to task mode, but with history context and memory enrichment injected into the instruction.

```
GatewayChatManager
  ├── histories: Map<senderId, ChatMessage[]>
  ├── getOrLoadHistory(senderId) → ChatMessage[]
  │     └── load from SessionStoreService on first access
  │         (session key: `gateway-chat-${agentId}-${senderId}`)
  ├── handleMessage(sender, message, platform, mcpServer) → void
  │     ├── load/get conversation history for sender
  │     ├── query episodic memory → episodic context block
  │     ├── apply window to history (last 40 turns or 8k chars)
  │     ├── build enriched instruction:
  │     │     [episodic context block]
  │     │     [windowed conversation history]
  │     │     [long-run nudge + Signal send directive]
  │     │     User: ${message}
  │     ├── call executeEvent(gwEvent, 'channel', enrichedInstruction)
  │     ├── store {user: message, assistant: runOutput.slice(0,500)} in history
  │     ├── persist updated history to SessionStoreService
  │     └── log chat turn as episodic row
  ├── pruneStaleSessions(ttlDays) → void   [called by gateway tick, daily gate]
  └── dispose() → persist all in-memory histories
```

### Session Persistence

Session key convention: `gateway-chat-${agentId}-${senderId}`

On first message from a sender:
1. Query `SessionStoreService.load(sessionKey)` → `ChatMessage[]` or `[]`
2. Cache loaded history in `histories` map

On each chat turn:
- After storing the new `{user, assistant}` pair, call `SessionStoreService.save()` with the updated full history. Per-turn saves ensure no conversation is lost if the process is killed mid-session.

On gateway stop:
- `chatManager.dispose()` flushes any histories that haven't been saved since the last turn, then resolves. Called from `start()`'s cleanup path before `resolveStop()`.

Session TTL pruning:
- `GatewayChatManager.pruneStaleSessions(ttlDays)` is called from the gateway tick with a daily gate (check `lastPruneAt`, skip if < 24h ago)
- Prune logic: query `SessionStoreService` for sessions with key prefix `gateway-chat-${agentId}-` where `updatedAt < now - ttlDays * 86400000`
- Delete pruned sessions from the store; evict from in-memory `histories` map if present

### Chat History Windowing

Conversation history injected into the instruction must be bounded to avoid context overflow. `GatewayChatManager` applies a window before building the enriched instruction:

- **Turn limit:** last 40 turns (20 user + 20 assistant exchanges)
- **Char limit:** if total history chars exceed 8,000, drop oldest turns until within budget
- The in-memory `histories` map holds **full** untruncated history — windowing only applies to the slice formatted into the instruction. Full history is what gets persisted to `SessionStoreService`.

Format of the injected history block:
```
--- Conversation history ---
User: <message>
Assistant: <reply>
User: <message>
Assistant: <reply>
```

### Episodic Context Injection

Before building the enriched instruction, `GatewayChatManager` queries episodic memory for recent gateway run outcomes:

```typescript
const episodes = await queryRecentEpisodes(agentId, { limit: 8, excludeEventTypes: ['chat-turn'] })
// returns DailyLogEntry[] from MemoryService
const episodicBlock = formatEpisodicContext(episodes)
// → "--- Recent gateway activity ---\n[task-completed] Morning brief sent...\n..."
```

This block is prepended to the enriched instruction. `excludeEventTypes: ['chat-turn']` prevents the block from being dominated by chat history (already present in the conversation history block).

### Enriched Instruction Structure

`GatewayChatManager.handleMessage()` builds a single instruction string passed to `executeEvent()`. All context layers are stacked in this order:

```
[episodic context block — omitted if empty]
--- Recent gateway activity ---
[task-completed] Morning brief sent at 09:00...
...

[conversation history block — omitted if no prior turns]
--- Conversation history ---
User: what are my open PRs?
Assistant: I found 3 open PRs...
...

[behavioral nudge + send directive — always present]
You are in a live conversation with ${sender} on ${platform}.
If this task will take multiple steps or more than a few seconds,
send them a brief acknowledgement first using ${mcpServer}/send_message_to_user
so they aren't left waiting. Keep them informed at meaningful milestones.
Always send your final response via ${mcpServer}/send_message_to_user.

User: ${message}
```

This is instruction-level composition — no system prompt overrides, no new execution paths. Works with any model including local (cogito:14b).

### ChatTurn Episodic Logging

After each `executeEvent()` call completes, `GatewayChatManager` logs a single episodic row:

```typescript
await logEpisode(agentId, {
  eventType: 'chat-turn',
  content: `${sender} (${platform}): ${message.slice(0, 200)} → ${runOutput.slice(0, 300)}`,
  metadata: { sender, platform, tokensUsed }
})
```

This ensures gateway chat turns are visible in the episodic memory that future ReAct runs (crons, heartbeats) read — giving the agent a coherent picture of what was discussed, not just what was sent proactively.

### `ChatOptions` Extension (general-purpose, not gateway-specific)

This is a small standalone improvement: `agent.chat()` via `directChat()` currently has no way to inject arbitrary extra context (e.g., episodic memory from an external source). Add `extraContext` so non-gateway callers of `agent.chat()` can also benefit:

```typescript
export interface ChatOptions {
  useTools?: boolean
  maxIterations?: number
  /** Optional context prepended to the system context summary (direct-LLM path only). */
  extraContext?: string
}
```

In `directChat()`:

```typescript
const systemContext = [options?.extraContext, contextSummary].filter(Boolean).join('\n\n---\n\n')
```

Gateway chat mode does not use this path (always full ReAct loop), but it closes the episodic-memory gap for users of `agent.chat()` outside the gateway.

### Changes to `start()` in `builder.ts`

The channel message handler in the existing `ChannelMessageReceived` subscriber is replaced:

```typescript
// Before (task mode always):
const instruction = `Respond to this ${platform} message from ${sender}: "${message}". Use ...`
yield* Effect.promise(() => executeEvent(gwEvent, 'channel', instruction))

// After (mode-aware):
if (channelMode === 'task') {
  const instruction = `Respond to this ${platform} message from ${sender}: "${message}". Use ...`
  yield* Effect.promise(() => executeEvent(gwEvent, 'channel', instruction))
} else {
  yield* Effect.promise(() => chatManager.handleMessage(sender, message, platform, mcpServer))
}
```

`chatManager` is created once at the start of the `loopPromise` async block and disposed in the stop path.

---

## Part 3: Memory Health for Always-On Agents

### Gap 1 — No auto-compaction schedule

`CompactionService` is wired in the runtime layer but has no periodic trigger. Semantic memory grows unbounded for a long-running gateway.

**Fix:** `GatewayChatManager` (or the gateway tick itself) runs `compactProgressive` on a daily gate. Implementation: track `lastCompactionAt` in a local variable; on each tick, if `Date.now() - lastCompactionAt > 86_400_000`, run `compactProgressive(agentId, config.compaction)`.

This belongs in the gateway tick (in `start()`) rather than `GatewayChatManager` since it applies to the full agent, not just chat sessions.

### Gap 2 — Episodic log grows forever

`compactByTime` only prunes `semantic_memory`. The `episodic_log` table has no eviction path.

**Fix:** Add `pruneEpisodicLog(agentId, ttlDays)` to `CompactionService`:

```sql
DELETE FROM episodic_log
WHERE agent_id = ?
  AND created_at < ?        -- older than ttl
  AND event_type NOT IN ('strategy-outcome', 'reflexion-critique')
```

Strategy-outcome and reflexion rows are retained regardless of age (they inform skill evolution). All others are pruned after `ttlDays` (default: same as `sessionTtlDays`, 30 days). This runs on the same daily gate as `compactProgressive`.

### Gap 3 — Semantic similarity compaction is exact-match only (known limitation)

`compactBySimilarity` uses `WHERE content = ?` — literal string equality. It cannot detect semantically equivalent entries that differ in wording. The 40-char prefix matching in `MemoryConsolidatorLive` is a partial improvement but still misses paraphrase duplicates.

**Deferred:** Real semantic deduplication requires embeddings. This is a Tier 2 / v1.1 concern and out of scope here. Document as a known limitation.

### Gap 4 — No episode summarization before storage (known limitation)

Raw gateway cron outputs are stored as episodic rows without compression. "Sent Signal message with 23 commits summary to +1..." is stored verbatim. The `MemoryConsolidatorService.connect` phase (where summarization should happen) defaults to a no-op unless `SkillDistillerService` is explicitly wired.

**Deferred:** LLM-driven episode summarization into durable semantic insights is a meaningful improvement but requires self-improvement to be enabled and is not guaranteed for local-model deployments. Document as a known limitation for Tier 1 (local model) agents.

### Gap 5 — No per-event-type retention policy

All episodic rows share the same TTL. A morning brief summary should persist longer than a debug tool trace.

**Partial fix:** The `pruneEpisodicLog` query above exempts `strategy-outcome` and `reflexion-critique` from TTL pruning. Other retention tiers (e.g., `task-completed` survives 60 days, `tool-call-trace` survives 7 days) are deferred to v1.1.

---

## File Changeset Summary

| File | Change |
|------|--------|
| `packages/runtime/src/gateway-chat.ts` | **New** — `GatewayChatManager` class (history map, session persistence, episodic injection, instruction building, TTL pruning) |
| `packages/runtime/src/builder.ts` | Add `channels.mode` + `sessionTtlDays` to `GatewayOptions`; swap channel handler for mode-aware dispatch; add daily compaction gate in gateway tick |
| `packages/runtime/src/chat.ts` | Add `extraContext?: string` to `ChatOptions`; merge into `directChat()` system context |
| `packages/reasoning/src/context/context-manager.ts` | Ship working-tree fix (render `priorContext` in system prompt) |
| `packages/runtime/src/execution-engine.ts` | Ship working-tree fix (remove `enableSelfImprovement` gate on episodic injection) |
| `packages/memory/src/compaction/compaction-service.ts` | Add `pruneEpisodicLog(agentId, ttlDays)` method |
| `packages/memory/src/index.ts` | Export `pruneEpisodicLog` |
| `packages/gateway/src/types.ts` | Add `mode` and `sessionTtlDays` to `GatewayConfigSchema` |

---

## Out of Scope (Follow-up Spec)

- Semantic deduplication via embeddings (requires Tier 2 memory)
- LLM-driven episode summarization into semantic memory (requires self-improvement)
- Per-event-type retention tiers (v1.1)
- Multi-sender group chat sessions
- Chat session inspection / export API
- Gateway chat metrics in `GatewayStats` (`chatTurns`, `chatSessions` counters) — easy add, kept out to keep this PR focused
