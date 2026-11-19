---
title: "ReactiveAgent: chat, sessions and run control"
description: >-
  Reference for chat, sessions, resume, pause, stop, approvals and the runtime handles for memory, skills, judgment and dynamic tools on a ReactiveAgent.
sidebar:
  order: 10
topic: config-reference
related:
  - reference/builder-api
  - cookbook/chat-and-sessions
  - guides/durable-hitl
  - features/process-model
---

More of the `ReactiveAgent` facade: multi-turn chat and sessions, durable run control (resume, pause, stop, approve, deny) and the runtime handles for dynamic tools, memory, skills and judgment. Part of the [builder reference](/reference/builder-api/).

## `chat(message: string, options?: ChatOptions): Promise<ChatReply>`

Conversational Q&A with the agent. Routes automatically:

-   **Direct LLM path** — for questions, summaries, and status checks (fast, no tools)
-   **ReAct loop path** — for tool-capable requests (search, fetch, write, create, etc.)

Injects context from the last run's debrief so the agent can answer "what did you do last time?" accurately.

```typescript
const reply = await agent.chat('What did you accomplish last run?')
console.log(reply.message)

// Force tool-capable path
const reply2 = await agent.chat('Search for the latest AI news', {
    useTools: true,
})
console.log(reply2.toolsUsed) // ["web-search"]
```

Failures differ by path. On the tool-capable path a failed run resolves with `failed: true` and the cause on `error`. On the direct LLM path a failed model call (for example a model that is not pulled) rejects with the provider's own error: `err.message` is the cause, with no `LLMError: ` prefix, and `err._tag` names the error class. The direct path is not a run, so it has no result to carry a failure in. `runStream()` reports the same model failure as a `StreamCompleted` with `success: false`.

```typescript
interface ChatReply {
    message: string
    toolsUsed?: string[] // Set when tools were invoked
    fromMemory?: boolean // Set when answered from debrief context
    // Tool-capable path, durable runs: set when the run paused
    status?: 'completed' | 'awaiting-approval' | 'awaiting-interaction' | 'failed'
    pendingApproval?: { runId: string; gateId: string; toolName: string; args: unknown }
    pendingInteraction?: { runId: string; interactionId: string; kind: string; prompt: string; schema: unknown }
}

interface ChatOptions {
    useTools?: boolean // Override auto-routing
    maxIterations?: number // Cap for tool-capable path (default: 5) — honored by the engine
    extraContext?: string // Optional context prepended (direct-LLM path only)
}
```

## `session(options?): AgentSession`

Start a multi-turn conversation session with auto-managed history. Conversation history is forwarded to the LLM on every subsequent turn. `session.chat()` and `session.runStream()` take a string or `ContentPart[]` (images, audio), the same as `agent.chat()`.

Pass `{ persist: true, id: "my-session" }` to persist conversation history to SQLite via `SessionStoreService`. Persistent sessions survive process restarts and can be resumed by passing the same `id`. **Persistence requires the memory layer** (`.withMemory()`): the session store is wired only when memory is enabled — without it, `persist: true` silently no-ops and the session stays in-memory only.

```typescript
// In-memory session (default)
const session = agent.session()

const r1 = await session.chat('What are the key findings from your last run?')
const r2 = await session.chat('Tell me more about the first finding')
// r2 has full context of r1

// Persisted session — survives process restarts
const persistedSession = agent.session({
    persist: true,
    id: 'research-session-1',
})
await persistedSession.chat('Start researching quantum computing')
// On next run, restore the session:
const restoredSession = agent.session({
    persist: true,
    id: 'research-session-1',
})
await restoredSession.chat('Continue where we left off')

const history = session.history() // ChatMessage[]
await session.end() // Flushes history to storage (if persisted) and clears the in-memory copy — the DB record is kept

// Stream a conversational turn (engine-backed sessions); the turn is recorded + persisted after the terminal event
for await (const ev of session.runStream('Summarize so far', { density: 'full' })) {
  if (ev._tag === 'TextDelta') process.stdout.write(ev.text)
}
```

