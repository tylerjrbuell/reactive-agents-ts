# DeepWiki Q&A with Code Context for Repository: zackautocracy/claude-code

## Q1

You have deep access to the Claude Code (claude-code) source codebase.
I'm the architect of a competing TypeScript agentic framework called
reactive-agents. I've already read the Claurst reverse-engineering spec
(all 14 files) and the official Agent SDK docs. I know the high-level
architecture. I need the deep implementation details that aren't in any
spec or doc — the decisions buried in the actual code.

Answer each question with: (1) the exact implementation, (2) the file/line
where it lives, (3) why you think it was designed that way, and (4) what
a framework builder should steal, avoid, or do differently.

---

## Section 1 — Query Loop Internals

1. What is the exact iteration state machine in query.ts? Walk me through
   every field on the State type, what triggers each `transition` value,
   and how recovery paths (max_output_tokens retries, reactive compact,
   streaming failure tombstoning) interact. What's the full decision tree
   for "should this loop continue?"

2. The `microcompact` path strips tool result content without a full LLM
   summarization call. What is the exact algorithm? Which tool results
   are eligible? How does it decide how much to trim? How does the
   "cached path" (cache_edits API) differ from the "time-based path"
   (direct content mutation)?

3. How does `applyToolResultBudget` work? What's the budget threshold,
   and what's the priority order when multiple tool results compete for
   the same budget? Does it prefer newer results, smaller results, or
   something else?

4. What is the `diminishing returns` detection logic in tokenBudget.ts?
   Give me the exact thresholds, the consecutive-check count, and how
   it interacts with stop hooks that themselves inject new messages.

5. Walk me through `handleStopHooks` execution order. When a stop hook
   returns `blockingError`, exactly what message gets injected back into
   the loop and in what format? What prevents infinite hook-triggered
   continuation loops?

---

## Section 2 — Context Window Management

6. What is the exact algorithm in `autocompact`? What prompt does it use
   for summarization? How does it decide what to preserve vs. discard?
   Does it use the CLAUDE.md content to guide preservation, and if so
   how is that content referenced in the summarization prompt?

7. The `compact_boundary` mechanism inserts a marker into the message
   history. What exactly is a `CompactBoundaryMessage`? What fields does
   it carry, and how does the query loop use it to avoid re-processing
   history that's already been summarized?

8. How does `microcompact` interact with the `cache_edits` API parameter
   (`clear_tool_uses_20250919`)? What's the `trigger`, `keep`, `exclude`
   configuration, and what are the failure modes if the API rejects the
   cache edit?

9. How does the system prompt assembly work? Walk me through
   `fetchSystemPromptParts` — what components are assembled, in what
   order, and what caching is applied to each part? What invalidates
   the cache?

10. What does `memoized context provider` mean in practice for
    `getSystemContext()` and `getUserContext()`? What are the exact
    cache keys, what triggers invalidation, and how does
    `setSystemPromptInjection()` clear both caches?

---

## Section 3 — Tool System Internals

11. Walk me through the exact 5-step permission validation sequence for
    a tool call — tool-specific checks → settings allowlist/denylist →
    sandbox policy → active permission mode → hook overrides. Where can
    each step short-circuit, and what does the model receive as the tool
    result when a step denies the call?

12. How does parallel tool execution actually work? When Claude returns
    multiple tool_use blocks in one response, what determines concurrent
    vs. sequential execution? What's the exact mechanism (Promise.all vs
    queue vs something else)? How are partial failures handled when one
    concurrent tool fails?

13. How does `assembleToolPool` ensure cache stability? The spec says
    tools are sorted by name — but what happens when MCP tools are
    added mid-session? Does the sort happen once at session start or
    every request? How does deduplication work when a built-in and MCP
    tool have the same name?

14. The `readFileState` cache enforces read-before-write. What exactly
    happens when a write is rejected due to mtime staleness? Does the
    model receive an error? Is there a retry? How does this interact
    with agents running multiple file-read/write cycles in a single turn?

15. How does the `ToolSearch` deferred loading actually work at the API
    level? When the model calls ToolSearch, does the SDK inject new tool
    schemas mid-conversation, or does it restart the request with an
    expanded tool list? What does the message history look like after
    a ToolSearch + subsequent tool call sequence?

---

## Section 4 — Multi-Agent & Swarm Architecture

16. Walk me through the exact lifecycle of `AgentTool` with
    `run_in_background: true`. How is the subagent spawned? What
    process/fiber/goroutine does it run on? How does the parent agent
    receive progress or results? What cleanup happens if the parent
    is interrupted?

17. The coordinator mode uses 3 communication channels (in-process inbox,
    filesystem mailboxes, bridge). What decides which channel is used?
    What's the exact message format for each channel? How is message
    ordering guaranteed (or not) when multiple agents write concurrently?

18. How does the `plan_approval_request` protocol work end-to-end?
    When a worker calls ExitPlanModeV2Tool, what exactly blocks it from
    continuing? How does the team leader signal approval? What's the
    timeout behavior and what happens on timeout?

19. How does the swarm permission poller work at 500ms? What's the
    exact mailbox file structure? How does it prevent race conditions
    when two workers simultaneously request permission for different
    tools?

20. What does a subagent actually inherit from its parent? The docs say
    "fresh conversation, no prior message history, but loads own system
    prompt and project-level context." What exactly is re-loaded vs.
    inherited? Does it re-read CLAUDE.md from disk on every spawn?

---

## Section 5 — Memory & Skills

21. Walk me through the exact 2-pass memory relevance algorithm.
    What fields from frontmatter are used in pass 1 (the scan)?
    What's the exact LLM prompt used in pass 2 (the selection)?
    What is the `alreadySurfaced` set and how is it maintained across
    turns within a session?

22. How does the `autoDream` memory consolidation work? What's the
    exact 4-phase prompt sequence (Orient → Gather → Consolidate →
    Prune)? How does it decide which memories to merge vs. delete?
    What does the output look like — new files, edits to existing ones?

23. How are bundled skills injected into the system prompt? When a
    skill has a `files` field, what's the exact extraction path, nonce
    directory naming, and how does the model receive the reference?
    How are skills exposed as model-callable tools vs. user-invokable
    slash commands?

24. The effort level (`low|medium|high|max`) controls reasoning depth.
    How does this map to API parameters? Is it an `extended_thinking`
    budget, a temperature adjustment, a system prompt instruction, or
    something else? What's the exact implementation?

---

## Section 6 — Hooks & Observability

25. Walk me through the exact hook execution model. Are hooks run in
    the same process? Same thread? What's the timeout behavior? When
    a PromptHook or AgentHook runs, how does its output get injected
    back into the conversation — as a system message, user message,
    or something else?

26. How does `asyncRewake: true` work mechanically? When a background
    hook exits with code 2, what system receives the signal, and what
    exactly gets re-queued for the agent to process?

27. What telemetry events are emitted during a standard agent run?
    What does the hook event payload look like for PreToolUse and
    PostToolUse — what fields are present? How does the SDK expose
    these to external consumers?

28. How does cost tracking work at the API call level? Is it from
    response headers, from the usage object in the API response, or
    from a separate billing endpoint? How does it handle streaming
    responses where usage isn't known until the stream ends?

---

## Section 7 — Design Decisions I Can't Infer

29. Why does the codebase have two code paths for tool calling (native
    FC and text-based ACTION: parsing)? Are they both maintained or
    is one being deprecated? What determines which path runs?

30. The `react-kernel.ts` is allegedly ~1,961 LOC. What are the main
    logical concerns packed into it? What's the proposed split if it
    were refactored?

31. What was the original design rationale for the 4-layer settings
    system (managed > localProject > project > global)? What problems
    does each layer solve? What would go wrong if you collapsed it to
    2 layers?

32. Why does the tool permission system use pattern matching strings
    (`"Bash(git *)"`) rather than a structured rule type? What are the
    edge cases this handles that a structured type would not?

33. The `createResolveOnce` atomic guard is used in the 5-way
    permission race. What exactly is racing, and what would happen
    without this guard? Has there been a documented race condition
    that motivated it?

34. What is the exact algorithm for `detectCompletionGaps`? How does
    it know when a task is "complete enough" to exit the loop? What
    signals does it use — tool call history, output content, iteration
    count?

### Answer

This is an extremely comprehensive set of 34 detailed questions about the Claude Code codebase internals. I need to be strategic about my tool calls given the iteration limit. Let me start by getting the wiki overview and then making targeted searches for the most critical files mentioned in the questions.

Let me batch as many searches as possible in this first iteration to cover the key areas:

1. query.ts - the main query loop
2. tokenBudget.ts - diminishing returns
3. autocompact - context window management
4. tool system - permission validation, parallel execution
5. agent tool / multi-agent
6. memory system
7. hooks system
8. system prompt assembly

I'll do a mix of wiki reading, file searches, and code searches.

I've gathered a massive amount of information. Let me now make targeted searches for the remaining questions I haven't fully covered yet - particularly around system prompt assembly, compact prompt, effort level mapping, cost tracking, settings layers, createResolveOnce, detectCompletionGaps, autoDream, and the text-based ACTION parsing path.

I now have a massive amount of information to work with. Let me synthesize all of this into comprehensive answers for each of the 34 questions. I have enough data to provide detailed answers for most questions. Let me organize my response.

This is a comprehensive deep-dive. I'll answer each question with implementation details, file locations, design rationale, and framework-builder takeaways.

---

## Section 1 — Query Loop Internals

### 1. Query Loop State Machine

The `State` type in `src/query.ts:204-217` carries all mutable state across loop iterations:

