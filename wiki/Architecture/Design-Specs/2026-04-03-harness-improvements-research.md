# Harness Improvements Research — Claude Code Deep Analysis

**Date:** 2026-04-03  
**Sources:** Claurst reverse-engineering spec (14 files), Anthropic Agent SDK docs, DeepWiki source-level analysis (Sections 1–4), ccunpacked.dev  
**Purpose:** Document findings from deep analysis of the Claude Code agentic harness to inform improvements to reactive-agents architecture.

---

## Research Overview

Three independent research passes were conducted against the Claude Code codebase:

1. **Claurst spec** (`github.com/Kuberwastaken/claurst`) — 14 reverse-engineered spec files covering ~990KB of documentation across ~800K LOC TypeScript codebase
2. **Anthropic Agent SDK docs** (`platform.claude.com/docs/en/agent-sdk/agent-loop`) — official documentation for the SDK that wraps the same execution loop
3. **DeepWiki source analysis** — direct source-level Q&A against the `zackautocracy/claude-code` repo, returning exact file paths, line numbers, and code snippets (Sections 1–4 completed; Sections 5–7 pending follow-up)

---

## Section 1 — Query Loop Internals

### 1.1 State Machine Design

The core loop in `src/query.ts` carries all mutable state in a single immutable `State` object that is fully replaced on each iteration:

```typescript
type State = {
    messages: Message[]
    toolUseContext: ToolUseContext
    autoCompactTracking: AutoCompactTrackingState | undefined
    maxOutputTokensRecoveryCount: number // 0..3, resets on next_turn
    hasAttemptedReactiveCompact: boolean // one-shot guard, preserved across stop_hook_blocking
    maxOutputTokensOverride: number | undefined // 64k escalation before multi-turn recovery
    pendingToolUseSummary: Promise<ToolUseSummaryMessage | null> | undefined
    stopHookActive: boolean | undefined // prevents infinite hook-triggered loops
    turnCount: number
    transition: Continue | undefined // why the previous iteration continued
}
```

**7 named transition reasons:**

| Reason                       | Trigger                                                                  |
| ---------------------------- | ------------------------------------------------------------------------ |
| `collapse_drain_retry`       | 413 prompt-too-long; drained staged context-collapses                    |
| `reactive_compact_retry`     | 413 or media-size error; reactive compact succeeded                      |
| `max_output_tokens_escalate` | Hit 8k default cap; escalates to 64k (single retry, no message injected) |
| `max_output_tokens_recovery` | Hit 64k cap; injects recovery message (up to 3 attempts)                 |
| `stop_hook_blocking`         | Stop hook returned `blockingError`                                       |
| `token_budget_continuation`  | Under 90% token budget, not diminishing                                  |
| `next_turn`                  | Normal tool-use follow-up                                                |

**The full decision tree for "should this loop continue?":**

```
if aborted → return 'aborted_streaming'

if !needsFollowUp (no tool calls):
  if isWithheld413:
    → try collapse drain (if not already tried)
    → try reactive compact (one-shot via hasAttemptedReactiveCompact)
    → surface error, return (do NOT run stop hooks)
  if isWithheldMedia:
    → try reactive compact
    → surface error, return (do NOT run stop hooks)
  if isWithheldMaxOutputTokens:
    → if override not set: escalate to 64k (max_output_tokens_escalate)
    → if recoveryCount < 3: inject recovery message (max_output_tokens_recovery)
    → else: surface error
  if lastMessage.isApiErrorMessage:
    → run StopFailure hooks, return 'completed' (do NOT run stop hooks)
  → run stop hooks
    → if blockingErrors: continue with stop_hook_blocking
    → if preventContinuation: return 'stop_hook_prevented'
  → check token budget
    → if action === 'continue': inject nudge, continue with token_budget_continuation
  → return 'completed'

if needsFollowUp (has tool calls):
  → execute tools
  → if shouldPreventContinuation: return 'completed'
  → check maxTurns → return 'max_turns'
  → autocompact if needed
  → continue with next_turn
```

### 1.2 The "Withheld Error" Pattern — P0 Gap

**This is the most important design pattern reactive-agents is missing.**

Recoverable errors are never surfaced to SDK consumers during recovery. When `max_output_tokens` is hit, the error message is withheld from the yield stream. The loop retries internally. Only after all recovery paths are exhausted does the error get yielded.

```typescript
// query.ts — error is withheld, loop retries
if (isWithheldMaxOutputTokens(lastMessage)) {
    // Try 64k escalation first...
    // Then multi-turn recovery...
    // Only after exhausting both: yield lastMessage
}
```

**Gap:** Our `ExecutionEngine` surfaces transient errors immediately to EventBus consumers and callers. This creates noise and premature termination on states that should be self-healing.

**Exact recovery message injected on max_output_tokens:**

> "Output token limit hit. Resume directly — no apology, no recap of what you were doing. Pick up mid-thought if that is where the cut happened. Break remaining work into smaller pieces."

### 1.3 Two-Stage `max_output_tokens` Recovery

The recovery sequence has a stage we didn't know about:

1. **Stage 1 — Escalate** (zero messages, same request): If the model hit the default 8k output cap, retry the identical request with `maxOutputTokens = 64k`. Guarded: fires once per turn via `maxOutputTokensOverride`.
2. **Stage 2 — Multi-turn recovery** (up to 3 attempts): If 64k also hits the cap, inject the recovery message and continue the conversation thread. `maxOutputTokensRecoveryCount` increments; resets to 0 on `next_turn`.

**Gap:** We have a retry mechanism but no Stage 1 escalation. We retry the same request with the same token limit, which will fail identically.

### 1.4 Stop Hook Infinite Loop Prevention

Two guards working together:

```typescript
// Guard 1: stopHookActive flag
state = {
    ...next,
    stopHookActive: true, // hooks can gate on this
    hasAttemptedReactiveCompact, // PRESERVED — not reset to false
}
```

The `hasAttemptedReactiveCompact` flag is deliberately preserved (not reset) across `stop_hook_blocking` transitions. Without this, the sequence `compact → still-413 → stop hook fires → compact → ...` burned ~250K API calls/day before the fix.

**Guard 2: Never run stop hooks on API errors.** The comment: _"The model never produced a real response — hooks evaluating it create a death spiral."_

**Gap:** Our `KernelHooks` runs post-kernel processing unconditionally. We need:

1. A `hookActive` flag equivalent to prevent re-entrant hook triggering
2. An `apiError` guard that skips hooks when the last message was an API error, not a model response

### 1.5 Token Budget — Diminishing Returns Detection

Exact implementation:

```typescript
const COMPLETION_THRESHOLD = 0.9 // 90% of budget
const DIMINISHING_THRESHOLD = 500 // tokens

const isDiminishing =
    tracker.continuationCount >= 3 && // at least 3 prior continuations
    deltaSinceLastCheck < 500 && // current delta < 500 tokens
    tracker.lastDeltaTokens < 500 // previous delta also < 500 tokens
// Requires 2 consecutive sub-threshold checks, not just 1
```

Nudge message: _"Stopped at X% of token target (Y / Z). Keep working — do not summarize."_

**Gap:** We have entropy sensor trajectory analysis but not this simple token-delta guard. These are complementary — delta-based is cheap and catches spinning; entropy is richer but costlier.