<!-- docs-skip-typecheck -->
```typescript
// session() options
{
    persist?: boolean // Persist history to SQLite via SessionStoreService (requires .withMemory())
    id?: string // Session ID for persistence (auto-generated if omitted)
    maxAgeDays?: number // Retention window in days for persisted sessions (host-defined)
    onOverflow?: (dropped: ChatMessage[]) => Promise<string> // Summarize dropped turns on window overflow
}

interface AgentSession {
    chat(message: string, options?: ChatOptions): Promise<ChatReply>
    runStream(message: string, options?: { density?: "tokens" | "full"; signal?: AbortSignal }): RunHandle
    history(): ChatMessage[]
    end(): Promise<void>
}
```

## `resumeRun(runId: string, opts?: { note?, extraIterations?, newRun? }): Promise<AgentResult>`

Resume any durable run that did not complete from its last checkpoint: stopped or paused by the user, ended by an error, a spent budget or a timeout, a loop stop, or a crash (`result.resumable`, or a `listRuns()` row with `resumable: true` and a typed `stop` record). Requires `.withDurableRuns()`. Completed tool calls are served from the effect journal, never run again. A loop stop continues with corrective guidance and a fresh iteration budget (default 10); `note` is passed to the run as guidance, `extraIterations` bounds the continued run. Passing `opts` for a run that already completed fails `RunNotResumableError`. `newRun: true` continues as a NEW run: a fresh run id (`<runId>-cont-<8 hex>`, in `result.runId`) with `result.continuedFrom` naming the parent; the parent's record is unchanged. See [Durable Execution](/guides/durable-execution/).

## `pauseRun(runId: string): Promise<boolean>` / `stopRun(runId: string): Promise<boolean>`

Ask a live durable run of this agent to stop at its next iteration boundary. A tool already running finishes first. The final checkpoint and a typed stop record are written and the row becomes `paused` (`pauseRun`) or `stopped` (`stopRun`); continue it with `resumeRun(runId)` from the kernel's own checkpoint of the stopped state. A stopped run's result is an honest partial: `success: false`, `outcome: "partial"`, `metadata.outstandingCriteria` containing `stopped_by_request`, and the answer so far in `output`. Resolves `true` once persisted, `false` when this agent has no live run with that id. `activeRunIds(): readonly string[]` lists the live ones (tells a crashed `running` row from a live one).

## `listRuns(filter?: { status? }): Promise<readonly RunRecord[]>`

List persisted durable runs, optionally filtered by lifecycle status (e.g. `{ status: "running" }`). Requires `.withDurableRuns()`.

## `listPendingApprovals(): Promise<readonly PendingApproval[]>`

List runs waiting for a human decision, each with the pending action (`runId`, `gateId`, `toolName`, `args`, `task`, `updatedAt`, and `subAgent` when a sub-agent raised the request): first the runs waiting live in this process, then (with `.withDurableRuns()`) the durable pauses in the store. See [Human-in-the-loop](/guides/durable-hitl/).

## `approveRun(runId, opts?): Promise<AgentResult>`

`opts`: `{ reason?, gateId? }`. `gateId` (from `listPendingApprovals()` / `ApprovalRequested`) answers exactly one waiting request; parallel sub-agents share the root run id, and without it the oldest wait takes the decision. Approve the run's gated call — the agent executes it and continues. A run waiting live in this process takes the decision first, and the promise resolves with that run's final result (the same one its `run()` / `runStream()` caller gets). Otherwise, with `.withDurableRuns()`, the paused run resumes from its checkpoint (callable from any process). Throws `ApprovalStateError` if no run is waiting for a decision.

## `denyRun(runId, reason, opts?): Promise<AgentResult>`

`opts`: `{ gateId? }`, same targeting as `approveRun`. Deny the run's gated call — the agent observes the denial and continues without running it. Same live-then-durable order as `approveRun`.

## Dynamic tools & RAG (runtime)