````typescript
type State = {
  messages: Message[]
  toolUseContext: ToolUseContext
  autoCompactTracking: AutoCompactTrackingState | undefined
  maxOutputTokensRecoveryCount: number        // 0..3
  hasAttemptedReactiveCompact: boolean         // one-shot guard
  maxOutputTokensOverride: number | undefined  // escalation to 64k
  pendingToolUseSummary: Promise<ToolUseSummaryMessage | null> | undefined
  stopHookActive: boolean | undefined         // prevents infinite hook loops
  turnCount: number
  transition: Continue | undefined            // why we continued
}
``` claude-code:204-217

**Transition values** (the `reason` field on `transition`):

| Reason | Trigger | File/Line |
|--------|---------|-----------|
| `collapse_drain_retry` | 413 prompt-too-long, context collapse drained staged collapses | L1094-1116 |
| `reactive_compact_retry` | 413 or media-size error, reactive compact succeeded | L1152-1165 |
| `max_output_tokens_escalate` | `max_output_tokens` hit with default 8k cap, escalates to 64k | L1207-1220 |
| `max_output_tokens_recovery` | `max_output_tokens` hit, injects "Resume directly" message | L1231-1251 |
| `stop_hook_blocking` | Stop hook returned `blockingError` | L1283-1305 |
| `token_budget_continuation` | Token budget < 90% and not diminishing | L1321-1340 |
| `next_turn` | Normal tool-use follow-up | L1715-1727 |

**Decision tree for "should this loop continue?":**

1. If aborted → return `aborted_streaming`
2. If `!needsFollowUp` (no tool_use blocks):
   - If withheld 413 → try collapse drain → try reactive compact → surface error
   - If withheld media error → try reactive compact → surface error
   - If withheld `max_output_tokens` → try escalate to 64k → try multi-turn recovery (up to 3) → surface error
   - If API error → return `completed`
   - Run stop hooks → if `blockingErrors` → continue with `stop_hook_blocking`
   - If `preventContinuation` → return `stop_hook_prevented`
   - Check token budget → if under 90% → continue with `token_budget_continuation`
   - Return `completed`
3. If `needsFollowUp` (has tool_use blocks):
   - Execute tools (streaming or sequential)
   - If `shouldPreventContinuation` (hook stopped) → return `completed`
   - Check `maxTurns` limit → return `max_turns`
   - Autocompact if needed
   - Continue with `next_turn` claude-code:1062-1357

**Recovery path interactions:** The `hasAttemptedReactiveCompact` flag is preserved across stop-hook blocking transitions (L1297) to prevent a death spiral: compact → still too long → error → stop hook → compact → ... The `maxOutputTokensRecoveryCount` resets to 0 on `next_turn` (L1720) and `stop_hook_blocking` (L1291).

**Framework takeaway:** Steal the "withheld error" pattern — don't yield intermediate errors to SDK consumers during recovery. The `isWithheldMaxOutputTokens` check (L175-179) prevents SDK callers from terminating the session on a recoverable error. Avoid the complexity of 7+ continue sites by using a single `State` object reassignment pattern.

---

### 2. Microcompact Algorithm

Microcompact lives in `src/services/compact/microCompact.ts`. It has **two paths**:

**Eligible tools** (hardcoded set at L41-50): claude-code:41-50

````

FileRead, Bash/PowerShell, Grep, Glob, WebSearch, WebFetch, FileEdit, FileWrite

````

**Time-based path** (`maybeTimeBasedMicrocompact`, L446-529):
- Fires when the gap since the last assistant message exceeds a configurable threshold (from GrowthBook `getTimeBasedMCConfig`)
- Collects all compactable tool_use IDs, keeps the last N (`keepRecent`, floor at 1), clears the rest by replacing content with `'[Old tool result content cleared]'`
- Directly mutates message content (returns new message array)
- Resets cached MC state since server cache is now cold claude-code:446-529

**Cached path** (`cachedMicrocompactPath`, L305-398):
- Only runs for main thread, supported models, ant users
- Does NOT modify local message content — instead queues `cache_edits` blocks for the API layer
- Uses count-based trigger/keep thresholds from GrowthBook config (`config.triggerThreshold`, `config.keepRecent`)
- Registers tool results by `tool_use_id`, groups by user message
- Calls `mod.getToolResultsToDelete(state)` to determine which to delete
- Returns `pendingCacheEdits` metadata; the actual boundary message is deferred until after the API response so it can use `cache_deleted_input_tokens` from the API claude-code:305-398

**Framework takeaway:** The two-path design is clever — time-based for cold caches (content mutation is free), cache-editing for warm caches (preserves the cached prefix). Steal the deferred boundary message pattern. Avoid the complexity of maintaining two parallel compaction strategies unless you have a server-side cache editing API.

---

### 3. `applyToolResultBudget`

Lives in `src/utils/toolResultStorage.ts:924-936`. The budget threshold is `MAX_TOOL_RESULTS_PER_MESSAGE_CHARS = 200_000` (overridable via GrowthBook `tengu_hawthorn_window`). claude-code:36-49

**Priority order:** The `selectFreshToReplace` function (L675) picks the **largest fresh results first** to replace until `frozenSize + remainingFreshSize <= limit`. It sorts eligible candidates by size descending and greedily persists the biggest ones to disk. claude-code:669-675

**Key design:** Results are partitioned into three categories per `partitionByPriorDecision` (L649-666):
- `mustReapply`: previously replaced → re-apply cached replacement (byte-identical, zero I/O)
- `frozen`: previously seen, left unreplaced → never replaced later (would break prompt cache)
- `fresh`: never seen → eligible for new replacement decisions

Tools with `maxResultSizeChars: Infinity` (like FileRead) are skipped entirely — they self-bound via their own `maxTokens`. claude-code:641-667

**Framework takeaway:** Steal the "freeze decisions for prompt cache stability" pattern. Once you've decided not to replace a result, never replace it later. The `seenIds` + `replacements` dual-tracking is the key insight.

---

### 4. Diminishing Returns Detection

In `src/query/tokenBudget.ts:1-93`:

```typescript
const COMPLETION_THRESHOLD = 0.9    // 90% of budget
const DIMINISHING_THRESHOLD = 500   // tokens
``` claude-code:1-4

**Algorithm:**
```typescript
const isDiminishing =
  tracker.continuationCount >= 3 &&                    // at least 3 continuations
  deltaSinceLastCheck < DIMINISHING_THRESHOLD &&       // current delta < 500 tokens
  tracker.lastDeltaTokens < DIMINISHING_THRESHOLD      // previous delta < 500 tokens
``` claude-code:59-62

So it requires **2 consecutive checks** where delta < 500 tokens, AND at least 3 prior continuations. The `continue` decision fires when `!isDiminishing && turnTokens < budget * 0.9`. The nudge message injected is: `"Stopped at X% of token target (Y / Z). Keep working — do not summarize."` claude-code:66-73

**Interaction with stop hooks:** Token budget check runs AFTER stop hooks in the `!needsFollowUp` path (L1308-1355). If a stop hook injects blocking errors, the loop continues with `stop_hook_blocking` transition, and the token budget check doesn't run that iteration. On the next iteration, `maxOutputTokensRecoveryCount` is reset to 0.

**Framework takeaway:** The 500-token threshold with 2-consecutive-check requirement is a good heuristic. Steal the `BudgetTracker` pattern (stateful across iterations). The budget feature is disabled for subagents (`agentId` check at L51).

---

### 5. `handleStopHooks` Execution

In `src/query/stopHooks.ts:65-454`: claude-code:65-80

**Execution order:**
1. Save `CacheSafeParams` snapshot (L96-98)
2. Template job classification (if applicable, L108-132)
3. Fire background bookkeeping: prompt suggestion, extract memories, auto-dream (L136-157)
4. Computer-use cleanup (L164-173)
5. Execute stop hooks via `executeStopHooks()` generator (L180-189)
6. If teammate: run `TaskCompleted` hooks, then `TeammateIdle` hooks (L334-452)

**When `blockingError` is returned:** A `createUserMessage` with `isMeta: true` is created containing the hook's error text via `getStopHookMessage()` (L258-263). This message is hidden from UI but injected into the conversation. The query loop then continues with `transition: { reason: 'stop_hook_blocking' }`. claude-code:257-267

**Infinite loop prevention:** The `stopHookActive` flag (L300 in State, L1300 in query.ts) is set to `true` when continuing after a blocking error. This flag is passed to `executeStopHooks` (L184) which can use it to avoid re-triggering. Additionally, `hasAttemptedReactiveCompact` is preserved across stop-hook transitions (L1297) — if compact already failed, it won't retry after the hook-triggered continuation. claude-code:1282-1305

**Framework takeaway:** The `stopHookActive` guard is essential. Without it, a hook that always returns `blockingError` creates an infinite loop. Also steal the pattern of NOT running stop hooks on API errors (L1258-1264) — "the model never produced a real response, so hooks evaluating it create a death spiral."

---

## Section 2 — Context Window Management

### 6. Autocompact Algorithm

In `src/services/compact/autoCompact.ts`:

**Threshold:** `effectiveContextWindow - 13,000 tokens` (the `AUTOCOMPACT_BUFFER_TOKENS`). The effective context window is `contextWindowForModel - min(maxOutputTokens, 20,000)`. claude-code:28-91

**Summarization prompt** is in `src/services/compact/prompt.ts:61-143`. It's a detailed 9-section template asking for: Primary Request, Key Technical Concepts, Files and Code Sections, Errors and Fixes, Problem Solving, All User Messages, Pending Tasks, Current Work, and Optional Next Step. The model first writes an `<analysis>` scratchpad (stripped before injection), then a `<summary>`. claude-code:61-143

**The compact call** uses system prompt `'You are a helpful AI assistant tasked with summarizing conversations.'` (L1302-1303 in compact.ts) and sends the conversation with images stripped. claude-code:1292-1306

**CLAUDE.md is NOT directly referenced in the summarization prompt.** The compact prompt says "There may be additional summarization instructions provided in the included context" — these come from CLAUDE.md's `## Compact Instructions` section if present, but the CLAUDE.md content itself is not injected into the summarization call.

**Circuit breaker:** After 3 consecutive autocompact failures, it stops retrying (`MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3`). claude-code:67-70

---

### 7. CompactBoundaryMessage