---

## Section 2 — Context Window Management

### 2.1 Autocompact Threshold Formula

```
effectiveContextWindow = contextWindow - min(maxOutputTokens, 20_000)
autocompactThreshold   = effectiveContextWindow - 13_000  (AUTOCOMPACT_BUFFER_TOKENS)
warningThreshold       = effectiveContextWindow - 20_000  (WARNING_THRESHOLD_BUFFER_TOKENS)
```

**Circuit breaker:** `MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3`. After 3 consecutive autocompact failures, stop retrying. Background: 1,279 production sessions had 50+ consecutive failures (up to 3,272 per session), wasting ~250K API calls/day.

**Gap:** Our compaction has no circuit breaker. A context that is irrecoverably over limit will retry indefinitely.

### 2.2 The Microcompact Algorithm (Two Paths)

**Eligible tool set** (hardcoded):

```typescript
const COMPACTABLE_TOOLS = new Set([
    FILE_READ_TOOL_NAME,
    ...SHELL_TOOL_NAMES,
    GREP_TOOL_NAME,
    GLOB_TOOL_NAME,
    WEB_SEARCH_TOOL_NAME,
    WEB_FETCH_TOOL_NAME,
    FILE_EDIT_TOOL_NAME,
    FILE_WRITE_TOOL_NAME,
])
```

**Path 1 — Time-based** (cache is cold):

-   Trigger: gap since last assistant message exceeds configured threshold (GrowthBook)
-   Algorithm: collect all compactable tool IDs, keep last `keepRecent` (floor at 1), replace rest with `'[Old tool result content cleared]'`
-   Direct content mutation on message array; resets cached MC state
-   `floor at 1` is critical: `slice(-0)` returns the full array (keeps everything), which is a bug

**Path 2 — Cached API** (cache is warm):

-   Does NOT mutate local message content
-   Queues `cache_edits` blocks (`clear_tool_uses_20250919`) for the API layer
-   Boundary message is **deferred until after the API response** so it can use actual `cache_deleted_input_tokens` from the response, not a client-side estimate
-   If API rejects the cache edit, no boundary message is emitted; messages return unchanged (graceful degradation)

**Gap:** We have no microcompact equivalent. Our only compaction is full LLM summarization. This means we spend full token cost on every compaction, even when simple content stripping would suffice.

### 2.3 Tool Result Budget — The "Frozen" Category