| Method                                      | Description                                               |
| ------------------------------------------- | --------------------------------------------------------- |
| `registerTool(definition, handler)`         | Register a tool after build; `handler` returns `Effect`   |
| `unregisterTool(name)`                      | Remove a previously registered custom tool                |
| `ingest(content, { source, format?, ... })` | Ingest text into this agent's document store (shared store if one was passed to `withDocuments`) when tools / `withDocuments` enabled; visible to the agent's next run |

## `memory(): AgentMemoryHandle`

Inspect and edit what the agent has persisted. Needs `.withMemory()`; without it every call rejects with `MemoryNotEnabledError`. Each semantic and procedural entry carries the `taskId` and `runId` of the run that wrote it (absent on rows written before provenance existed or outside a run). See [Memory: inspecting and editing](/guides/memory/#inspecting-and-editing-memory).

| Method                                            | Description                                                              |
| ------------------------------------------------- | ------------------------------------------------------------------------ |
| `search(query, { limit?, taskId?, runId? })`      | Full-text search over semantic memory, optionally only one run's entries |
| `semantic.list({ limit?, taskId?, runId? })` / `semantic.get(id)` | Entries, most important first, optionally only one task's or run's / one entry or `undefined` |
| `semantic.update(id, patch)` / `semantic.delete(id)` | Edit `content`, `summary`, `importance`, `verified`, `tags` / delete  |
| `procedural.list({ limit?, taskId?, runId? })` / `get` / `update` / `delete` | Learned workflows; `update` edits `name`, `description`, `pattern`, `tags` |
| `episodic.list({ limit? })`                       | The event log, newest first (read-only)                                  |

## Skills (runtime)

Stored skills live in the agent's SkillStore (memory on, `skillPersistence` not `false`). See [Agent Skills: Runtime API](/guides/agent-skills/#runtime-api).

| Method | Description |
| ------ | ----------- |
| `skills()` | All stored skills for this agent (`[]` without a SkillStore) |
| `exportSkill(name, outputPath?)` | Write a stored skill to `SKILL.md`; resolves the file path |
| `loadSkill(path, { evolutionMode? }?)` | Store a `SKILL.md` (file or directory). A new skill is `'locked'` unless `evolutionMode` says otherwise. Reloading a skill keeps its version history, stats and mode; changed instructions become a new version |
| `refineSkills()` | One refinement pass; resolves `{ refined, unchanged, skipped, failed }` |
| `rollbackSkill(name)` | Restore the previous version; resolves `{ fromVersion, toVersion }` and publishes `SkillRolledBack` with `reason: "manual"` |
| `setSkillMode(name, mode)` | Set `evolutionMode` to `'auto'`, `'suggest'` or `'locked'` in place; history is kept |

`rollbackSkill` and `setSkillMode` reject with `MemoryNotEnabledError` without a SkillStore and with `MemoryNotFoundError` for an unknown name (or, for `rollbackSkill`, a skill with no previous version).

## Judgment (runtime)

Require `.withJudgment()` on the builder — each method below throws immediately if it wasn't
called (`JudgmentService` genuinely absent from the runtime's Layer graph, not silently stubbed).
See [Judgment Layer](/features/judgment-layer/) and the [judgment cookbook](/cookbook/judgment-recipes/).

| Method                                       | Description                                                                                                                                 |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `judge(input: JudgeInput<Q>)`                 | Ask one or more typed Choice/Score/Noul questions over `state` (or `includeContext: true \| JudgeContextConfig` to fold in recent messages / tool results / reasoning steps)        |
| `listJudgmentModels()`                        | List the configured judgment backend's available models (`jev`: live TypeSafe catalog; `llm`: rejects, message names the missing catalog — the rejection is a `FiberFailure` wrapper, not a bare `JudgmentUnsupported` you can `instanceof`-check) — scoped to the judgment backend, not the LLM provider models `.withModel()` selects from |
| `judgeRank(candidates, question, opts?)`      | Batch-Score-rank candidates against one shared question; returns best-first results, **may be shorter than `candidates`** on backend-answer drops |