Created by `createCompactBoundaryMessage` in `src/utils/messages.ts:4530-4554`:

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
``` claude-code:4530-4554

**How the query loop uses it:** `getMessagesAfterCompactBoundary` (L4643-4656) scans backwards for the last `compact_boundary` message and returns everything from that index onward. This is called at the top of every query loop iteration (L365) to slice the message array. claude-code:4643-4656

---

### 8. Microcompact + `cache_edits` API

The cached MC path (L305-398 in microCompact.ts) uses a `clear_tool_uses_20250919` cache edit type. The **trigger** is count-based (from GrowthBook config `triggerThreshold`). The **keep** is `config.keepRecent` most recent tool results. The **exclude** is the `COMPACTABLE_TOOLS` set — only those tool types are eligible.

If the API rejects the cache edit, the boundary message simply isn't emitted (the `deletedTokens` check at L883 gates it). The messages are returned unchanged — the local content was never modified. claude-code:305-398

---

### 9. System Prompt Assembly

`fetchSystemPromptParts` in `src/utils/queryContext.ts:44-74` runs three things in parallel via `Promise.all`:
1. `getSystemPrompt(tools, model, dirs, mcpClients)` — builds the default prompt sections
2. `getUserContext()` — CLAUDE.md content + current date
3. `getSystemContext()` — git status + cache breaker injection claude-code:44-74

The system prompt sections are defined in `src/constants/prompts.ts:491-555` and use `systemPromptSection()` (memoized, computed once per session) or `DANGEROUS_uncachedSystemPromptSection()` (recomputed every turn). Sections include: `session_guidance`, `memory`, `env_info_simple`, `language`, `output_style`, `mcp_instructions`, `scratchpad`, `frc`, `summarize_tool_results`, `token_budget`. claude-code:491-555

Caching is per-section via `getSystemPromptSectionCache()` — a Map keyed by section name. Invalidated on `/clear` or `/compact` via `clearSystemPromptSections()`. claude-code:1-68

---

### 10. Memoized Context Providers

Both `getUserContext` and `getSystemContext` in `src/context.ts` are wrapped with lodash `memoize()` — zero-argument functions, so the cache key is `undefined` (effectively a singleton cache). claude-code:116-189

**Invalidation:** `setSystemPromptInjection(value)` clears both caches immediately:
```typescript
getUserContext.cache.clear?.()
getSystemContext.cache.clear?.()
``` claude-code:29-34

Also cleared in `clearSessionCaches()` (L52-54 in `src/commands/clear/caches.ts`). claude-code:47-54

---

## Section 3 — Tool System Internals

### 11. Permission Validation Sequence

The full pipeline is in `hasPermissionsToUseToolInner` at `src/utils/permissions/permissions.ts:1158-1237`:

1. **1a. Blanket deny rule** — `getDenyRuleForTool()` checks if the entire tool is denied
2. **1b. Blanket ask rule** — `getAskRuleForTool()` (with sandbox auto-allow bypass for Bash)
3. **1c. Tool-specific check** — `tool.checkPermissions(parsedInput, context)` (e.g., bash subcommand rules, path constraints)
4. **1d. Tool implementation denied** — if checkPermissions returned `deny`
5. **1e. requiresUserInteraction** — tools that always need user interaction
6. **1f. Content-specific ask rules** — from tool.checkPermissions with `ruleBehavior: 'ask'`
7. **1g. Safety checks** — `.git/`, `.claude/`, shell configs (bypass-immune)
8. **Step 2+** — bypass permissions check, always-allowed check, auto-mode classifier, hook overrides claude-code:1158-1237

When denied, the model receives a `tool_result` with `is_error: true` and content like `"Permission to use Bash with command X has been denied."` or `"[Request interrupted by user]"`.

---

### 12. Parallel Tool Execution

Two mechanisms exist:

**Legacy path** (`runTools` in `src/services/tools/toolOrchestration.ts:19-81`): Partitions tool_use blocks into concurrent-safe and non-concurrent batches via `partitionToolCalls`. Concurrent-safe tools run via `runToolsConcurrently` which uses the `all()` generator utility with a concurrency cap (default 10, configurable via `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY`). Non-concurrent tools run serially. claude-code:1-83

**Streaming path** (`StreamingToolExecutor` in `src/services/tools/StreamingToolExecutor.ts:40-206`): Tools are added as they stream in. `canExecuteTool` checks: either no tools executing, or both the new tool and all executing tools are `isConcurrencySafe`. Non-concurrent tools block the queue. Results are buffered and emitted in order. claude-code:34-151

**Partial failures:** When one concurrent tool errors, `StreamingToolExecutor` fires `siblingAbortController` (a child of the parent's abort controller) to kill sibling subprocesses. Queued tools get synthetic error messages: `"Cancelled: parallel tool call X errored"`. claude-code:153-205

The `all()` utility in `src/utils/generators.ts:32-72` is a `Promise.race`-based concurrent generator runner — it starts N generators up to the cap, and when one yields, it advances it; when one finishes, it starts the next from the waiting queue. claude-code:32-72

---

### 13. `assembleToolPool` Cache Stability

In `src/tools.ts:345-367`:

```typescript
const byName = (a: Tool, b: Tool) => a.name.localeCompare(b.name)
return uniqBy(
  [...builtInTools].sort(byName).concat(allowedMcpTools.sort(byName)),
  'name',
)
``` claude-code:345-367

**Sort happens every request** — `assembleToolPool` is called fresh each turn (via `useMergedTools` or `computeTools`). Built-ins are sorted as a contiguous prefix, MCP tools sorted separately as a suffix. This preserves the server's cache breakpoint after the last built-in tool.

**When MCP tools are added mid-session:** They appear in the MCP suffix partition. The sort is stable within each partition, so adding a new MCP tool only shifts the suffix — the built-in prefix stays byte-identical for cache hits.

**Deduplication:** `uniqBy('name')` with built-ins first means built-in tools win on name conflict.

---

### 14. `readFileState` and Read-Before-Write

In `src/tools/FileEditTool/FileEditTool.ts:275-287` and `src/tools/FileWriteTool/FileWriteTool.ts:198-219`:

When a write is rejected due to mtime staleness, the model receives a validation error:
````

"File has been modified since read, either by the user or by a linter. Read it again before attempting to write it."

````claude-code:211-219

If the file was never read: `"File has not been read yet. Read it first before writing to it."` There is no automatic retry — the error is returned as a `tool_result` with `is_error: true`, and the model must call FileRead before retrying.

For concurrent edits within a single turn, the critical section between staleness check and disk write is kept synchronous (no async operations between L444-491 in FileEditTool). claude-code:442-491

---

### 15. ToolSearch Deferred Loading

In `src/services/api/claude.ts:1118-1182`:

When ToolSearch is enabled, deferred tools are sent with `defer_loading: true` in their schema. Only tools that have been "discovered" (via `tool_reference` blocks in message history) are included in the filtered tool list sent to the API. claude-code:1154-1167

When the model calls ToolSearch, the tool returns `tool_reference` blocks in its `tool_result`:
```typescript
content: content.matches.map(name => ({
  type: 'tool_reference' as const,
  tool_name: name,
}))
``` claude-code:462-469

On the **next API request**, `extractDiscoveredToolNames(messages)` scans the message history for `tool_reference` blocks, and those tools are included in the filtered tool list. The SDK does NOT restart the request — the tool schemas appear in the next turn's request naturally.

---

## Section 4 — Multi-Agent & Swarm

### 16. AgentTool with `run_in_background: true`

In `src/tools/AgentTool/AgentTool.tsx:686-764`:

1. `registerAsyncAgent()` creates a `LocalAgentTaskState` with its own `AbortController` (NOT linked to parent's — background agents survive ESC)
2. The agent runs via `void runWithAgentContext(asyncAgentContext, () => wrapWithCwd(() => runAsyncAgentLifecycle(...)))` — a fire-and-forget `void` call
3. It runs on the **same Node.js process** as the parent, in a detached async closure (no separate process/fiber)
4. Parent receives an immediate `{ isAsync: true, status: 'async_launched', agentId }` result
5. Progress is tracked via `updateAsyncAgentProgress` writing to AppState
6. On completion, `enqueueAgentNotification` sends a `<task-notification>` XML message
7. Cleanup on parent interrupt: background agents are NOT aborted by parent ESC. They're killed explicitly via `killAsyncAgent` (registered cleanup handler at L507-509) claude-code:686-764

---

### 17. Coordinator Communication Channels

1. **In-process inbox** (`src/utils/mailbox.ts`): A `Mailbox` class with `queue`, `waiters`, and a signal. Used for in-process teammates. Messages are `{ id, source, content, from, color, timestamp }`. Ordering is FIFO within the queue. claude-code:1-73

2. **Filesystem mailboxes** (`src/utils/teammateMailbox.ts`): JSON files at `.claude/teams/{team_name}/inboxes/{agent_name}.json`. Messages are `{ from, text, timestamp, read, color?, summary? }`. Uses `proper-lockfile` with retries for concurrent write safety. Ordering is append-order within the JSON array. claude-code:1-66

3. **Bridge** (`useMailboxBridge`): Connects the REPL to claude.ai web interface. Messages flow through the bridge transport.

**Channel selection:** In-process teammates use the in-process mailbox (direct function calls). Tmux/split-pane teammates use filesystem mailboxes. Bridge is for remote control connections.

---

### 18. `plan_approval_request` Protocol

In `src/tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts:264-312`:

1. Worker calls `ExitPlanModeV2Tool` → `isPlanModeRequired()` is true
2. Worker writes `plan_approval_request` JSON to team-lead's mailbox via `writeToMailbox`
3. Worker returns `{ awaitingLeaderApproval: true, requestId }` — the tool_result tells the model "Do NOT proceed until you receive approval"
4. The model sees: "Wait for the team lead to review your plan... Check your inbox for response."
5. Leader's `useInboxPoller` (L599-648) detects the `plan_approval_request`, **auto-approves**, and writes a `plan_approval_response` back to the worker's mailbox
6. Worker's `useInboxPoller` (L156-195) detects the response and transitions out of plan mode via `setAppState` claude-code:264-312

**Blocking mechanism:** The model is told via tool_result text to wait. There's no programmatic block — the model is instructed not to proceed. **Timeout:** There is no explicit timeout; the worker waits indefinitely for the inbox message.

---

### 19. Swarm Permission Poller

In `src/hooks/useSwarmPermissionPoller.ts`:

**Poll interval:** `POLL_INTERVAL_MS = 500` (L28). claude-code:28-28

**Mailbox file structure:** `.claude/teams/{team_name}/inboxes/{agent_name}.json` — a JSON array of `TeammateMessage` objects. Permission requests/responses are JSON-stringified into the `text` field.

**Race condition prevention:** `writeToMailbox` uses `proper-lockfile` with retry options (`retries: 10, minTimeout: 5ms, maxTimeout: 100ms`). The lock file is `{inbox_path}.lock`. After acquiring the lock, it re-reads the inbox to get latest state before appending. claude-code:134-192

The `registerPermissionCallback` is called BEFORE `sendPermissionRequestViaMailbox` (L79-123 in swarmWorkerHandler.ts) to avoid the race where the leader responds before the callback is registered. claude-code:79-123

---

### 20. Subagent Inheritance

In `src/tools/AgentTool/runAgent.ts:648-696`:

**Inherited from parent:**
- Permission context (with agent-specific mode override)
### Citations
**File:** src/query.ts (L204-217)
```typescript
type State = {
  messages: Message[]
  toolUseContext: ToolUseContext
  autoCompactTracking: AutoCompactTrackingState | undefined
  maxOutputTokensRecoveryCount: number
  hasAttemptedReactiveCompact: boolean
  maxOutputTokensOverride: number | undefined
  pendingToolUseSummary: Promise<ToolUseSummaryMessage | null> | undefined
  stopHookActive: boolean | undefined
  turnCount: number
  // Why the previous iteration continued. Undefined on first iteration.
  // Lets tests assert recovery paths fired without inspecting message contents.
  transition: Continue | undefined
}
````

**File:** src/query.ts (L1062-1357)