`MAX_TOOL_RESULTS_PER_MESSAGE_CHARS = 200_000` per user message (one turn's parallel batch).

The `partitionByPriorDecision` function creates three categories:

```typescript
mustReapply // previously replaced → always re-apply cached replacement (byte-identical, zero I/O)
frozen // seen but not replaced → NEVER replace (would change a prefix already cached server-side)
fresh // never seen → eligible; replace LARGEST first (greedy until under budget)
```

The `frozen` category is the non-obvious insight: **once you decide NOT to replace a result, you can never change that decision**. The server has already cached the prefix containing the full result. Replacing it on a subsequent turn would bust the cache and defeat the point.

**Gap:** Our tool result compression re-evaluates every turn. We have no immutability model for "seen but not replaced" results, which means we're potentially busting our own prompt cache on every turn.

### 2.4 Compact Summarization Prompt Structure

The 9-section template (from `src/services/compact/prompt.ts`):

1. **Primary Request and Intent** — all explicit user requests in detail
2. **Key Technical Concepts** — technologies, frameworks discussed
3. **Files and Code Sections** — specific files examined/modified/created, with full code snippets; _"Pay special attention to the most recent messages"_
4. **Errors and Fixes** — all errors encountered and how fixed; _"Pay special attention to specific user feedback"_
5. **Problem Solving** — problems solved and ongoing troubleshooting
6. **All User Messages** — LIST ALL non-tool-result user messages (critical for understanding changing intent)
7. **Pending Tasks** — explicitly asked-for tasks not yet done
8. **Current Work** — _"Describe in detail precisely what was being worked on immediately before this summary request"_
9. **Optional Next Step** — _"IMPORTANT: ensure this step is DIRECTLY in line with the user's most recent explicit requests... If your last task was concluded, only list next steps if explicitly in line with the user's request. Do not start on tangential requests or really old requests that were already completed without confirming with the user first."_

The model first writes an `<analysis>` scratchpad, which is stripped before injection. CLAUDE.md is not directly referenced in the summarization — the prompt says "There may be additional summarization instructions provided in the included context" and matches on intent from a `## Compact Instructions` section.

The compact call uses a simple system prompt: _"You are a helpful AI assistant tasked with summarizing conversations."_ with `thinkingConfig: { type: 'disabled' }`.

**Gap:** Our `DebriefSynthesizer` has a different structure. We don't have a compact summarization prompt tuned specifically for continuation context.

### 2.5 System Prompt Section Cache Discipline

Two tiers, explicitly typed:

```typescript
// Memoized until /clear or /compact — cache-stable
systemPromptSection('session_guidance', () => ...)
systemPromptSection('memory', () => ...)

// Recomputes every turn — REQUIRES a reason string justifying cache-breaking
DANGEROUS_uncachedSystemPromptSection(
  'mcp_instructions',
  () => getMcpInstructionsSection(mcpClients),
  'MCP servers connect/disconnect between turns'
)
```

The naming convention `DANGEROUS_uncached` is intentional — it forces developers to explicitly justify why a section needs to break the cache every turn. Everything else is memoized.

**Gap:** Our system prompt assembly in `buildStaticContext`/`buildDynamicContext` doesn't model cache stability explicitly. MCP tools recomputed every turn without acknowledgment that this breaks cache.

Notable section (ant-only internal experiment):

> _"Length limits: keep text between tool calls to ≤25 words. Keep final responses to ≤100 words unless the task requires more detail."_
> — ~1.2% output token reduction vs qualitative "be concise"

### 2.6 CompactBoundaryMessage Fields

```typescript
{
  type: 'system',
  subtype: 'compact_boundary',
  content: 'Conversation compacted',
  isMeta: false,
  compactMetadata: {
    trigger: 'manual' | 'auto',
    preTokens: number,
    userContext?: string,
    messagesSummarized?: number,
    preservedSegment?: { headUuid, tailUuid, anchorUuid },
    preCompactDiscoveredTools?: string[],
  }
}
```

`getMessagesAfterCompactBoundary` is called at the **top of every loop iteration** — it scans backward for the last boundary and slices from there, ensuring the loop never re-processes already-summarized history.

---

## Section 3 — Tool System Internals

### 3.1 Permission Validation — 7 Steps (Not 5)

The full pipeline in `src/utils/permissions/permissions.ts`:

1. **Blanket deny rule** — entire tool denied → `behavior: 'deny'`
2. **Blanket ask rule** — entire tool requires ask (with sandbox bypass: if Bash is sandboxed, skip this step and let Bash's own `checkPermissions` handle it)
3. **Tool-specific `checkPermissions`** — tool validates its own input
4. **Tool implementation denied** — if `checkPermissions` returned `deny`
5. **`requiresUserInteraction`** — tools that always require user interaction even in `bypassPermissions` mode
6. **Content-specific ask rules** — from `checkPermissions` with `ruleBehavior: 'ask'`
7. **Safety checks** — `.git/`, `.claude/`, shell configs (bypass-immune, cannot be overridden)

When denied, the model receives `tool_result` with `is_error: true` and content like:

> _"Permission to use Bash with command X has been denied."_

### 3.2 Parallel Tool Execution — Two Mechanisms

**`runTools` (legacy, non-streaming):**

-   Partitions all tool_use blocks into `isConcurrencySafe` and non-safe batches
-   Concurrent batch runs via `all()` generator utility with cap: `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY` (default 10)
-   `all()` uses `Promise.race` on a bounded set of running generators

**`StreamingToolExecutor` (streaming path):**

-   Adds tools AS THEY STREAM IN before the full response completes
-   `canExecuteTool` rule:
    ```typescript
    executingTools.length === 0 ||
        (isConcurrencySafe && executingTools.every((t) => t.isConcurrencySafe))
    ```
-   Non-concurrent tool hits → blocks queue (maintains order)
-   On sibling error: `siblingAbortController.abort()` kills siblings; **does NOT abort the parent** (turn continues with synthetic errors)
-   Synthetic error message: `"Cancelled: parallel tool call {desc} errored"`

### 3.3 Tool Pool Stability — Two-Partition Sort

```typescript
// Built-ins sorted as contiguous prefix, MCP tools sorted separately as suffix
const byName = (a, b) => a.name.localeCompare(b.name)
return uniqBy(
    [...builtInTools].sort(byName).concat(allowedMcpTools.sort(byName)),
    'name' // built-in wins on name conflict
)
```

Why two-partition: the server places a global cache breakpoint after the last built-in tool. A flat sort would interleave MCP tools into built-ins, invalidating all downstream cache keys whenever an MCP tool sorts alphabetically between existing built-ins. Keeping built-ins as a contiguous prefix preserves the server-side cache structure.

**Gap:** We sort by name but as a flat list. If we add MCP tools mid-session, we may be busting the tool-list prefix cache unnecessarily.

### 3.4 `readFileState` — Windows mtime Special Case

Standard path: if `mtime > readTimestamp` → reject write with:

> _"File has been modified since read, either by the user or by a linter. Read it again before attempting to write it."_

Windows special case: cloud sync / antivirus can change mtimes without changing content. If the file was fully read (`offset: undefined, limit: undefined`), and the stored content exactly matches current content → allow the write despite mtime mismatch.

### 3.5 `ToolSearch` — Deferred Loading Mechanism

When `ToolSearch` is enabled:

-   Deferred tools sent with `defer_loading: true` in schema
-   `ToolSearch` returns `tool_reference` blocks in its `tool_result`
-   On next API request, `extractDiscoveredToolNames` scans message history for `tool_reference` blocks
-   Only discovered tools are added to the filtered tool list
-   **No request restart** — new tool schemas appear naturally in the next turn's request

---

## Section 4 — Multi-Agent Architecture

### 4.1 Background Agent Lifecycle

Key design choices:

-   Background agents use a **separate `AbortController`** not linked to parent's — they survive ESC
-   Run on the **same Node.js process** in a detached `void` async closure (no worker threads)
-   `AsyncLocalStorage` propagates workload context into the detached closure automatically
-   Return channel: `outputFile: getTaskOutputPath(agentId)` — agents write final results to a well-known file path the parent can read
-   Progress tracked via `updateAsyncAgentProgress` → AppState
-   Completion: `enqueueAgentNotification` sends `<task-notification>` XML message

### 4.2 Communication Channels — Three Tiers

| Channel    | Mechanism                                            | Ordering                   | Concurrency Safety                                  |
| ---------- | ---------------------------------------------------- | -------------------------- | --------------------------------------------------- |
| In-process | `Mailbox` class (queue + waiters + `createSignal()`) | FIFO queue                 | N/A (single process)                                |
| Filesystem | `.claude/teams/{team}/inboxes/{agent}.json`          | Append-order in JSON array | `proper-lockfile` retries: 10, min: 5ms, max: 100ms |
| Bridge     | Remote Control API via WebSocket                     | N/A                        | User consent required                               |

**Critical pattern — callback-before-request:** In swarm permission, `registerPermissionCallback` is called **before** `sendPermissionRequestViaMailbox` to prevent the race where the leader responds before the callback is registered. This is a general pattern: register receipt handler before sending the request.

### 4.3 Plan Approval Protocol

The `ExitPlanModeV2Tool` approval flow:

1. Worker writes `plan_approval_request` to team-lead's mailbox
2. Worker returns `{ awaitingLeaderApproval: true, requestId }` via tool result
3. The tool result text instructs the model to wait — **no programmatic suspension**, just instruction
4. Team leader's `useInboxPoller` detects request → auto-approves → writes `plan_approval_response` back to worker's mailbox
5. Worker's `useInboxPoller` transitions out of plan mode

No explicit timeout. The model follows the instruction text. This means the guard is behavioral (LLM obedience), not mechanical.

---

## Section 5 — Memory & Skills

### 5.1 Two-Pass Memory Relevance — Exact Implementation

**Pass 1 (scan):** `scanMemoryFiles()` reads the **first 30 lines** of each `.md` file in the memory directory (excluding `MEMORY.md`), parses frontmatter, extracts **two fields only: `description` and `type`**. Returns `MemoryHeader[]` sorted newest-first, capped at 200 files.

**Pass 2 (selection) — exact system prompt:**

```
You are selecting memories that will be useful to Claude Code as it processes
a user's query. You will be given the user's query and a list of available
memory files with their filenames and descriptions.

Return a list of filenames for the memories that will clearly be useful to
Claude Code as it processes the user's query (up to 5). Only include memories
that you are certain will be helpful based on their name and description.
- If you are unsure if a memory will be useful in processing the user's query,
  then do not include it in your list. Be selective and discerning.
- If there are no memories in the list that would clearly be useful, feel free
  to return an empty list.
- If a list of recently-used tools is provided, do not select memories that are
  usage reference or API documentation for those tools (Claude Code is already
  exercising them). DO still select memories containing warnings, gotchas, or
  known issues about those tools — active use is exactly when those matter.
```

**JSON schema:** `{ type: 'object', properties: { selected_memories: { type: 'array', items: { type: 'string' } } }, required: ['selected_memories'], additionalProperties: false }`

**`alreadySurfaced`:** Typed as `ReadonlySet<string>` of **absolute file paths**. Populated by `collectSurfacedMemories()`, which scans all messages for `relevant_memories` attachment objects and collects their `.path` fields. Threaded naturally — since messages accumulate across turns, previously surfaced paths are always included. Filter happens before the Sonnet call, so the 5-file slot budget spends on fresh candidates only.

**Freshness warning — exact text:**

```
This memory is ${d} days old. Memories are point-in-time observations, not
live state — claims about code behavior or file:line citations may be outdated.
Verify against current code before asserting as fact.
```

Triggers when `memoryAgeDays(mtimeMs) > 1`. Prepended to the memory header. Fresh memories (≤1 day) get: `Memory (saved ${age}): ${path}:`.

**Gap:** We have FTS5 + sqlite-vec KNN but lack the `alreadySurfaced` cross-turn dedup guard. Also missing: the "don't surface API docs for tools currently in use, DO surface warnings/gotchas" logic in our selection prompt.

### 5.2 AutoDream — Exact Implementation

**Gate sequence (cheapest first):**

1. Time gate: `hoursSince < cfg.minHours` (default 24h)
2. Scan throttle: `sinceScanMs < SESSION_SCAN_INTERVAL_MS`
3. Session gate: count sessions touched since last consolidation (excluding current) — requires `cfg.minSessions` (default 5)
4. Lock acquisition

**Mutex implementation:** Lock file is `.consolidate-lock` inside `getAutoMemPath()`. The **mtime IS `lastConsolidatedAt`** — no separate timestamp file. Body = holder's PID. Stale threshold: `HOLDER_STALE_MS = 3_600_000` (1 hour). Contention: if lock exists, mtime is within 1h, AND PID is alive → return null (blocked). Dead PID or stale → write own PID, re-read to verify (last-writer-wins). On failure: `rollbackConsolidationLock(priorMtime)` rewinds mtime via `utimes()`.

**Exact 4-phase prompt** (verbatim from `buildConsolidationPrompt()`):

```
# Dream: Memory Consolidation

You are performing a dream — a reflective pass over your memory files.
Synthesize what you've learned recently into durable, well-organized memories
so that future sessions can orient quickly.

## Phase 1 — Orient
- `ls` the memory directory to see what already exists
- Read `MEMORY.md` to understand the current index
- Skim existing topic files so you improve them rather than creating duplicates

## Phase 2 — Gather recent signal
Look for new information worth persisting. Sources in rough priority order:
1. Daily logs (`logs/YYYY/MM/YYYY-MM-DD.md`) if present
2. Existing memories that drifted — facts that contradict something in codebase now
3. Transcript search — grep the JSONL transcripts narrowly for specific context

Don't exhaustively read transcripts. Look only for things you already suspect matter.

## Phase 3 — Consolidate
For each thing worth remembering, write or update a memory file. Focus on:
- Merging new signal into existing topic files rather than creating near-duplicates
- Converting relative dates ("yesterday", "last week") to absolute dates
- Deleting contradicted facts — if today's investigation disproves an old memory, fix it

## Phase 4 — Prune and index
Update `MEMORY.md` so it stays under ${MAX_ENTRYPOINT_LINES} lines AND under ~25KB.
It's an index, not a dump — each entry should be one line under ~150 characters.
- Remove pointers to memories that are now stale, wrong, or superseded
- Demote verbose entries (>~200 chars → shorten line, move detail to topic file)
- Add pointers to newly important memories
- Resolve contradictions — if two files disagree, fix the wrong one
```

Merge vs. delete decisions are made by the LLM agent itself. Output is both new files and edits to existing ones.

**Gap:** Our `MemoryConsolidatorService` lacks the gating logic (time + session count + mutex). We also don't use an LLM agent to drive consolidation — we have rule-based compaction which is less flexible.

### 5.3 Skills — Exact Security Model

**Nonce directory:** `join(getClaudeTempDir(), 'bundled-skills', MACRO.VERSION, randomBytes(16).toString('hex'))` — new per process, memoized.

**Exact open flags:**

```typescript
// Non-Windows:
;fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | O_NOFOLLOW
// File mode: 0o600, directory mode: 0o700
// Windows: 'wx' (equivalent, avoids libuv EINVAL with numeric O_EXCL)
```

**Prefix prepended:** `"Base directory for this skill: ${baseDir}\n\n"` prepended to first text block.

**Variable substitution in skill content:**

-   `$ARGUMENTS` → full arg string
-   `$ARG_NAME` → named arg
-   `${CLAUDE_SKILL_DIR}` → skill's own directory (normalized to forward slashes on Windows)
-   `${CLAUDE_SESSION_ID}` → current session ID

**Inline shell execution (`!` in markdown):** Skills can embed `!`-prefixed lines that execute shell commands when the skill is loaded. **Security exception: MCP skills are remote/untrusted and never execute inline shell commands.**

**`allowedTools` enforcement:** During skill execution, `getAppState()` is wrapped to inject `allowedTools` into `toolPermissionContext.alwaysAllowRules.command` — auto-allowing exactly those tools for the skill's scope.

### 5.4 Effort Level — Exact API Mapping

`effort` maps to **`output_config.effort`** — a beta API field. It is NOT a thinking budget, NOT a temperature change, NOT a system prompt instruction.

```typescript
// Resolution chain:
// CLAUDE_CODE_EFFORT_LEVEL env → appState.effortValue → getDefaultEffortForModel(model)
// 'max' on non-Opus-4.6 → downgraded to 'high' (API rejects 'max' on other models)

outputConfig.effort = effortValue // 'low' | 'medium' | 'high' | 'max'
betas.push(EFFORT_BETA_HEADER)
```

Thinking is configured **independently** of effort:

-   Models supporting adaptive thinking → `{ type: 'adaptive' }` (no budget)
-   Others → `{ type: 'enabled', budget_tokens: getMaxThinkingTokensForModel(model) }`

Effort is applied at the main API call level. Subagents use their own independently resolved effort.

**Gap:** We have complexity routing in `@reactive-agents/cost` but no `effort` signal sent to providers. This is a free quality/cost knob we're not using.

---

## Section 6 — Hooks & Observability

### 6.1 Hook Execution Model — Exact Details

-   **BashCommandHook:** spawned as child process via `spawn()`. Timeout: per-hook `timeout` field or `10 * 60 * 1000` ms (10 min). SessionEnd hooks: 1500ms default (overridable via `CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS`).
-   **PromptHook:** LLM sideQuery. Timeout: `hook.timeout * 1000` or **30,000ms** (30s).
-   **AgentHook:** LLM sideQuery. Timeout: `hook.timeout * 1000` or **60,000ms** (60s).
-   **HttpHook:** HTTP POST. Timeout: per-hook field or same 10min default.

**Output injection:** Hook results become `AttachmentMessage` objects with `type: 'hook_success'` or `'hook_non_blocking_error'`. These appear in the transcript but are not `isMeta`.

### 6.2 `asyncRewake: true` — Exact Mechanism

No IPC or signal mechanism. It's a Promise chain on the child process exit event:

```typescript
void shellCommand.result.then(async (result) => {
    // setImmediate to drain stdio data events before reading
    await new Promise((resolve) => setImmediate(resolve))
    const stdout = await shellCommand.taskOutput.getStdout()
    const stderr = shellCommand.taskOutput.getStderr()
    shellCommand.cleanup()
    if (result.code === 2) {
        enqueuePendingNotification({
            value: wrapInSystemReminder(
                `Stop hook blocking error from command "${hookName}": ${
                    stderr || stdout
                }`
            ),
            mode: 'task-notification',
        })
    }
})
```

The `setImmediate` is critical: stdio `data` events may still be pending after `exit`. The notification is picked up by `useQueueProcessor` (if idle) or injected mid-query via `queued_command` attachments (if busy). A hard cancel (Escape) kills the hook; new prompts do NOT kill it (abort handler no-ops on `'interrupt'` reason).

### 6.3 PreToolUse / PostToolUse Exact Schemas

```typescript
// PreToolUse
BaseHookInput & {
  hook_event_name: 'PreToolUse'
  tool_name: string
  tool_input: unknown
  tool_use_id: string
}

// PostToolUse
BaseHookInput & {
  hook_event_name: 'PostToolUse'
  tool_name: string
  tool_input: unknown
  tool_response: unknown
  tool_use_id: string
}

// PreToolUse output — what the hook can return to control execution
{
  hookEventName: 'PreToolUse'
  permissionDecision?: 'allow' | 'deny' | 'ask'
  permissionDecisionReason?: string
  updatedInput?: Record<string, unknown>  // modify the tool input before execution
  additionalContext?: string
}
```

**Short-circuit:** Hook exits with code 2 (or returns `{ decision: 'block' }`). Model receives: `[${hook.command}]: ${stderr || 'No stderr output'}` as the tool result error.

### 6.4 Cost Tracking — Exact Implementation

**Reading:** From `message_delta` event in the streaming response. `updateUsage()` merges with "take new value if > 0, else keep prior" strategy. **Direct property mutation** (not object replacement) to preserve transcript write queue reference:

```typescript
// IMPORTANT: Direct mutation, not { ...lastMsg.message, usage }
// The transcript queue holds a reference to message.message and serializes
// it lazily (100ms flush). Object replacement disconnects the queued reference.
lastMsg.message.usage = usage
lastMsg.message.stop_reason = stopReason
```

**Cache savings formula:**

```typescript
cost =
    (input_tokens / 1_000_000) * inputTokens +
    (output_tokens / 1_000_000) * outputTokens +
    (cache_read_input_tokens / 1_000_000) * promptCacheReadTokens + // 10x discount
    (cache_creation_input_tokens / 1_000_000) * promptCacheWriteTokens +
    web_search_requests * webSearchRequests
```

**Exact pricing tiers (per Mtok):**

| Tier               | Models        | Input | Output | Cache Read | Cache Write |
| ------------------ | ------------- | ----- | ------ | ---------- | ----------- |
| `COST_TIER_3_15`   | Sonnet        | $3    | $15    | $0.30      | $3.75       |
| `COST_TIER_5_25`   | Opus 4.5      | $5    | $25    | $0.50      | $6.25       |
| `COST_TIER_15_75`  | Opus 4/4.1    | $15   | $75    | $1.50      | $18.75      |
| `COST_TIER_30_150` | Opus 4.6 fast | $30   | $150   | $3.00      | $37.50      |

**`cache_deleted_input_tokens`:** Also tracked (behind `CACHED_MICROCOMPACT` feature flag) using same "take if > 0" guard. This is the token count freed by `cache_edits` API operations.

### 6.5 `pendingToolUseSummary` — Exact Purpose

Set after tool execution completes if `config.gates.emitToolUseSummaries && toolCount > 0 && !aborted && !isSubagent`. A Haiku call fires asynchronously:

```typescript
// System prompt for Haiku summary generation:
;`Write a short summary label describing what these tool calls accomplished.
It appears as a single-line row in a mobile app and truncates around 30
characters, so think git-commit-subject, not sentence.
Keep the verb in past tense and the most distinctive noun.
Examples: "Searched in auth/", "Fixed NPE in UserService", "Created signup endpoint"`
```

The promise is resolved at the **top of the next loop iteration** and yielded as a `ToolUseSummaryMessage`:

```typescript
{
  type: 'tool_use_summary',
  summary: string,               // ~30 chars, git-commit style
  precedingToolUseIds: string[], // IDs of the tools this summarizes
  uuid: string,
  timestamp: string,
}
```

This IS the source of the SDK's `SDKToolUseSummaryMessage` (`type: 'tool_use_summary'`). It IS related to our `StreamCompleted.toolSummary` — we surface the same concept but generate it differently.

---

## Section 7 — Design Decisions

### 7.1 No Text-Based ACTION: Parsing

**Finding:** There is no text-based `ACTION:` parsing path in Claude Code. The codebase uses exclusively native function calling via `tool_use` blocks from the Anthropic API. Grep for `ACTION:` returns only unrelated hits.

**Implication for reactive-agents:** Our text-based ACTION: parsing path (used for test mocks via `supportsToolCalling: false`) is a reactive-agents-specific design, not inherited from Claude Code. The concern from MEMORY.md about "two code paths coexisting" is valid — the text path is exclusively for our test mock layer. We should gate it clearly and consider removing it in V1.1.

### 7.2 No `react-kernel.ts`

**Finding:** `react-kernel.ts` does not exist in Claude Code. This is a reactive-agents file we created. The MEMORY.md debt item about it being 1,961 LOC is about _our own_ codebase, not Claude Code's.

### 7.3 Settings System — 5 Sources (Not 4)

The actual priority order:

1. `userSettings` — `~/.claude/settings.json` (global user)
2. `projectSettings` — `.claude/settings.json` (committed, shared)
3. `localSettings` — `.claude/settings.local.json` (gitignored, per-developer)
4. `flagSettings` — from `--settings` CLI flag
5. **`policySettings` (highest priority)** — managed settings via: remote API > HKLM/macOS plist > managed-settings.json > HKCU

**Why policySettings has highest priority:** An org can enforce `deny` rules that individual users cannot override. Without it, a malicious `.claude/settings.json` in a cloned repo could override a user's global deny rules — a security vulnerability. "First source wins" within policySettings (remote beats MDM beats file beats HKCU).

**Gap:** Our settings system has 3 layers (global, project, runtime). We're missing the `policySettings` (enterprise enforcement) and `localSettings` (gitignored per-developer overrides) concepts. The `localSettings` gap is relevant for teams where developers need per-machine overrides without committing them.

### 7.4 Permission Pattern DSL — Exact Parser

**Not glob or minimatch — hand-rolled regex-based.** Three rule types:

-   `exact` — literal string match
-   `prefix` — legacy `:*` suffix syntax (`npm:*` → prefix `npm`)
-   `wildcard` — contains unescaped `*`, converted to `.*` regex with `^...$` anchoring and `s` (dotAll) flag

**Critical security properties:**

-   **Allow rules:** strip safe wrappers only (`timeout`, `time`, `nice`, `nohup`, safe env vars) — intentional to prevent over-matching
-   **Deny rules:** strip ALL env var prefixes (fixed-point iteration) — prevents `FOO=bar denied_command` bypass. Referenced HackerOne #3543050.
-   Compound command protection: prefix rules don't match `cd /path && evil_command`
-   `git *` → trailing single-star made optional → matches bare `git`
-   dotAll flag → wildcard matches commands with embedded newlines (heredocs)

**Gap:** Our tool permission system uses structured types. The string pattern form handles these security edge cases (env var stripping, compound command blocking, safe wrapper normalization) that a structured rule type would require explicit handling for. Not necessarily a gap to fix — but we should be aware of these attack vectors in our own Bash tool implementation.

### 7.5 `createResolveOnce` — Exact Implementation

```typescript
function createResolveOnce<T>(resolve: (value: T) => void): ResolveOnce<T> {
    let claimed = false
    let delivered = false
    return {
        resolve(value: T) {
            if (delivered) return
            delivered = true
            claimed = true
            resolve(value)
        },
        isResolved() {
            return claimed
        },
        claim() {
            if (claimed) return false
            claimed = true
            return true
        },
    }
}
```

Two booleans: `claimed` (check-and-mark, used by async callbacks before awaiting) and `delivered` (final guard on resolve). The `claim()` method closes the window between `isResolved()` check and `resolve()` call in concurrent async handlers. The 5-way race: user interaction, PermissionRequest hooks, bash classifier, bridge (CCR), and channel (Telegram/iMessage).

**Gap:** Our IntelligenceControlSurface's 10-evaluator decision system doesn't use this pattern. When multiple evaluators fire concurrently, whichever updates state last wins — not whichever fires first. Worth adopting `claim()` semantics for our reactive controller decisions.

### 7.6 `detectCompletionGaps` — Does Not Exist in Claude Code

`detectCompletionGaps`, `withMinIterations(n)`, and `final-answer` meta-tool are **reactive-agents concepts that do not exist in Claude Code**. Claude Code uses a different loop termination model: native FC means "no tool_use blocks in response = done." There is no gap detection or minimum iteration requirement.

**Implication:** Our `detectCompletionGaps` in `@reactive-agents/tools` and `withMinIterations(n)` are genuine reactive-agents innovations, not copied patterns. They address a real gap in the Claude Code model: with text-based tool calling (our legacy path), the model might produce "final answer" text before actually using required tools.

### 7.7 CONTEXT_COLLAPSE — A Third Compaction Approach

Distinct from both microcompact and autocompact. It's **granular span-based summarization**:

-   **Microcompact:** strips redundant content from individual messages (tool result content clearing)
-   **Autocompact:** summarizes the entire conversation into one compact summary
-   **Context collapse:** identifies spans of messages (UUID-bounded), summarizes each span individually, inserts `<collapsed>` placeholder messages, preserves the rest intact

**`recoverFromOverflow`:** On 413 prompt-too-long, drains all staged collapses (commits them). A "staged collapse" is a `{ startUuid, endUuid, summary, risk, stagedAt }` object — spans identified by a background context-agent. "Draining" = committing all staged summaries at once.

**Read-time projection:** `projectView()` replays the commit log on every query loop entry, splicing out archived messages and inserting placeholders. The actual messages are not deleted — they're preserved in the JSONL transcript as `marble-origami-commit` entries.

**Why this matters for reactive-agents:** This is more sophisticated than our context approach. Rather than all-or-nothing summarization, it allows selective compression of old spans while keeping recent messages verbatim. Our `ContextEngine` only scores per-iteration; we have no span-identification background agent.

### 7.8 `pendingToolUseSummary` — Design Rationale

The promise is stored in loop State rather than awaited immediately because the Haiku call should NOT block the next API request. The pattern: fire the summary generation asynchronously at end of turn N, yield the result at the start of turn N+1 before the next API call. This means the summary is available for display but the loop doesn't pay latency for it on the hot path.

---

## Priority-Ranked Improvement Plan

### P0 — Safety / Correctness (implement before any feature work)

| #    | Finding                                           | Current Gap                                               | Target                                                                         |
| ---- | ------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------ |
| P0-1 | Withheld error pattern                            | `ExecutionEngine` surfaces recoverable errors immediately | Suppress errors during recovery; only yield after all recovery paths exhausted |
| P0-2 | `max_output_tokens` Stage 1 escalation (8k → 64k) | Retry with same limit                                     | Retry with `maxOutputTokens: 64k` before multi-turn recovery                   |
| P0-3 | `stopHookActive` guard in KernelState             | `KernelHooks` runs unconditionally                        | Add `hookActive` flag; prevent re-entrant hook triggering                      |
| P0-4 | Skip KernelHooks on API errors                    | Hooks run even when last message was an API error         | Guard: `if (lastMessage.isApiError) skip hooks, run StopFailure hooks only`    |

### P1 — Reliability / Efficiency (next sprint)

| #    | Finding                                        | Current Gap                                  | Target                                                                                            |
| ---- | ---------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| P1-1 | Autocompact circuit breaker                    | No limit on consecutive compaction failures  | Stop after 3 consecutive failures; prevent API call burn                                          |
| P1-2 | Microcompact (strip tool results, no LLM call) | Only full LLM summarization                  | Add content-stripping pass: keep last N tool results, clear older ones                            |
| P1-3 | `frozen` tool result category                  | Re-evaluate every turn                       | Partition tool results into mustReapply/frozen/fresh; never re-replace frozen                     |
| P1-4 | `hasAttemptedReactiveCompact` preservation     | Unknown if preserved across hook transitions | Preserve across `stop_hook_blocking`; reset only on `next_turn`                                   |
| P1-5 | System prompt section `cacheBreak` discipline  | No explicit model                            | Introduce `dynamicSection` (recomputes) vs `cachedSection` (memoized); require reason for dynamic |
| P1-6 | Background agents use separate AbortController | Linked to parent                             | Background agents survive parent cancellation; killed explicitly                                  |
| P1-7 | `alreadySurfaced` dedup for memory injection   | No turn-level dedup                          | Track surfaced memory IDs per session; don't reinject                                             |

### P2 — Quality / DX (V1.1)

| #    | Finding                                                     | Current Gap                          | Target                                                                                      |
| ---- | ----------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------- |
| P2-1 | Token-delta diminishing returns guard                       | Entropy sensor only                  | Add: `continuationCount >= 3 && delta < 500 (2 consecutive)` → stop                         |
| P2-2 | `transition` reason tagging on KernelState                  | No per-iteration continuation reason | Add `transitionReason` to `KernelState` for debugging + entropy signal                      |
| P2-3 | Two-partition tool pool sort (built-ins prefix, MCP suffix) | Flat sort                            | Sort built-ins and MCP tools as separate partitions; preserve cache breakpoint              |
| P2-4 | `outputFile` return channel for background agents           | Notification only                    | Return known output file path with `async_launched`; parent can poll/read                   |
| P2-5 | 9-section compact summarization prompt                      | Simpler debrief prompt               | Adopt structured 9-section format for `DebriefSynthesizer` compact path                     |
| P2-6 | Callback-before-request ordering in orchestration           | Unknown if consistent                | Document and enforce: register receipt handler before sending request in all A2A flows      |
| P2-7 | `dontAsk` permission mode (fail-closed autonomy)            | Missing mode                         | Add: pre-approved tools run, everything else silently denied (safer than bypassPermissions) |
| P2-8 | `PreCompact` hook + `CompactionStarted` EventBus event      | No compaction lifecycle hook         | Emit event before compaction; allow hooks to archive full transcript                        |

### P3 — Polish / Low Risk

| #    | Finding                                            | Current Gap                       | Target                                                                   |
| ---- | -------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------ |
| P3-1 | `stop_reason: "refusal"` in TerminatedBy           | No refusal detection              | Add `"refusal"` variant to `TerminatedBy` type                           |
| P3-2 | `error_max_structured_output_retries` TerminatedBy | No structured output failure code | Add distinct variant for output validator exhaustion                     |
| P3-3 | `asyncRewake` for gateway background monitors      | No exit-code-based agent wake     | Background hook exits with code 2 → re-queues agent for next iteration   |
| P3-4 | `allowedTools` scoping per-skill execution         | All tools available during skill  | Skills declare `allowedTools`; harness enforces during skill invocation  |
| P3-5 | `effort` level signal to provider                  | No effort concept                 | Map task complexity classification to effort parameter on provider calls |

---

## Key Numbers (Reference)

| Constant                               | Value                 | Source                                |
| -------------------------------------- | --------------------- | ------------------------------------- |
| `MAX_TOOL_RESULTS_PER_MESSAGE_CHARS`   | 200,000 chars         | `src/constants/toolLimits.ts`         |
| `AUTOCOMPACT_BUFFER_TOKENS`            | 13,000 tokens         | `src/services/compact/autoCompact.ts` |
| `MAX_OUTPUT_TOKENS_FOR_SUMMARY`        | 20,000 tokens         | Reserve for compact output            |
| `MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES` | 3                     | Circuit breaker                       |
| `MAX_OUTPUT_TOKENS_RECOVERY_LIMIT`     | 3 attempts            | After 64k escalation fails            |
| `COMPLETION_THRESHOLD`                 | 0.9 (90%)             | Token budget stop                     |
| `DIMINISHING_THRESHOLD`                | 500 tokens            | Delta threshold, 2 consecutive        |
| `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY` | 10 (default)          | Parallel tool cap                     |
| Swarm lockfile retries                 | 10, 5ms–100ms backoff | `proper-lockfile` config              |
| AutoDream min gap                      | 24 hours + 5 sessions | Memory consolidation gate             |
| Memory selection max                   | 5 files, 256 tokens   | LLM-based relevance pass              |

---

## Additional Findings — Corrections to Prior Assumptions

| Prior Assumption                             | Reality                                                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Settings has 4 layers                        | Actually 5: `userSettings`, `projectSettings`, `localSettings`, `flagSettings`, `policySettings` |
| TEXT-based ACTION: parsing exists in CC      | Does NOT exist — CC uses native FC only. Our text path is reactive-agents-specific.              |
| `react-kernel.ts` is a CC file at ~1,961 LOC | Does NOT exist in CC — this is our own file. CC debt item is self-referential.                   |
| `detectCompletionGaps` is from CC            | Does NOT exist in CC — this is a reactive-agents innovation.                                     |
| `final-answer` meta-tool comes from CC       | Does NOT exist in CC — pure reactive-agents concept.                                             |
| Effort = thinking budget                     | Effort = `output_config.effort` beta API field. Thinking is configured independently.            |
| `asyncRewake` uses IPC/signals               | Pure Promise chain on child process exit — `setImmediate` + `enqueuePendingNotification`         |

## Key Numbers — Complete Reference

| Constant                               | Value                   | Source                                              |
| -------------------------------------- | ----------------------- | --------------------------------------------------- |
| `MAX_TOOL_RESULTS_PER_MESSAGE_CHARS`   | 200,000 chars           | `src/constants/toolLimits.ts`                       |
| `AUTOCOMPACT_BUFFER_TOKENS`            | 13,000 tokens           | `src/services/compact/autoCompact.ts`               |
| `MAX_OUTPUT_TOKENS_FOR_SUMMARY`        | 20,000 tokens           | Reserve for compact output (p99.99 = 17,387 tokens) |
| `MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES` | 3                       | Circuit breaker                                     |
| `MAX_OUTPUT_TOKENS_RECOVERY_LIMIT`     | 3 attempts              | After 64k escalation fails                          |
| `ESCALATED_MAX_TOKENS`                 | 64,000                  | Stage 1 escalation target                           |
| `COMPLETION_THRESHOLD`                 | 0.9 (90%)               | Token budget stop                                   |
| `DIMINISHING_THRESHOLD`                | 500 tokens              | Delta threshold, 2 consecutive                      |
| `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY` | 10 (default)            | Parallel tool cap                                   |
| `TOOL_HOOK_EXECUTION_TIMEOUT_MS`       | 600,000ms (10min)       | BashCommandHook default                             |
| `SESSION_END_HOOK_TIMEOUT_MS_DEFAULT`  | 1,500ms                 | SessionEnd hooks                                    |
| PromptHook default timeout             | 30,000ms                | `src/utils/hooks/execPromptHook.ts`                 |
| AgentHook default timeout              | 60,000ms                | `src/utils/hooks/execAgentHook.ts`                  |
| Swarm lockfile retries                 | 10, 5ms–100ms backoff   | `proper-lockfile` config                            |
| AutoDream min gap                      | 24 hours                | `cfg.minHours`                                      |
| AutoDream min sessions                 | 5 (excl. current)       | `cfg.minSessions`                                   |
| AutoDream lock stale threshold         | 3,600,000ms (1 hour)    | `HOLDER_STALE_MS`                                   |
| Memory file scan limit                 | 200 files               | `MAX_MEMORY_FILES`                                  |
| Memory frontmatter scan depth          | 30 lines                | `FRONTMATTER_MAX_LINES`                             |
| Memory selection max                   | 5 files                 | LLM relevance pass                                  |
| Memory freshness threshold             | 1 day                   | `memoryAgeDays(mtime) > 1`                          |
| Tool summary length target             | ~30 chars               | git-commit-subject style                            |
| Skill nonce bytes                      | 16 bytes (32 hex chars) | `randomBytes(16)`                                   |

## Key Findings for Reactive Agents

What Would Actually Move the Needle for Reactive Agents

Tier 1 — Fundamental Correctness (These Are Bugs, Not Features)

These aren't improvements — they're broken behaviors we're currently shipping:

1. The Withheld Error Pattern

This is the single biggest gap. When a provider returns max_output_tokens, we surface that error immediately to
the caller and terminate. Claude Code withholds it, escalates to 64k, then does multi-turn recovery with a
precise injection: "Resume directly — no apology, no recap. Pick up mid-thought."

For difficult tasks specifically: the model is most likely to hit output limits when doing the most complex work
— long code generation, structured plan elaboration, multi-step reasoning. This is exactly when you can't
afford to fail silently. Our agents currently abort at the worst possible moment on the hardest tasks.

2. Stop Hook Death Spiral Prevention

The stopHookActive guard exists because without it: hook fires on error → injects message → loop retries → still
errored → hook fires again → infinite loop burning API calls. The hasAttemptedReactiveCompact must be preserved
(not reset) across hook-triggered continuations. Without this, compaction creates its own spiral.

For a general-purpose framework this is arguably more dangerous than for a coding agent because our hooks cover
a wider surface — entropy sensor, reactive controller, memory consolidation, skill injection. More hooks = more
opportunities for this spiral.

3. Never Run KernelHooks on API Errors

The comment is definitive: "The model never produced a real response — hooks evaluating it create a death
spiral." Our KernelHooks runs unconditionally. Every time a provider rate-limits us or returns a network error,
we're running post-kernel processing against a response that isn't a model response. This silently corrupts
entropy scores, controller decisions, and memory writes.

---

Tier 2 — Context Efficiency (Where Most Tokens Are Wasted)

4. Microcompact Before Autocompact

The hierarchy matters: strip tool result content first (no LLM call, milliseconds) → only fall through to full
LLM summarization if still over budget. The time-based path is particularly relevant for long-running general
agents: if 10+ minutes have passed since the last response, older tool results are almost certainly irrelevant
to current work. Replace them with '[Old tool result content cleared]', keep the last N.

For general-purpose agents with web search, API calls, and large data retrieval — tool results dominate context
far more than in a coding agent where FileRead results are at least somewhat reusable across iterations. The
payoff is higher for us.

5. The Frozen Tool Result Category

Once you decide NOT to compress a tool result (because it fit under budget), you can never compress it later.
The server has already cached that prefix. Re-evaluating it on the next turn changes the prefix and busts the
cache.

This is a correctness issue masquerading as an optimization. Our current approach re-evaluates every turn, which
means we're systematically busting our own prompt cache on long-running agents. For a general-purpose agent
running 20+ iteration tasks, every cache miss is paying full input token cost on an ever-growing history.

6. System Prompt Section Cache Discipline

The DANGEROUS_uncachedSystemPromptSection naming convention is the key insight — it makes cache-breaking
explicit and requires a justification string. Everything is memoized by default; you must opt in to recomputing
per turn.

For reactive-agents: our ContextSynthesizerService runs on every iteration. Our system prompt assembly
recomputes tool definitions, skill summaries, and task context on every call. Most of this is stable across
iterations. The discipline of explicitly flagging which sections need to recompute (because they actually
change) vs. which sections are stable would meaningfully reduce per-turn context assembly cost.

7. Autocompact Circuit Breaker

Three consecutive failures → stop trying. The data behind this: 1,279 sessions had 50+ consecutive failures,
burning ~250K API calls/day globally. For general-purpose agents running in production (our gateway/cron agents
especially), an agent stuck in a loop of trying to compact an irrecoverable context will run up costs
indefinitely. Three strikes is the right heuristic.

---

Tier 3 — Loop Quality (Directly Affects Difficult Task Performance)

8. The 7-Transition State Machine with Explicit Reasons

The transition.reason field isn't just for debugging — it carries signal about why the loop is continuing that
the next iteration can act on. stop_hook_blocking means "a hook fired and wants the model to reconsider."
token_budget_continuation means "you're making progress, keep going." max_output_tokens_recovery means "you got
cut off, resume mid-thought."

For our entropy sensor: knowing the transition reason would significantly improve trajectory classification. A
stop_hook_blocking sequence is a V-recovery pattern. token_budget_continuation repeated N times is a flat
trajectory. max_output_tokens_escalate followed by max_output_tokens_recovery is a known recovery arc, not a
sign of confusion. Our entropy sensor currently can't distinguish these — it treats them all as "model
thinking."

9. Token-Delta Diminishing Returns Guard

The exact condition: continuationCount >= 3 AND delta < 500 tokens (twice consecutively). This is cheap,
model-agnostic, and catches a specific failure mode that entropy analysis can miss: the model generating
plausible-sounding text that adds almost no new tokens because it's spinning in a low-entropy state. Two
consecutive sub-500-token deltas after 3+ continuations = the loop is stalled, not progressing.

For difficult tasks, the inverse is also true and worth noting: a model generating 3,000+ tokens per turn
consistently is doing real work and should NOT be stopped by the entropy sensor just because it's using many
iterations. Token-delta guards would reduce false positives in our early-stop controller.

10. CONTEXT_COLLAPSE — The Third Compaction Tier

The conceptual breakthrough here is read-time projection over destructive summarization. The actual messages are
never deleted — the projectView() function replays a commit log on every query, splicing out archived spans and
inserting placeholders. This means:

-   You can always inspect the full history for debugging
-   Summarization errors don't permanently destroy information
-   Different contexts (main loop vs. debrief vs. entropy scoring) can use different projections

For a general-purpose agent that might run for hours: the ability to selectively compress old spans while
keeping recent context fully intact is dramatically better than the binary choice between "full history" and
"summarized history." The entropy sensor and DebriefSynthesizer could use the full projection while the main
loop uses the compressed one.

---

Tier 4 — Memory Intelligence (Correctness at Scale)

11. Memory Selection: Tools-in-Use Exclusion

The selection prompt rule: "If a list of recently-used tools is provided, do not select memories that are usage
reference or API documentation for those tools... DO still select memories containing warnings, gotchas, or
known issues."

This is a small prompt change with outsized impact. For a general-purpose agent that might have hundreds of
memories: spending selection slots on "how to use tool X" when the agent is already successfully using tool X
wastes the entire memory injection budget. But warnings about tool X — edge cases, failure modes, known bugs —
become MORE relevant when the tool is actively in use.

12. alreadySurfaced Cross-Turn Dedup

Without this, memory injection fills up with the same 5 files on every iteration of a long task. The model keeps
re-reading the same "how to do X" memory while fresh memories that became relevant mid-task never get surfaced.
Our memory system can retriever the same content repeatedly because we have no session-level dedup of what's
already been injected.

13. AutoDream Time + Session Gating

Running consolidation too frequently wastes cycles and introduces noise. The gate: 24h elapsed AND 5 distinct
sessions completed. For our MemoryConsolidatorService running in background: without gating, it triggers on
every run, potentially churning memories during the same work session. The 5-session threshold ensures
consolidation happens across meaningful context shifts, not within a single long session.

---

What's Less Relevant for General-Purpose Agents

-   readFileState / mtime enforcement — only matters with filesystem tools
-   Windows mtime false-positive guard — environment-specific
-   Permission pattern DSL complexity (env var stripping, compound command blocking) — mostly Bash-tool-specific
-   Swarm permission poller at 500ms — our A2A uses a different transport model
-   The specific plan_approval_request protocol — our plan-execute already has approval semantics

---

The Single Biggest Architectural Insight

Beyond any individual feature: the loop is a state machine, not a while loop.

Claude Code encodes every continuation reason explicitly. The current iteration knows why the previous iteration
continued. Recovery paths are named, guarded, and one-shot. This means the system can reason about its own
execution state — "I've already tried compaction, the next 413 should surface the error" — rather than
rediscovering what happened from message contents.

Reactive-agents has the entropy sensor doing sophisticated trajectory analysis, but the kernel loop itself
doesn't carry this structured self-knowledge. The KernelState has steps[] for observability and messages[] for
the LLM, but no transitionReason encoding why the kernel continues. Adding this closes the gap between what our
entropy sensor infers probabilistically and what the loop knows definitively.

For difficult tasks, this matters because the most complex executions are also the ones most likely to hit
recovery paths. An agent that can reason "I'm in a max_output_tokens_recovery sequence, attempt 2 of 3" will
handle these paths more gracefully than one that treats every continuation identically.

---

Recommended Sequence

Given the above, here's the order that maximizes both efficiency and task-solving effectiveness:

1. P0 — The safety trio (withheld errors, stop hook guards, skip hooks on API errors): These prevent active
   regressions on long/hard tasks today.
2. P1 — Frozen result category + section cache discipline: Together these reduce per-turn token cost by 20–40%
   on long sessions without any quality tradeoff.
3. P1 — Microcompact + autocompact circuit breaker: Eliminates the most expensive failure modes.
4. P2 — Transition reason tagging + token-delta guard: Better signal for the entropy sensor, fewer false
   early-stops on legitimately hard tasks.
5. P2 — Memory alreadySurfaced + selection prompt upgrade: Higher-quality context injection for long runs.
6. P3 — Span-based context collapse: The most architecturally ambitious improvement — deserves its own design
   session.