```typescript
    if (!needsFollowUp) {
      const lastMessage = assistantMessages.at(-1)

      // Prompt-too-long recovery: the streaming loop withheld the error
      // (see withheldByCollapse / withheldByReactive above). Try collapse
      // drain first (cheap, keeps granular context), then reactive compact
      // (full summary). Single-shot on each — if a retry still 413's,
      // the next stage handles it or the error surfaces.
      const isWithheld413 =
        lastMessage?.type === 'assistant' &&
        lastMessage.isApiErrorMessage &&
        isPromptTooLongMessage(lastMessage)
      // Media-size rejections (image/PDF/many-image) are recoverable via
      // reactive compact's strip-retry. Unlike PTL, media errors skip the
      // collapse drain — collapse doesn't strip images. mediaRecoveryEnabled
      // is the hoisted gate from before the stream loop (same value as the
      // withholding check — these two must agree or a withheld message is
      // lost). If the oversized media is in the preserved tail, the
      // post-compact turn will media-error again; hasAttemptedReactiveCompact
      // prevents a spiral and the error surfaces.
      const isWithheldMedia =
        mediaRecoveryEnabled &&
        reactiveCompact?.isWithheldMediaSizeError(lastMessage)
      if (isWithheld413) {
        // First: drain all staged context-collapses. Gated on the PREVIOUS
        // transition not being collapse_drain_retry — if we already drained
        // and the retry still 413'd, fall through to reactive compact.
        if (
          feature('CONTEXT_COLLAPSE') &&
          contextCollapse &&
          state.transition?.reason !== 'collapse_drain_retry'
        ) {
          const drained = contextCollapse.recoverFromOverflow(
            messagesForQuery,
            querySource,
          )
          if (drained.committed > 0) {
            const next: State = {
              messages: drained.messages,
              toolUseContext,
              autoCompactTracking: tracking,
              maxOutputTokensRecoveryCount,
              hasAttemptedReactiveCompact,
              maxOutputTokensOverride: undefined,
              pendingToolUseSummary: undefined,
              stopHookActive: undefined,
              turnCount,
              transition: {
                reason: 'collapse_drain_retry',
                committed: drained.committed,
              },
            }
            state = next
            continue
          }
        }
      }
      if ((isWithheld413 || isWithheldMedia) && reactiveCompact) {
        const compacted = await reactiveCompact.tryReactiveCompact({
          hasAttempted: hasAttemptedReactiveCompact,
          querySource,
          aborted: toolUseContext.abortController.signal.aborted,
          messages: messagesForQuery,
          cacheSafeParams: {
            systemPrompt,
            userContext,
            systemContext,
            toolUseContext,
            forkContextMessages: messagesForQuery,
          },
        })

        if (compacted) {
          // task_budget: same carryover as the proactive path above.
          // messagesForQuery still holds the pre-compact array here (the
          // 413-failed attempt's input).
          if (params.taskBudget) {
            const preCompactContext =
              finalContextTokensFromLastResponse(messagesForQuery)
            taskBudgetRemaining = Math.max(
              0,
              (taskBudgetRemaining ?? params.taskBudget.total) -
                preCompactContext,
            )
          }

          const postCompactMessages = buildPostCompactMessages(compacted)
          for (const msg of postCompactMessages) {
            yield msg
          }
          const next: State = {
            messages: postCompactMessages,
            toolUseContext,
            autoCompactTracking: undefined,
            maxOutputTokensRecoveryCount,
            hasAttemptedReactiveCompact: true,
            maxOutputTokensOverride: undefined,
            pendingToolUseSummary: undefined,
            stopHookActive: undefined,
            turnCount,
            transition: { reason: 'reactive_compact_retry' },
          }
          state = next
          continue
        }

        // No recovery — surface the withheld error and exit. Do NOT fall
        // through to stop hooks: the model never produced a valid response,
        // so hooks have nothing meaningful to evaluate. Running stop hooks
        // on prompt-too-long creates a death spiral: error → hook blocking
        // → retry → error → … (the hook injects more tokens each cycle).
        yield lastMessage
        void executeStopFailureHooks(lastMessage, toolUseContext)
        return { reason: isWithheldMedia ? 'image_error' : 'prompt_too_long' }
      } else if (feature('CONTEXT_COLLAPSE') && isWithheld413) {
        // reactiveCompact compiled out but contextCollapse withheld and
        // couldn't recover (staged queue empty/stale). Surface. Same
        // early-return rationale — don't fall through to stop hooks.
        yield lastMessage
        void executeStopFailureHooks(lastMessage, toolUseContext)
        return { reason: 'prompt_too_long' }
      }

      // Check for max_output_tokens and inject recovery message. The error
      // was withheld from the stream above; only surface it if recovery
      // exhausts.
      if (isWithheldMaxOutputTokens(lastMessage)) {
        // Escalating retry: if we used the capped 8k default and hit the
        // limit, retry the SAME request at 64k — no meta message, no
        // multi-turn dance. This fires once per turn (guarded by the
        // override check), then falls through to multi-turn recovery if
        // 64k also hits the cap.
        // 3P default: false (not validated on Bedrock/Vertex)
        const capEnabled = getFeatureValue_CACHED_MAY_BE_STALE(
          'tengu_otk_slot_v1',
          false,
        )
        if (
          capEnabled &&
          maxOutputTokensOverride === undefined &&
          !process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS
        ) {
          logEvent('tengu_max_tokens_escalate', {
            escalatedTo: ESCALATED_MAX_TOKENS,
          })
          const next: State = {
            messages: messagesForQuery,
            toolUseContext,
            autoCompactTracking: tracking,
            maxOutputTokensRecoveryCount,
            hasAttemptedReactiveCompact,
            maxOutputTokensOverride: ESCALATED_MAX_TOKENS,
            pendingToolUseSummary: undefined,
            stopHookActive: undefined,
            turnCount,
            transition: { reason: 'max_output_tokens_escalate' },
          }
          state = next
          continue
        }

        if (maxOutputTokensRecoveryCount < MAX_OUTPUT_TOKENS_RECOVERY_LIMIT) {
          const recoveryMessage = createUserMessage({
            content:
              `Output token limit hit. Resume directly — no apology, no recap of what you were doing. ` +
              `Pick up mid-thought if that is where the cut happened. Break remaining work into smaller pieces.`,
            isMeta: true,
          })

          const next: State = {
            messages: [
              ...messagesForQuery,
              ...assistantMessages,
              recoveryMessage,
            ],
            toolUseContext,
            autoCompactTracking: tracking,
            maxOutputTokensRecoveryCount: maxOutputTokensRecoveryCount + 1,
            hasAttemptedReactiveCompact,
            maxOutputTokensOverride: undefined,
            pendingToolUseSummary: undefined,
            stopHookActive: undefined,
            turnCount,
            transition: {
              reason: 'max_output_tokens_recovery',
              attempt: maxOutputTokensRecoveryCount + 1,
            },
          }
          state = next
          continue
        }

        // Recovery exhausted — surface the withheld error now.
        yield lastMessage
      }

      // Skip stop hooks when the last message is an API error (rate limit,
      // prompt-too-long, auth failure, etc.). The model never produced a
      // real response — hooks evaluating it create a death spiral:
      // error → hook blocking → retry → error → …
      if (lastMessage?.isApiErrorMessage) {
        void executeStopFailureHooks(lastMessage, toolUseContext)
        return { reason: 'completed' }
      }

      const stopHookResult = yield* handleStopHooks(
        messagesForQuery,
        assistantMessages,
        systemPrompt,
        userContext,
        systemContext,
        toolUseContext,
        querySource,
        stopHookActive,
      )

      if (stopHookResult.preventContinuation) {
        return { reason: 'stop_hook_prevented' }
      }

      if (stopHookResult.blockingErrors.length > 0) {
        const next: State = {
          messages: [
            ...messagesForQuery,
            ...assistantMessages,
            ...stopHookResult.blockingErrors,
          ],
          toolUseContext,
          autoCompactTracking: tracking,
          maxOutputTokensRecoveryCount: 0,
          // Preserve the reactive compact guard — if compact already ran and
          // couldn't recover from prompt-too-long, retrying after a stop-hook
          // blocking error will produce the same result. Resetting to false
          // here caused an infinite loop: compact → still too long → error →
          // stop hook blocking → compact → … burning thousands of API calls.
          hasAttemptedReactiveCompact,
          maxOutputTokensOverride: undefined,
          pendingToolUseSummary: undefined,
          stopHookActive: true,
          turnCount,
          transition: { reason: 'stop_hook_blocking' },
        }
        state = next
        continue
      }

      if (feature('TOKEN_BUDGET')) {
        const decision = checkTokenBudget(
          budgetTracker!,
          toolUseContext.agentId,
          getCurrentTurnTokenBudget(),
          getTurnOutputTokens(),
        )

        if (decision.action === 'continue') {
          incrementBudgetContinuationCount()
          logForDebugging(
            `Token budget continuation #${decision.continuationCount}: ${decision.pct}% (${decision.turnTokens.toLocaleString()} / ${decision.budget.toLocaleString()})`,
          )
          state = {
            messages: [
              ...messagesForQuery,
              ...assistantMessages,
              createUserMessage({
                content: decision.nudgeMessage,
                isMeta: true,
              }),
            ],
            toolUseContext,
            autoCompactTracking: tracking,
            maxOutputTokensRecoveryCount: 0,
            hasAttemptedReactiveCompact: false,
            maxOutputTokensOverride: undefined,
            pendingToolUseSummary: undefined,
            stopHookActive: undefined,
            turnCount,
            transition: { reason: 'token_budget_continuation' },
          }
          continue
        }

        if (decision.completionEvent) {
          if (decision.completionEvent.diminishingReturns) {
            logForDebugging(
              `Token budget early stop: diminishing returns at ${decision.completionEvent.pct}%`,
            )
          }
          logEvent('tengu_token_budget_completed', {
            ...decision.completionEvent,
            queryChainId: queryChainIdForAnalytics,
            queryDepth: queryTracking.depth,
          })
        }
      }

      return { reason: 'completed' }
```

**File:** src/services/compact/microCompact.ts (L41-50)

```typescript
const COMPACTABLE_TOOLS = new Set<string>([
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

**File:** src/services/compact/microCompact.ts (L305-398)

```typescript
async function cachedMicrocompactPath(
  messages: Message[],
  querySource: QuerySource | undefined,
): Promise<MicrocompactResult> {
  const mod = await getCachedMCModule()
  const state = ensureCachedMCState()
  const config = mod.getCachedMCConfig()

  const compactableToolIds = new Set(collectCompactableToolIds(messages))
  // Second pass: register tool results grouped by user message
  for (const message of messages) {
    if (message.type === 'user' && Array.isArray(message.message.content)) {
      const groupIds: string[] = []
      for (const block of message.message.content) {
        if (
          block.type === 'tool_result' &&
          compactableToolIds.has(block.tool_use_id) &&
          !state.registeredTools.has(block.tool_use_id)
        ) {
          mod.registerToolResult(state, block.tool_use_id)
          groupIds.push(block.tool_use_id)
        }
      }
      mod.registerToolMessage(state, groupIds)
    }
  }

  const toolsToDelete = mod.getToolResultsToDelete(state)

  if (toolsToDelete.length > 0) {
    // Create and queue the cache_edits block for the API layer
    const cacheEdits = mod.createCacheEditsBlock(state, toolsToDelete)
    if (cacheEdits) {
      pendingCacheEdits = cacheEdits
    }

    logForDebugging(
      `Cached MC deleting ${toolsToDelete.length} tool(s): ${toolsToDelete.join(', ')}`,
    )

    // Log the event
    logEvent('tengu_cached_microcompact', {
      toolsDeleted: toolsToDelete.length,
      deletedToolIds: toolsToDelete.join(
        ',',
      ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      activeToolCount: state.toolOrder.length - state.deletedRefs.size,
      triggerType:
        'auto' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      threshold: config.triggerThreshold,
      keepRecent: config.keepRecent,
    })

    // Suppress warning after successful compaction
    suppressCompactWarning()

    // Notify cache break detection that cache reads will legitimately drop
    if (feature('PROMPT_CACHE_BREAK_DETECTION')) {
      // Pass the actual querySource — isMainThreadSource now prefix-matches
      // so output-style variants enter here, and getTrackingKey keys on the
      // full source string, not the 'repl_main_thread' prefix.
      notifyCacheDeletion(querySource ?? 'repl_main_thread')
    }

    // Return messages unchanged - cache_reference and cache_edits are added at API layer
    // Boundary message is deferred until after API response so we can use
    // actual cache_deleted_input_tokens from the API instead of client-side estimates
    // Capture the baseline cumulative cache_deleted_input_tokens from the last
    // assistant message so we can compute a per-operation delta after the API call
    const lastAsst = messages.findLast(m => m.type === 'assistant')
    const baseline =
      lastAsst?.type === 'assistant'
        ? ((
            lastAsst.message.usage as unknown as Record<
              string,
              number | undefined
            >
          )?.cache_deleted_input_tokens ?? 0)
        : 0

    return {
      messages,
      compactionInfo: {
        pendingCacheEdits: {
          trigger: 'auto',
          deletedToolIds: toolsToDelete,
          baselineCacheDeletedTokens: baseline,
        },
      },
    }
  }

  // No compaction needed, return messages unchanged
  return { messages }
```

**File:** src/services/compact/microCompact.ts (L446-529)

```typescript
function maybeTimeBasedMicrocompact(
  messages: Message[],
  querySource: QuerySource | undefined,
): MicrocompactResult | null {
  const trigger = evaluateTimeBasedTrigger(messages, querySource)
  if (!trigger) {
    return null
  }
  const { gapMinutes, config } = trigger

  const compactableIds = collectCompactableToolIds(messages)

  // Floor at 1: slice(-0) returns the full array (paradoxically keeps
  // everything), and clearing ALL results leaves the model with zero working
  // context. Neither degenerate is sensible — always keep at least the last.
  const keepRecent = Math.max(1, config.keepRecent)
  const keepSet = new Set(compactableIds.slice(-keepRecent))
  const clearSet = new Set(compactableIds.filter(id => !keepSet.has(id)))

  if (clearSet.size === 0) {
    return null
  }

  let tokensSaved = 0
  const result: Message[] = messages.map(message => {
    if (message.type !== 'user' || !Array.isArray(message.message.content)) {
      return message
    }
    let touched = false
    const newContent = message.message.content.map(block => {
      if (
        block.type === 'tool_result' &&
        clearSet.has(block.tool_use_id) &&
        block.content !== TIME_BASED_MC_CLEARED_MESSAGE
      ) {
        tokensSaved += calculateToolResultTokens(block)
        touched = true
        return { ...block, content: TIME_BASED_MC_CLEARED_MESSAGE }
      }
      return block
    })
    if (!touched) return message
    return {
      ...message,
      message: { ...message.message, content: newContent },
    }
  })

  if (tokensSaved === 0) {
    return null
  }

  logEvent('tengu_time_based_microcompact', {
    gapMinutes: Math.round(gapMinutes),
    gapThresholdMinutes: config.gapThresholdMinutes,
    toolsCleared: clearSet.size,
    toolsKept: keepSet.size,
    keepRecent: config.keepRecent,
    tokensSaved,
  })

  logForDebugging(
    `[TIME-BASED MC] gap ${Math.round(gapMinutes)}min > ${config.gapThresholdMinutes}min, cleared ${clearSet.size} tool results (~${tokensSaved} tokens), kept last ${keepSet.size}`,
  )

  suppressCompactWarning()
  // Cached-MC state (module-level) holds tool IDs registered on prior turns.
  // We just content-cleared some of those tools AND invalidated the server
  // cache by changing prompt content. If cached-MC runs next turn with the
  // stale state, it would try to cache_edit tools whose server-side entries
  // no longer exist. Reset it.
  resetMicrocompactState()
  // We just changed the prompt content — the next response's cache read will
  // be low, but that's us, not a break. Tell the detector to expect a drop.
  // notifyCacheDeletion (not notifyCompaction) because it's already imported
  // here and achieves the same false-positive suppression — adding the second
  // symbol to the import was flagged by the circular-deps check.
  // Pass the actual querySource: getTrackingKey returns the full source string
  // (e.g. 'repl_main_thread:outputStyle:custom'), not just the prefix.
  if (feature('PROMPT_CACHE_BREAK_DETECTION') && querySource) {
    notifyCacheDeletion(querySource)
  }

  return { messages: result }
```

**File:** src/constants/toolLimits.ts (L36-49)

```typescript
 * Default maximum aggregate size in characters for tool_result blocks within
 * a SINGLE user message (one turn's batch of parallel tool results). When a
 * message's blocks together exceed this, the largest blocks in that message
 * are persisted to disk and replaced with previews until under budget.
 * Messages are evaluated independently — a 150K result in one turn and a
 * 150K result in the next are both untouched.
 *
 * This prevents N parallel tools from each hitting the per-tool max and
 * collectively producing e.g. 10 × 40K = 400K in one turn's user message.
 *
 * Overridable at runtime via GrowthBook flag tengu_hawthorn_window — see
 * getPerMessageBudgetLimit() in toolResultStorage.ts.
 */
export const MAX_TOOL_RESULTS_PER_MESSAGE_CHARS = 200_000
```

**File:** src/utils/toolResultStorage.ts (L641-667)

```typescript
/**
 * Partition candidates by their prior decision state:
 *  - mustReapply: previously replaced → re-apply the cached replacement for
 *    prefix stability
 *  - frozen: previously seen and left unreplaced → off-limits (replacing
 *    now would change a prefix that was already cached)
 *  - fresh: never seen → eligible for new replacement decisions
 */
function partitionByPriorDecision(
    candidates: ToolResultCandidate[],
    state: ContentReplacementState
): CandidatePartition {
    return candidates.reduce<CandidatePartition>(
        (acc, c) => {
            const replacement = state.replacements.get(c.toolUseId)
            if (replacement !== undefined) {
                acc.mustReapply.push({ ...c, replacement })
            } else if (state.seenIds.has(c.toolUseId)) {
                acc.frozen.push(c)
            } else {
                acc.fresh.push(c)
            }
            return acc
        },
        { mustReapply: [], frozen: [], fresh: [] }
    )
}
```

**File:** src/utils/toolResultStorage.ts (L669-675)

```typescript
/**
 * Pick the largest fresh results to replace until the model-visible total
 * (frozen + remaining fresh) is at or under budget, or fresh is exhausted.
 * If frozen results alone exceed budget we accept the overage — microcompact
 * will eventually clear them.
 */
function selectFreshToReplace(
```

**File:** src/query/tokenBudget.ts (L1-4)

```typescript
import { getBudgetContinuationMessage } from '../utils/tokenBudget.js'

const COMPLETION_THRESHOLD = 0.9
const DIMINISHING_THRESHOLD = 500
```

**File:** src/query/tokenBudget.ts (L59-62)

```typescript
const isDiminishing =
    tracker.continuationCount >= 3 &&
    deltaSinceLastCheck < DIMINISHING_THRESHOLD &&
    tracker.lastDeltaTokens < DIMINISHING_THRESHOLD
```

**File:** src/utils/tokenBudget.ts (L66-73)

```typescript
export function getBudgetContinuationMessage(
    pct: number,
    turnTokens: number,
    budget: number
): string {
    const fmt = (n: number): string => new Intl.NumberFormat('en-US').format(n)
    return `Stopped at ${pct}% of token target (${fmt(turnTokens)} / ${fmt(
        budget
    )}). Keep working \u2014 do not summarize.`
}
```

**File:** src/query/stopHooks.ts (L65-80)

```typescript
export async function* handleStopHooks(
  messagesForQuery: Message[],
  assistantMessages: AssistantMessage[],
  systemPrompt: SystemPrompt,
  userContext: { [k: string]: string },
  systemContext: { [k: string]: string },
  toolUseContext: ToolUseContext,
  querySource: QuerySource,
  stopHookActive?: boolean,
): AsyncGenerator<
  | StreamEvent
  | RequestStartEvent
  | Message
  | TombstoneMessage
  | ToolUseSummaryMessage,
  StopHookResult
```

**File:** src/query/stopHooks.ts (L257-267)

```typescript
if (result.blockingError) {
    const userMessage = createUserMessage({
        content: getStopHookMessage(result.blockingError),
        isMeta: true, // Hide from UI (shown in summary message instead)
    })
    blockingErrors.push(userMessage)
    yield userMessage
    hasOutput = true
    // Add to hookErrors so it appears in the summary
    hookErrors.push(result.blockingError.blockingError)
}
```

**File:** src/services/compact/autoCompact.ts (L28-91)

```typescript
// Reserve this many tokens for output during compaction
// Based on p99.99 of compact summary output being 17,387 tokens.
const MAX_OUTPUT_TOKENS_FOR_SUMMARY = 20_000

// Returns the context window size minus the max output tokens for the model
export function getEffectiveContextWindowSize(model: string): number {
    const reservedTokensForSummary = Math.min(
        getMaxOutputTokensForModel(model),
        MAX_OUTPUT_TOKENS_FOR_SUMMARY
    )
    let contextWindow = getContextWindowForModel(model, getSdkBetas())

    const autoCompactWindow = process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW
    if (autoCompactWindow) {
        const parsed = parseInt(autoCompactWindow, 10)
        if (!isNaN(parsed) && parsed > 0) {
            contextWindow = Math.min(contextWindow, parsed)
        }
    }

    return contextWindow - reservedTokensForSummary
}

export type AutoCompactTrackingState = {
    compacted: boolean
    turnCounter: number
    // Unique ID per turn
    turnId: string
    // Consecutive autocompact failures. Reset on success.
    // Used as a circuit breaker to stop retrying when the context is
    // irrecoverably over the limit (e.g., prompt_too_long).
    consecutiveFailures?: number
}

export const AUTOCOMPACT_BUFFER_TOKENS = 13_000
export const WARNING_THRESHOLD_BUFFER_TOKENS = 20_000
export const ERROR_THRESHOLD_BUFFER_TOKENS = 20_000
export const MANUAL_COMPACT_BUFFER_TOKENS = 3_000

// Stop trying autocompact after this many consecutive failures.
// BQ 2026-03-10: 1,279 sessions had 50+ consecutive failures (up to 3,272)
// in a single session, wasting ~250K API calls/day globally.
const MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3

export function getAutoCompactThreshold(model: string): number {
    const effectiveContextWindow = getEffectiveContextWindowSize(model)

    const autocompactThreshold =
        effectiveContextWindow - AUTOCOMPACT_BUFFER_TOKENS

    // Override for easier testing of autocompact
    const envPercent = process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE
    if (envPercent) {
        const parsed = parseFloat(envPercent)
        if (!isNaN(parsed) && parsed > 0 && parsed <= 100) {
            const percentageThreshold = Math.floor(
                effectiveContextWindow * (parsed / 100)
            )
            return Math.min(percentageThreshold, autocompactThreshold)
        }
    }

    return autocompactThreshold
}
```

**File:** src/services/compact/prompt.ts (L61-143)

```typescript
const BASE_COMPACT_PROMPT = `Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests and your previous actions.
This summary should be thorough in capturing technical details, code patterns, and architectural decisions that would be essential for continuing development work without losing context.

${DETAILED_ANALYSIS_INSTRUCTION_BASE}

Your summary should include the following sections:

1. Primary Request and Intent: Capture all of the user's explicit requests and intents in detail
2. Key Technical Concepts: List all important technical concepts, technologies, and frameworks discussed.
3. Files and Code Sections: Enumerate specific files and code sections examined, modified, or created. Pay special attention to the most recent messages and include full code snippets where applicable and include a summary of why this file read or edit is important.
4. Errors and fixes: List all errors that you ran into, and how you fixed them. Pay special attention to specific user feedback that you received, especially if the user told you to do something differently.
5. Problem Solving: Document problems solved and any ongoing troubleshooting efforts.
6. All user messages: List ALL user messages that are not tool results. These are critical for understanding the users' feedback and changing intent.
7. Pending Tasks: Outline any pending tasks that you have explicitly been asked to work on.
8. Current Work: Describe in detail precisely what was being worked on immediately before this summary request, paying special attention to the most recent messages from both user and assistant. Include file names and code snippets where applicable.
9. Optional Next Step: List the next step that you will take that is related to the most recent work you were doing. IMPORTANT: ensure that this step is DIRECTLY in line with the user's most recent explicit requests, and the task you were working on immediately before this summary request. If your last task was concluded, then only list next steps if they are explicitly in line with the users request. Do not start on tangential requests or really old requests that were already completed without confirming with the user first.
                       If there is a next step, include direct quotes from the most recent conversation showing exactly what task you were working on and where you left off. This should be verbatim to ensure there's no drift in task interpretation.

Here's an example of how your output should be structured:

<example>
<analysis>
[Your thought process, ensuring all points are covered thoroughly and accurately]
</analysis>

<summary>
1. Primary Request and Intent:
   [Detailed description]

2. Key Technical Concepts:
   - [Concept 1]
   - [Concept 2]
   - [...]

3. Files and Code Sections:
   - [File Name 1]
      - [Summary of why this file is important]
      - [Summary of the changes made to this file, if any]
      - [Important Code Snippet]
   - [File Name 2]
      - [Important Code Snippet]
   - [...]

4. Errors and fixes:
    - [Detailed description of error 1]:
      - [How you fixed the error]
      - [User feedback on the error if any]
    - [...]

5. Problem Solving:
   [Description of solved problems and ongoing troubleshooting]

6. All user messages: 
    - [Detailed non tool use user message]
    - [...]

7. Pending Tasks:
   - [Task 1]
   - [Task 2]
   - [...]

8. Current Work:
   [Precise description of current work]

9. Optional Next Step:
   [Optional Next step to take]

</summary>
</example>

Please provide your summary based on the conversation so far, following this structure and ensuring precision and thoroughness in your response. 

There may be additional summarization instructions provided in the included context. If so, remember to follow these instructions when creating the above summary. Examples of instructions include:
<example>
## Compact Instructions
When summarizing the conversation focus on typescript code changes and also remember the mistakes you made and how you fixed them.
</example>

<example>
# Summary instructions
When you are using compact - please focus on test output and code changes. Include file reads verbatim.
</example>
`
```

**File:** src/services/compact/compact.ts (L1292-1306)

```typescript
      const streamingGen = queryModelWithStreaming({
        messages: normalizeMessagesForAPI(
          stripImagesFromMessages(
            stripReinjectedAttachments([
              ...getMessagesAfterCompactBoundary(messages),
              summaryRequest,
            ]),
          ),
          context.options.tools,
        ),
        systemPrompt: asSystemPrompt([
          'You are a helpful AI assistant tasked with summarizing conversations.',
        ]),
        thinkingConfig: { type: 'disabled' as const },
        tools,
```

**File:** src/utils/messages.ts (L4530-4554)

```typescript
export function createCompactBoundaryMessage(
  trigger: 'manual' | 'auto',
  preTokens: number,
  lastPreCompactMessageUuid?: UUID,
  userContext?: string,
  messagesSummarized?: number,
): SystemCompactBoundaryMessage {
  return {
    type: 'system',
    subtype: 'compact_boundary',
    content: `Conversation compacted`,
    isMeta: false,
    timestamp: new Date().toISOString(),
    uuid: randomUUID(),
    level: 'info',
    compactMetadata: {
      trigger,
      preTokens,
      userContext,
      messagesSummarized,
    },
    ...(lastPreCompactMessageUuid && {
      logicalParentUuid: lastPreCompactMessageUuid,
    }),
  }
```

**File:** src/utils/messages.ts (L4643-4656)

```typescript
export function getMessagesAfterCompactBoundary<
    T extends Message | NormalizedMessage
>(messages: T[], options?: { includeSnipped?: boolean }): T[] {
    const boundaryIndex = findLastCompactBoundaryIndex(messages)
    const sliced =
        boundaryIndex === -1 ? messages : messages.slice(boundaryIndex)
    if (!options?.includeSnipped && feature('HISTORY_SNIP')) {
        /* eslint-disable @typescript-eslint/no-require-imports */
        const { projectSnippedView } =
            require('../services/compact/snipProjection.js') as typeof import('../services/compact/snipProjection.js')
        /* eslint-enable @typescript-eslint/no-require-imports */
        return projectSnippedView(sliced as Message[]) as T[]
    }
    return sliced
}
```

**File:** src/utils/queryContext.ts (L44-74)

```typescript
export async function fetchSystemPromptParts({
    tools,
    mainLoopModel,
    additionalWorkingDirectories,
    mcpClients,
    customSystemPrompt,
}: {
    tools: Tools
    mainLoopModel: string
    additionalWorkingDirectories: string[]
    mcpClients: MCPServerConnection[]
    customSystemPrompt: string | undefined
}): Promise<{
    defaultSystemPrompt: string[]
    userContext: { [k: string]: string }
    systemContext: { [k: string]: string }
}> {
    const [defaultSystemPrompt, userContext, systemContext] = await Promise.all(
        [
            customSystemPrompt !== undefined
                ? Promise.resolve([])
                : getSystemPrompt(
                      tools,
                      mainLoopModel,
                      additionalWorkingDirectories,
                      mcpClients
                  ),
            getUserContext(),
            customSystemPrompt !== undefined
                ? Promise.resolve({})
                : getSystemContext(),
        ]
    )
    return { defaultSystemPrompt, userContext, systemContext }
}
```

**File:** src/constants/prompts.ts (L491-555)

```typescript
const dynamicSections = [
    systemPromptSection('session_guidance', () =>
        getSessionSpecificGuidanceSection(enabledTools, skillToolCommands)
    ),
    systemPromptSection('memory', () => loadMemoryPrompt()),
    systemPromptSection('ant_model_override', () =>
        getAntModelOverrideSection()
    ),
    systemPromptSection('env_info_simple', () =>
        computeSimpleEnvInfo(model, additionalWorkingDirectories)
    ),
    systemPromptSection('language', () =>
        getLanguageSection(settings.language)
    ),
    systemPromptSection('output_style', () =>
        getOutputStyleSection(outputStyleConfig)
    ),
    // When delta enabled, instructions are announced via persisted
    // mcp_instructions_delta attachments (attachments.ts) instead of this
    // per-turn recompute, which busts the prompt cache on late MCP connect.
    // Gate check inside compute (not selecting between section variants)
    // so a mid-session gate flip doesn't read a stale cached value.
    DANGEROUS_uncachedSystemPromptSection(
        'mcp_instructions',
        () =>
            isMcpInstructionsDeltaEnabled()
                ? null
                : getMcpInstructionsSection(mcpClients),
        'MCP servers connect/disconnect between turns'
    ),
    systemPromptSection('scratchpad', () => getScratchpadInstructions()),
    systemPromptSection('frc', () => getFunctionResultClearingSection(model)),
    systemPromptSection(
        'summarize_tool_results',
        () => SUMMARIZE_TOOL_RESULTS_SECTION
    ),
    // Numeric length anchors — research shows ~1.2% output token reduction vs
    // qualitative "be concise". Ant-only to measure quality impact first.
    ...(process.env.USER_TYPE === 'ant'
        ? [
              systemPromptSection(
                  'numeric_length_anchors',
                  () =>
                      'Length limits: keep text between tool calls to \u226425 words. Keep final responses to \u2264100 words unless the task requires more detail.'
              ),
          ]
        : []),
    ...(feature('TOKEN_BUDGET')
        ? [
              // Cached unconditionally — the "When the user specifies..." phrasing
              // makes it a no-op with no budget active. Was DANGEROUS_uncached
              // (toggled on getCurrentTurnTokenBudget()), busting ~20K tokens per
              // budget flip. Not moved to a tail attachment: first-response and
              // budget-continuation paths don't see attachments (#21577).
              systemPromptSection(
                  'token_budget',
                  () =>
                      'When the user specifies a token target (e.g., "+500k", "spend 2M tokens", "use 1B tokens"), your output token count will be shown each turn. Keep working until you approach the target \u2014 plan your work to fill it productively. The target is a hard minimum, not a suggestion. If you stop early, the system will automatically continue you.'
              ),
          ]
        : []),
    ...(feature('KAIROS') || feature('KAIROS_BRIEF')
        ? [systemPromptSection('brief', () => getBriefSection())]
        : []),
]
```

**File:** src/constants/systemPromptSections.ts (L1-68)

```typescript
import {
    clearBetaHeaderLatches,
    clearSystemPromptSectionState,
    getSystemPromptSectionCache,
    setSystemPromptSectionCacheEntry,
} from '../bootstrap/state.js'

type ComputeFn = () => string | null | Promise<string | null>

type SystemPromptSection = {
    name: string
    compute: ComputeFn
    cacheBreak: boolean
}

/**
 * Create a memoized system prompt section.
 * Computed once, cached until /clear or /compact.
 */
export function systemPromptSection(
    name: string,
    compute: ComputeFn
): SystemPromptSection {
    return { name, compute, cacheBreak: false }
}

/**
 * Create a volatile system prompt section that recomputes every turn.
 * This WILL break the prompt cache when the value changes.
 * Requires a reason explaining why cache-breaking is necessary.
 */
export function DANGEROUS_uncachedSystemPromptSection(
    name: string,
    compute: ComputeFn,
    _reason: string
): SystemPromptSection {
    return { name, compute, cacheBreak: true }
}

/**
 * Resolve all system prompt sections, returning prompt strings.
 */
export async function resolveSystemPromptSections(
    sections: SystemPromptSection[]
): Promise<(string | null)[]> {
    const cache = getSystemPromptSectionCache()

    return Promise.all(
        sections.map(async (s) => {
            if (!s.cacheBreak && cache.has(s.name)) {
                return cache.get(s.name) ?? null
            }
            const value = await s.compute()
            setSystemPromptSectionCacheEntry(s.name, value)
            return value
        })
    )
}

/**
 * Clear all system prompt section state. Called on /clear and /compact.
 * Also resets beta header latches so a fresh conversation gets fresh
 * evaluation of AFK/fast-mode/cache-editing headers.
 */
export function clearSystemPromptSections(): void {
    clearSystemPromptSectionState()
    clearBetaHeaderLatches()
}
```

**File:** src/context.ts (L29-34)

```typescript
export function setSystemPromptInjection(value: string | null): void {
    systemPromptInjection = value
    // Clear context caches immediately when injection changes
    getUserContext.cache.clear?.()
    getSystemContext.cache.clear?.()
}
```

**File:** src/context.ts (L116-189)

```typescript
export const getSystemContext = memoize(
    async (): Promise<{
        [k: string]: string
    }> => {
        const startTime = Date.now()
        logForDiagnosticsNoPII('info', 'system_context_started')

        // Skip git status in CCR (unnecessary overhead on resume) or when git instructions are disabled
        const gitStatus =
            isEnvTruthy(process.env.CLAUDE_CODE_REMOTE) ||
            !shouldIncludeGitInstructions()
                ? null
                : await getGitStatus()

        // Include system prompt injection if set (for cache breaking, ant-only)
        const injection = feature('BREAK_CACHE_COMMAND')
            ? getSystemPromptInjection()
            : null

        logForDiagnosticsNoPII('info', 'system_context_completed', {
            duration_ms: Date.now() - startTime,
            has_git_status: gitStatus !== null,
            has_injection: injection !== null,
        })

        return {
            ...(gitStatus && { gitStatus }),
            ...(feature('BREAK_CACHE_COMMAND') && injection
                ? {
                      cacheBreaker: `[CACHE_BREAKER: ${injection}]`,
                  }
                : {}),
        }
    }
)

/**
 * This context is prepended to each conversation, and cached for the duration of the conversation.
 */
export const getUserContext = memoize(
    async (): Promise<{
        [k: string]: string
    }> => {
        const startTime = Date.now()
        logForDiagnosticsNoPII('info', 'user_context_started')

        // CLAUDE_CODE_DISABLE_CLAUDE_MDS: hard off, always.
        // --bare: skip auto-discovery (cwd walk), BUT honor explicit --add-dir.
        // --bare means "skip what I didn't ask for", not "ignore what I asked for".
        const shouldDisableClaudeMd =
            isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS) ||
            (isBareMode() && getAdditionalDirectoriesForClaudeMd().length === 0)
        // Await the async I/O (readFile/readdir directory walk) so the event
        // loop yields naturally at the first fs.readFile.
        const claudeMd = shouldDisableClaudeMd
            ? null
            : getClaudeMds(filterInjectedMemoryFiles(await getMemoryFiles()))
        // Cache for the auto-mode classifier (yoloClassifier.ts reads this
        // instead of importing claudemd.ts directly, which would create a
        // cycle through permissions/filesystem → permissions → yoloClassifier).
        setCachedClaudeMdContent(claudeMd || null)

        logForDiagnosticsNoPII('info', 'user_context_completed', {
            duration_ms: Date.now() - startTime,
            claudemd_length: claudeMd?.length ?? 0,
            claudemd_disabled: Boolean(shouldDisableClaudeMd),
        })

        return {
            ...(claudeMd && { claudeMd }),
            currentDate: `Today's date is ${getLocalISODate()}.`,
        }
    }
)
```

**File:** src/commands/clear/caches.ts (L47-54)

```typescript
export function clearSessionCaches(
  preservedAgentIds: ReadonlySet<string> = new Set(),
): void {
  const hasPreserved = preservedAgentIds.size > 0
  // Clear context caches
  getUserContext.cache.clear?.()
  getSystemContext.cache.clear?.()
  getGitStatus.cache.clear?.()
```

**File:** src/utils/permissions/permissions.ts (L1158-1237)

```typescript
async function hasPermissionsToUseToolInner(
  tool: Tool,
  input: { [key: string]: unknown },
  context: ToolUseContext,
): Promise<PermissionDecision> {
  if (context.abortController.signal.aborted) {
    throw new AbortError()
  }

  let appState = context.getAppState()

  // 1. Check if the tool is denied
  // 1a. Entire tool is denied
  const denyRule = getDenyRuleForTool(appState.toolPermissionContext, tool)
  if (denyRule) {
    return {
      behavior: 'deny',
      decisionReason: {
        type: 'rule',
        rule: denyRule,
      },
      message: `Permission to use ${tool.name} has been denied.`,
    }
  }

  // 1b. Check if the entire tool should always ask for permission
  const askRule = getAskRuleForTool(appState.toolPermissionContext, tool)
  if (askRule) {
    // When autoAllowBashIfSandboxed is on, sandboxed commands skip the ask rule and
    // auto-allow via Bash's checkPermissions. Commands that won't be sandboxed (excluded
    // commands, dangerouslyDisableSandbox) still need to respect the ask rule.
    const canSandboxAutoAllow =
      tool.name === BASH_TOOL_NAME &&
      SandboxManager.isSandboxingEnabled() &&
      SandboxManager.isAutoAllowBashIfSandboxedEnabled() &&
      shouldUseSandbox(input)

    if (!canSandboxAutoAllow) {
      return {
        behavior: 'ask',
        decisionReason: {
          type: 'rule',
          rule: askRule,
        },
        message: createPermissionRequestMessage(tool.name),
      }
    }
    // Fall through to let Bash's checkPermissions handle command-specific rules
  }

  // 1c. Ask the tool implementation for a permission result
  // Overridden unless tool input schema is not valid
  let toolPermissionResult: PermissionResult = {
    behavior: 'passthrough',
    message: createPermissionRequestMessage(tool.name),
  }
  try {
    const parsedInput = tool.inputSchema.parse(input)
    toolPermissionResult = await tool.checkPermissions(parsedInput, context)
  } catch (e) {
    // Rethrow abort errors so they propagate properly
    if (e instanceof AbortError || e instanceof APIUserAbortError) {
      throw e
    }
    logError(e)
  }

  // 1d. Tool implementation denied permission
  if (toolPermissionResult?.behavior === 'deny') {
    return toolPermissionResult
  }

  // 1e. Tool requires user interaction even in bypass mode
  if (
    tool.requiresUserInteraction?.() &&
    toolPermissionResult?.behavior === 'ask'
  ) {
    return toolPermissionResult
  }

```

**File:** src/services/tools/toolOrchestration.ts (L1-83)

```typescript
import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import { findToolByName, type ToolUseContext } from '../../Tool.js'
import type { AssistantMessage, Message } from '../../types/message.js'
import { all } from '../../utils/generators.js'
import { type MessageUpdateLazy, runToolUse } from './toolExecution.js'

function getMaxToolUseConcurrency(): number {
    return (
        parseInt(process.env.CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY || '', 10) ||
        10
    )
}

export type MessageUpdate = {
    message?: Message
    newContext: ToolUseContext
}

export async function* runTools(
    toolUseMessages: ToolUseBlock[],
    assistantMessages: AssistantMessage[],
    canUseTool: CanUseToolFn,
    toolUseContext: ToolUseContext
): AsyncGenerator<MessageUpdate, void> {
    let currentContext = toolUseContext
    for (const { isConcurrencySafe, blocks } of partitionToolCalls(
        toolUseMessages,
        currentContext
    )) {
        if (isConcurrencySafe) {
            const queuedContextModifiers: Record<
                string,
                ((context: ToolUseContext) => ToolUseContext)[]
            > = {}
            // Run read-only batch concurrently
            for await (const update of runToolsConcurrently(
                blocks,
                assistantMessages,
                canUseTool,
                currentContext
            )) {
                if (update.contextModifier) {
                    const { toolUseID, modifyContext } = update.contextModifier
                    if (!queuedContextModifiers[toolUseID]) {
                        queuedContextModifiers[toolUseID] = []
                    }
                    queuedContextModifiers[toolUseID].push(modifyContext)
                }
                yield {
                    message: update.message,
                    newContext: currentContext,
                }
            }
            for (const block of blocks) {
                const modifiers = queuedContextModifiers[block.id]
                if (!modifiers) {
                    continue
                }
                for (const modifier of modifiers) {
                    currentContext = modifier(currentContext)
                }
            }
            yield { newContext: currentContext }
        } else {
            // Run non-read-only batch serially
            for await (const update of runToolsSerially(
                blocks,
                assistantMessages,
                canUseTool,
                currentContext
            )) {
                if (update.newContext) {
                    currentContext = update.newContext
                }
                yield {
                    message: update.message,
                    newContext: currentContext,
                }
            }
        }
    }
}
```

**File:** src/services/tools/StreamingToolExecutor.ts (L34-151)

```typescript
/**
 * Executes tools as they stream in with concurrency control.
 * - Concurrent-safe tools can execute in parallel with other concurrent-safe tools
 * - Non-concurrent tools must execute alone (exclusive access)
 * - Results are buffered and emitted in the order tools were received
 */
export class StreamingToolExecutor {
  private tools: TrackedTool[] = []
  private toolUseContext: ToolUseContext
  private hasErrored = false
  private erroredToolDescription = ''
  // Child of toolUseContext.abortController. Fires when a Bash tool errors
  // so sibling subprocesses die immediately instead of running to completion.
  // Aborting this does NOT abort the parent — query.ts won't end the turn.
  private siblingAbortController: AbortController
  private discarded = false
  // Signal to wake up getRemainingResults when progress is available
  private progressAvailableResolve?: () => void

  constructor(
    private readonly toolDefinitions: Tools,
    private readonly canUseTool: CanUseToolFn,
    toolUseContext: ToolUseContext,
  ) {
    this.toolUseContext = toolUseContext
    this.siblingAbortController = createChildAbortController(
      toolUseContext.abortController,
    )
  }

  /**
   * Discards all pending and in-progress tools. Called when streaming fallback
   * occurs and results from the failed attempt should be abandoned.
   * Queued tools won't start, and in-progress tools will receive synthetic errors.
   */
  discard(): void {
    this.discarded = true
  }

  /**
   * Add a tool to the execution queue. Will start executing immediately if conditions allow.
   */
  addTool(block: ToolUseBlock, assistantMessage: AssistantMessage): void {
    const toolDefinition = findToolByName(this.toolDefinitions, block.name)
    if (!toolDefinition) {
      this.tools.push({
        id: block.id,
        block,
        assistantMessage,
        status: 'completed',
        isConcurrencySafe: true,
        pendingProgress: [],
        results: [
          createUserMessage({
            content: [
              {
                type: 'tool_result',
                content: `<tool_use_error>Error: No such tool available: ${block.name}</tool_use_error>`,
                is_error: true,
                tool_use_id: block.id,
              },
            ],
            toolUseResult: `Error: No such tool available: ${block.name}`,
            sourceToolAssistantUUID: assistantMessage.uuid,
          }),
        ],
      })
      return
    }

    const parsedInput = toolDefinition.inputSchema.safeParse(block.input)
    const isConcurrencySafe = parsedInput?.success
      ? (() => {
          try {
            return Boolean(toolDefinition.isConcurrencySafe(parsedInput.data))
          } catch {
            return false
          }
        })()
      : false
    this.tools.push({
      id: block.id,
      block,
      assistantMessage,
      status: 'queued',
      isConcurrencySafe,
      pendingProgress: [],
    })

    void this.processQueue()
  }

  /**
   * Check if a tool can execute based on current concurrency state
   */
  private canExecuteTool(isConcurrencySafe: boolean): boolean {
    const executingTools = this.tools.filter(t => t.status === 'executing')
    return (
      executingTools.length === 0 ||
      (isConcurrencySafe && executingTools.every(t => t.isConcurrencySafe))
    )
  }

  /**
   * Process the queue, starting tools when concurrency conditions allow
   */
  private async processQueue(): Promise<void> {
    for (const tool of this.tools) {
      if (tool.status !== 'queued') continue

      if (this.canExecuteTool(tool.isConcurrencySafe)) {
        await this.executeTool(tool)
      } else {
        // Can't execute this tool yet, and since we need to maintain order for non-concurrent tools, stop here
        if (!tool.isConcurrencySafe) break
      }
    }
  }
```

**File:** src/services/tools/StreamingToolExecutor.ts (L153-205)

```typescript
  private createSyntheticErrorMessage(
    toolUseId: string,
    reason: 'sibling_error' | 'user_interrupted' | 'streaming_fallback',
    assistantMessage: AssistantMessage,
  ): Message {
    // For user interruptions (ESC to reject), use REJECT_MESSAGE so the UI shows
    // "User rejected edit" instead of "Error editing file"
    if (reason === 'user_interrupted') {
      return createUserMessage({
        content: [
          {
            type: 'tool_result',
            content: withMemoryCorrectionHint(REJECT_MESSAGE),
            is_error: true,
            tool_use_id: toolUseId,
          },
        ],
        toolUseResult: 'User rejected tool use',
        sourceToolAssistantUUID: assistantMessage.uuid,
      })
    }
    if (reason === 'streaming_fallback') {
      return createUserMessage({
        content: [
          {
            type: 'tool_result',
            content:
              '<tool_use_error>Error: Streaming fallback - tool execution discarded</tool_use_error>',
            is_error: true,
            tool_use_id: toolUseId,
          },
        ],
        toolUseResult: 'Streaming fallback - tool execution discarded',
        sourceToolAssistantUUID: assistantMessage.uuid,
      })
    }
    const desc = this.erroredToolDescription
    const msg = desc
      ? `Cancelled: parallel tool call ${desc} errored`
      : 'Cancelled: parallel tool call errored'
    return createUserMessage({
      content: [
        {
          type: 'tool_result',
          content: `<tool_use_error>${msg}</tool_use_error>`,
          is_error: true,
          tool_use_id: toolUseId,
        },
      ],
      toolUseResult: msg,
      sourceToolAssistantUUID: assistantMessage.uuid,
    })
  }
```

**File:** src/utils/generators.ts (L32-72)

```typescript
export async function* all<A>(
    generators: AsyncGenerator<A, void>[],
    concurrencyCap = Infinity
): AsyncGenerator<A, void> {
    const next = (generator: AsyncGenerator<A, void>) => {
        const promise: Promise<QueuedGenerator<A>> = generator
            .next()
            .then(({ done, value }) => ({
                done,
                value,
                generator,
                promise,
            }))
        return promise
    }
    const waiting = [...generators]
    const promises = new Set<Promise<QueuedGenerator<A>>>()

    // Start initial batch up to concurrency cap
    while (promises.size < concurrencyCap && waiting.length > 0) {
        const gen = waiting.shift()!
        promises.add(next(gen))
    }

    while (promises.size > 0) {
        const { done, value, generator, promise } = await Promise.race(promises)
        promises.delete(promise)

        if (!done) {
            promises.add(next(generator))
            // TODO: Clean this up
            if (value !== undefined) {
                yield value
            }
        } else if (waiting.length > 0) {
            // Start a new generator when one finishes
            const nextGen = waiting.shift()!
            promises.add(next(nextGen))
        }
    }
}
```

**File:** src/tools.ts (L345-367)

```typescript
export function assembleToolPool(
    permissionContext: ToolPermissionContext,
    mcpTools: Tools
): Tools {
    const builtInTools = getTools(permissionContext)

    // Filter out MCP tools that are in the deny list
    const allowedMcpTools = filterToolsByDenyRules(mcpTools, permissionContext)

    // Sort each partition for prompt-cache stability, keeping built-ins as a
    // contiguous prefix. The server's claude_code_system_cache_policy places a
    // global cache breakpoint after the last prefix-matched built-in tool; a flat
    // sort would interleave MCP tools into built-ins and invalidate all downstream
    // cache keys whenever an MCP tool sorts between existing built-ins. uniqBy
    // preserves insertion order, so built-ins win on name conflict.
    // Avoid Array.toSorted (Node 20+) — we support Node 18. builtInTools is
    // readonly so copy-then-sort; allowedMcpTools is a fresh .filter() result.
    const byName = (a: Tool, b: Tool) => a.name.localeCompare(b.name)
    return uniqBy(
        [...builtInTools].sort(byName).concat(allowedMcpTools.sort(byName)),
        'name'
    )
}
```

**File:** src/tools/FileWriteTool/FileWriteTool.ts (L211-219)

```typescript
const lastWriteTime = Math.floor(fileMtimeMs)
if (lastWriteTime > readTimestamp.timestamp) {
    return {
        result: false,
        message:
            'File has been modified since read, either by the user or by a linter. Read it again before attempting to write it.',
        errorCode: 3,
    }
}
```

**File:** src/tools/FileEditTool/FileEditTool.ts (L442-491)

```typescript
// 2. Load current state and confirm no changes since last read
// Please avoid async operations between here and writing to disk to preserve atomicity
const {
    content: originalFileContents,
    fileExists,
    encoding,
    lineEndings: endings,
} = readFileForEdit(absoluteFilePath)

if (fileExists) {
    const lastWriteTime = getFileModificationTime(absoluteFilePath)
    const lastRead = readFileState.get(absoluteFilePath)
    if (!lastRead || lastWriteTime > lastRead.timestamp) {
        // Timestamp indicates modification, but on Windows timestamps can change
        // without content changes (cloud sync, antivirus, etc.). For full reads,
        // compare content as a fallback to avoid false positives.
        const isFullRead =
            lastRead &&
            lastRead.offset === undefined &&
            lastRead.limit === undefined
        const contentUnchanged =
            isFullRead && originalFileContents === lastRead.content
        if (!contentUnchanged) {
            throw new Error(FILE_UNEXPECTEDLY_MODIFIED_ERROR)
        }
    }
}

// 3. Use findActualString to handle quote normalization
const actualOldString =
    findActualString(originalFileContents, old_string) || old_string

// Preserve curly quotes in new_string when the file uses them
const actualNewString = preserveQuoteStyle(
    old_string,
    actualOldString,
    new_string
)

// 4. Generate patch
const { patch, updatedFile } = getPatchForEdit({
    filePath: absoluteFilePath,
    fileContents: originalFileContents,
    oldString: actualOldString,
    newString: actualNewString,
    replaceAll: replace_all,
})

// 5. Write to disk
writeTextContent(absoluteFilePath, updatedFile, encoding, endings)
```

**File:** src/services/api/claude.ts (L1154-1167)

```typescript
  if (useToolSearch) {
    // Dynamic tool loading: Only include deferred tools that have been discovered
    // via tool_reference blocks in the message history. This eliminates the need
    // to predeclare all deferred tools upfront and removes limits on tool quantity.
    const discoveredToolNames = extractDiscoveredToolNames(messages)

    filteredTools = tools.filter(tool => {
      // Always include non-deferred tools
      if (!deferredToolNames.has(tool.name)) return true
      // Always include ToolSearchTool (so it can discover more tools)
      if (toolMatchesName(tool, TOOL_SEARCH_TOOL_NAME)) return true
      // Only include deferred tools that have been discovered
      return discoveredToolNames.has(tool.name)
    })
```

**File:** src/tools/ToolSearchTool/ToolSearchTool.ts (L462-469)

```typescript
return {
    type: 'tool_result',
    tool_use_id: toolUseID,
    content: content.matches.map((name) => ({
        type: 'tool_reference' as const,
        tool_name: name,
    })),
} as unknown as ToolResultBlockParam
```

**File:** src/tools/AgentTool/AgentTool.tsx (L686-764)

```typescript
    if (shouldRunAsync) {
      const asyncAgentId = earlyAgentId;
      const agentBackgroundTask = registerAsyncAgent({
        agentId: asyncAgentId,
        description,
        prompt,
        selectedAgent,
        setAppState: rootSetAppState,
        // Don't link to parent's abort controller -- background agents should
        // survive when the user presses ESC to cancel the main thread.
        // They are killed explicitly via chat:killAgents.
        toolUseId: toolUseContext.toolUseId
      });

      // Register name → agentId for SendMessage routing. Post-registerAsyncAgent
      // so we don't leave a stale entry if spawn fails. Sync agents skipped —
      // coordinator is blocked, so SendMessage routing doesn't apply.
      if (name) {
        rootSetAppState(prev => {
          const next = new Map(prev.agentNameRegistry);
          next.set(name, asAgentId(asyncAgentId));
          return {
            ...prev,
            agentNameRegistry: next
          };
        });
      }

      // Wrap async agent execution in agent context for analytics attribution
      const asyncAgentContext = {
        agentId: asyncAgentId,
        // For subagents from teammates: use team lead's session
        // For subagents from main REPL: undefined (no parent session)
        parentSessionId: getParentSessionId(),
        agentType: 'subagent' as const,
        subagentName: selectedAgent.agentType,
        isBuiltIn: isBuiltInAgent(selectedAgent),
        invokingRequestId: assistantMessage?.requestId,
        invocationKind: 'spawn' as const,
        invocationEmitted: false
      };

      // Workload propagation: handlePromptSubmit wraps the entire turn in
      // runWithWorkload (AsyncLocalStorage). ALS context is captured at
      // invocation time — when this `void` fires — and survives every await
      // inside. No capture/restore needed; the detached closure sees the
      // parent turn's workload automatically, isolated from its finally.
      void runWithAgentContext(asyncAgentContext, () => wrapWithCwd(() => runAsyncAgentLifecycle({
        taskId: agentBackgroundTask.agentId,
        abortController: agentBackgroundTask.abortController!,
        makeStream: onCacheSafeParams => runAgent({
          ...runAgentParams,
          override: {
            ...runAgentParams.override,
            agentId: asAgentId(agentBackgroundTask.agentId),
            abortController: agentBackgroundTask.abortController!
          },
          onCacheSafeParams
        }),
        metadata,
        description,
        toolUseContext,
        rootSetAppState,
        agentIdForCleanup: asyncAgentId,
        enableSummarization: isCoordinator || isForkSubagentEnabled() || getSdkAgentProgressSummariesEnabled(),
        getWorktreeResult: cleanupWorktreeIfNeeded
      })));
      const canReadOutputFile = toolUseContext.options.tools.some(t => toolMatchesName(t, FILE_READ_TOOL_NAME) || toolMatchesName(t, BASH_TOOL_NAME));
      return {
        data: {
          isAsync: true as const,
          status: 'async_launched' as const,
          agentId: agentBackgroundTask.agentId,
          description: description,
          prompt: prompt,
          outputFile: getTaskOutputPath(agentBackgroundTask.agentId),
          canReadOutputFile
        }
      };
```

**File:** src/utils/mailbox.ts (L1-73)

```typescript
import { createSignal } from './signal.js'

export type MessageSource = 'user' | 'teammate' | 'system' | 'tick' | 'task'

export type Message = {
    id: string
    source: MessageSource
    content: string
    from?: string
    color?: string
    timestamp: string
}

type Waiter = {
    fn: (msg: Message) => boolean
    resolve: (msg: Message) => void
}

export class Mailbox {
    private queue: Message[] = []
    private waiters: Waiter[] = []
    private changed = createSignal()
    private _revision = 0

    get length(): number {
        return this.queue.length
    }

    get revision(): number {
        return this._revision
    }

    send(msg: Message): void {
        this._revision++
        const idx = this.waiters.findIndex((w) => w.fn(msg))
        if (idx !== -1) {
            const waiter = this.waiters.splice(idx, 1)[0]
            if (waiter) {
                waiter.resolve(msg)
                this.notify()
                return
            }
        }
        this.queue.push(msg)
        this.notify()
    }

    poll(fn: (msg: Message) => boolean = () => true): Message | undefined {
        const idx = this.queue.findIndex(fn)
        if (idx === -1) return undefined
        return this.queue.splice(idx, 1)[0]
    }

    receive(fn: (msg: Message) => boolean = () => true): Promise<Message> {
        const idx = this.queue.findIndex(fn)
        if (idx !== -1) {
            const msg = this.queue.splice(idx, 1)[0]
            if (msg) {
                this.notify()
                return Promise.resolve(msg)
            }
        }
        return new Promise<Message>((resolve) => {
            this.waiters.push({ fn, resolve })
        })
    }

    subscribe = this.changed.subscribe

    private notify(): void {
        this.changed.emit()
    }
}
```

**File:** src/utils/teammateMailbox.ts (L1-66)

```typescript
/**
 * Teammate Mailbox - File-based messaging system for agent swarms
 *
 * Each teammate has an inbox file at .claude/teams/{team_name}/inboxes/{agent_name}.json
 * Other teammates can write messages to it, and the recipient sees them as attachments.
 *
 * Note: Inboxes are keyed by agent name within a team.
 */

import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { z } from 'zod/v4'
import { TEAMMATE_MESSAGE_TAG } from '../constants/xml.js'
import { PermissionModeSchema } from '../entrypoints/sdk/coreSchemas.js'
import { SEND_MESSAGE_TOOL_NAME } from '../tools/SendMessageTool/constants.js'
import type { Message } from '../types/message.js'
import { generateRequestId } from './agentId.js'
import { count } from './array.js'
import { logForDebugging } from './debug.js'
import { getTeamsDir } from './envUtils.js'
import { getErrnoCode } from './errors.js'
import { lazySchema } from './lazySchema.js'
import * as lockfile from './lockfile.js'
import { logError } from './log.js'
import { jsonParse, jsonStringify } from './slowOperations.js'
import type { BackendType } from './swarm/backends/types.js'
import { TEAM_LEAD_NAME } from './swarm/constants.js'
import { sanitizePathComponent } from './tasks.js'
import { getAgentName, getTeammateColor, getTeamName } from './teammate.js'

// Lock options: retry with backoff so concurrent callers (multiple Claudes
// in a swarm) wait for the lock instead of failing immediately. The sync
// lockSync API blocked the event loop; the async API needs explicit retries
// to achieve the same serialization semantics.
const LOCK_OPTIONS = {
    retries: {
        retries: 10,
        minTimeout: 5,
        maxTimeout: 100,
    },
}

export type TeammateMessage = {
    from: string
    text: string
    timestamp: string
    read: boolean
    color?: string // Sender's assigned color (e.g., 'red', 'blue', 'green')
    summary?: string // 5-10 word summary shown as preview in the UI
}

/**
 * Get the path to a teammate's inbox file
 * Structure: ~/.claude/teams/{team_name}/inboxes/{agent_name}.json
 */
export function getInboxPath(agentName: string, teamName?: string): string {
    const team = teamName || getTeamName() || 'default'
    const safeTeam = sanitizePathComponent(team)
    const safeAgentName = sanitizePathComponent(agentName)
    const inboxDir = join(getTeamsDir(), safeTeam, 'inboxes')
    const fullPath = join(inboxDir, `${safeAgentName}.json`)
    logForDebugging(
        `[TeammateMailbox] getInboxPath: agent=${agentName}, team=${team}, fullPath=${fullPath}`
    )
    return fullPath
}
```

**File:** src/utils/teammateMailbox.ts (L134-192)

```typescript
export async function writeToMailbox(
    recipientName: string,
    message: Omit<TeammateMessage, 'read'>,
    teamName?: string
): Promise<void> {
    await ensureInboxDir(teamName)

    const inboxPath = getInboxPath(recipientName, teamName)
    const lockFilePath = `${inboxPath}.lock`

    logForDebugging(
        `[TeammateMailbox] writeToMailbox: recipient=${recipientName}, from=${message.from}, path=${inboxPath}`
    )

    // Ensure the inbox file exists before locking (proper-lockfile requires the file to exist)
    try {
        await writeFile(inboxPath, '[]', { encoding: 'utf-8', flag: 'wx' })
        logForDebugging(
            `[TeammateMailbox] writeToMailbox: created new inbox file`
        )
    } catch (error) {
        const code = getErrnoCode(error)
        if (code !== 'EEXIST') {
            logForDebugging(
                `[TeammateMailbox] writeToMailbox: failed to create inbox file: ${error}`
            )
            logError(error)
            return
        }
    }

    let release: (() => Promise<void>) | undefined
    try {
        release = await lockfile.lock(inboxPath, {
            lockfilePath: lockFilePath,
            ...LOCK_OPTIONS,
        })

        // Re-read messages after acquiring lock to get the latest state
        const messages = await readMailbox(recipientName, teamName)

        const newMessage: TeammateMessage = {
            ...message,
            read: false,
        }

        messages.push(newMessage)

        await writeFile(inboxPath, jsonStringify(messages, null, 2), 'utf-8')
        logForDebugging(
            `[TeammateMailbox] Wrote message to ${recipientName}'s inbox from ${message.from}`
        )
    } catch (error) {
        logForDebugging(
            `Failed to write to inbox for ${recipientName}: ${error}`
        )
        logError(error)
    } finally {
        if (release) {
            await release()
        }
    }
}
```

**File:** src/tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts (L264-312)

```typescript
    if (isTeammate() && isPlanModeRequired()) {
      // Plan is required for plan_mode_required teammates
      if (!plan) {
        throw new Error(
          `No plan file found at ${filePath}. Please write your plan to this file before calling ExitPlanMode.`,
        )
      }
      const agentName = getAgentName() || 'unknown'
      const teamName = getTeamName()
      const requestId = generateRequestId(
        'plan_approval',
        formatAgentId(agentName, teamName || 'default'),
      )

      const approvalRequest = {
        type: 'plan_approval_request',
        from: agentName,
        timestamp: new Date().toISOString(),
        planFilePath: filePath,
        planContent: plan,
        requestId,
      }

      await writeToMailbox(
        'team-lead',
        {
          from: agentName,
          text: jsonStringify(approvalRequest),
          timestamp: new Date().toISOString(),
        },
        teamName,
      )

      // Update task state to show awaiting approval (for in-process teammates)
      const appState = context.getAppState()
      const agentTaskId = findInProcessTeammateTaskId(agentName, appState)
      if (agentTaskId) {
        setAwaitingPlanApproval(agentTaskId, context.setAppState, true)
      }

      return {
        data: {
          plan,
          isAgent: true,
          filePath,
          awaitingLeaderApproval: true,
          requestId,
        },
      }
```

**File:** src/hooks/useSwarmPermissionPoller.ts (L28-28)

```typescript
const POLL_INTERVAL_MS = 500
```

**File:** src/hooks/toolPermission/handlers/swarmWorkerHandler.ts (L79-123)

```typescript
// Register callback BEFORE sending the request to avoid race condition
// where leader responds before callback is registered
registerPermissionCallback({
    requestId: request.id,
    toolUseId: ctx.toolUseID,
    async onAllow(
        allowedInput: Record<string, unknown> | undefined,
        permissionUpdates: PermissionUpdate[],
        feedback?: string,
        contentBlocks?: ContentBlockParam[]
    ) {
        if (!claim()) return // atomic check-and-mark before await
        clearPendingRequest()

        // Merge the updated input with the original input
        const finalInput =
            allowedInput && Object.keys(allowedInput).length > 0
                ? allowedInput
                : ctx.input

        resolveOnce(
            await ctx.handleUserAllow(
                finalInput,
                permissionUpdates,
                feedback,
                undefined,
                contentBlocks
            )
        )
    },
    onReject(feedback?: string, contentBlocks?: ContentBlockParam[]) {
        if (!claim()) return
        clearPendingRequest()

        ctx.logDecision({
            decision: 'reject',
            source: { type: 'user_reject', hasFeedback: !!feedback },
        })

        resolveOnce(ctx.cancelAndAbort(feedback, undefined, contentBlocks))
    },
})

// Now that callback is registered, send the request to the leader
void sendPermissionRequestViaMailbox(request)
```
