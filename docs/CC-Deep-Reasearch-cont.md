# DeepWiki Q&A with Code Context for Repository: zackautocracy/claude-code

## Q1

## Section 5 — Memory & Skills

21. Walk me through the exact 2-pass memory relevance algorithm in full.  
    What fields from frontmatter are used in pass 1 (the scan)? Give me
    the EXACT LLM prompt used in pass 2 (the selection call) — verbatim  
    from the source, not paraphrased. What JSON schema is used? What is  
    `alreadySurfaced` exactly — how is it typed, populated, and threaded  
    across turns? How does the freshness warning wrapper work — what  
    triggers it and what is the exact injected text?  

22. Walk me through `autoDream` (memory consolidation) end-to-end.  
    What are the exact 4-phase prompts (Orient, Gather, Consolidate,  
    Prune) — verbatim? How does it decide which memories to merge vs.  
    delete? What does the output look like — does it write new files,  
    edit existing ones, or both? What is the exact file-based mutex  
    implementation (lock file path, stale timeout, how it handles  
    contention)?  

23. How are bundled skills injected? Give me the exact extraction path  
    for the `files` field (nonce directory naming scheme, the exact  
    `open()` flags used for security). What prefix is prepended to the  
    skill prompt? How does `getSkillToolCommands()` expose skills as  
    model-callable tools — what does the generated tool schema look like,  
    and what happens when the model calls a skill-as-tool vs. a user  
    invokes it as a slash command? What is the `allowedTools` enforcement  
    mechanism during skill execution?  

24. How does the `effort` option (`low|medium|high|max`) actually map to  
    API parameters? Give me the exact code — is it an `extended_thinking`  
    budget field, a temperature change, a `thinking.budget_tokens` value,  
    a system prompt instruction, or something else entirely? Where in  
    the call chain is it applied? Does it affect subagents, or only the  
    top-level query?  


---

## Section 6 — Hooks & Observability

25. Walk me through the complete hook execution model. Are hooks spawned  
    as child processes, run in-process, or something else? What is the
    exact timeout per hook type (BashCommandHook, PromptHook, AgentHook,  
    HttpHook)? When a PromptHook or AgentHook produces output, exactly  
    how is that output injected back into the conversation — what message  
    type, role, and `isMeta` value? Give me the exact code path.  

26. How does `asyncRewake: true` work mechanically? When a background  
    bash hook exits with code 2, what process/signal/IPC mechanism  
    receives that exit code? What exactly gets re-queued — a message,  
    an event, a state mutation? Show me the exact handler code.  

27. What are the exact fields in the `PreToolUse` and `PostToolUse` hook  
    event payloads? Give me the TypeScript type definitions verbatim.  
    How does `PreToolUse` short-circuit tool execution — what does the  
    hook return to block the call, and what does the model receive as the  
    tool result when blocked? How are hook events exposed to SDK consumers  
    in the TypeScript SDK stream?  

28. How does cost tracking work at the API call level — exactly? Where  
    in the code is `usage.input_tokens` / `usage.output_tokens` read  
    from the response? How does it handle streaming (where usage arrives  
    at the end in `message_delta`)? How is prompt cache savings  
    calculated — is `cache_read_input_tokens` used, and what's the  
    discount rate applied?  


---

## Section 7 — Design Decisions

29. Why do two tool-calling code paths exist (native FC via `tool_use`  
    blocks, and text-based `ACTION:` parsing)? Is text-based actively
    maintained or dead code? What flag or condition determines which  
    path runs — show me the branch condition. Is there a migration plan  
    to remove text-based entirely?  

30. `react-kernel.ts` is ~1,961 LOC. List the distinct logical concerns  
    packed into it with approximate line ranges. If you were splitting  
    it into 3–5 files, what would each file be named and what would it  
    contain? Are there existing TODO/FIXME comments in the file pointing  
    at the seams?  

31. What was the rationale for the 4-layer settings system  
    (`managed > localProject > project > global`)? Give me a concrete  
    example of a bug or security problem that would occur if you  
    collapsed it to 2 layers (e.g., just `global + project`). What
    does the `managed` layer specifically protect against?  

32. Why does the tool permission system use string pattern matching  
    (`"Bash(git *)"`) rather than a structured rule type like  
    `{ tool: "Bash", args: { command: /^git/ } }`? What parser handles  
    the pattern syntax — is it a custom lexer, glob, minimatch, or  
    something else? What edge cases does the string form handle that a  
    structured type would not?  

33. `createResolveOnce` is used in the 5-way permission race. Give me  
    the exact implementation — is it a closure over a `resolved` boolean,  
    a `Promise` with a captured resolver, or something else? What  
    specific scenario caused it to be added — is there a git commit  
    message or comment that explains the race condition it was preventing?  

34. What is the exact algorithm for `detectCompletionGaps`? Show me  
    the function signature and implementation. What signals does it use —  
    tool call history (which tools were called), output content analysis,  
    iteration count, or something else? What is the threshold for  
    "complete enough"? How does this interact with `withMinIterations(n)`  
    and the `final-answer` meta-tool gate?  

35. BONUS: What is the `CONTEXT_COLLAPSE` feature? The query loop  
    references it in the 413 recovery path (`contextCollapse.recoverFromOverflow`).  
    How does it differ from microcompact and autocompact? What does  
    `recoverFromOverflow` do — what is a "staged collapse" and how are  
    collapses "drained"?  

36. BONUS: What does `pendingToolUseSummary` do in the loop State?  
    It's a `Promise<ToolUseSummaryMessage | null>` — when is it set,  
    when is it resolved, and what does a `ToolUseSummaryMessage` contain?  
    Is this related to the `StreamCompleted.toolSummary` in the SDK?

### Answer

This is a massive multi-part question covering many aspects of the claude-code codebase. Let me start by searching for the key concepts mentioned across all these questions in parallel. I need to be very efficient with my tool calls since I have limited iterations.

Let me start with broad searches for the most important concepts mentioned across all these questions.

This is an extremely large set of questions. Let me investigate the codebase systematically across all these topics.

I've gathered a lot of information. Let me now search for the remaining topics I haven't covered yet: react-kernel.ts, createResolveOnce, detectCompletionGaps, pendingToolUseSummary, the text-based ACTION parsing, permission pattern matching, settings layers, freshness warning, and the context collapse operations.

I've gathered extensive information across all the questions. Let me now compile comprehensive answers. I still need to check a few things - the `react-kernel.ts` file doesn't exist (glob returned empty), and I need to check for `detectCompletionGaps` and the text-based ACTION parsing. Let me also look for the `allowedTools` enforcement during skill execution and the SkillTool schema. Let me do a few more targeted searches.

I now have extensive information to answer these questions. Let me compile comprehensive answers for all of them. I should note that some concepts mentioned in the questions (like `react-kernel.ts`, `detectCompletionGaps`, `withMinIterations`, `final-answer` meta-tool, and text-based `ACTION:` parsing) do not exist in this codebase. Let me write up the answers.

Here are detailed answers to all questions. Due to the breadth, I'll address each numbered question in order.

---

## Section 5 — Memory & Skills

### 21. Memory Relevance Algorithm (2-Pass)

The memory relevance system is a 2-pass algorithm in `findRelevantMemories()`:

**Pass 1 (Scan):** `scanMemoryFiles()` reads the first 30 lines of each `.md` file (excluding `MEMORY.md`) in the memory directory, parses frontmatter, and extracts two fields: `description` and `type`. It returns `MemoryHeader` objects sorted newest-first, capped at 200 files. claude-code:13-19 claude-code:35-73

**Pass 2 (Selection):** `selectRelevantMemories()` calls a Sonnet sideQuery. The **exact system prompt** is:

````
You are selecting memories that will be useful to Claude Code as it processes a user's query. You will be given the user's query and a list of available memory files with their filenames and descriptions.

Return a list of filenames for the memories that will clearly be useful to Claude Code as it processes the user's query (up to 5). Only include memories that you are certain will be helpful based on their name and description.
- If you are unsure if a memory will be useful in processing the user's query, then do not include it in your list. Be selective and discerning.
- If there are no memories in the list that would clearly be useful, feel free to return an empty list.
- If a list of recently-used tools is provided, do not select memories that are usage reference or API documentation for those tools (Claude Code is already exercising them). DO still select memories containing warnings, gotchas, or known issues about those tools — active use is exactly when those matter.
``` claude-code:18-24

The **JSON schema** used:
```json
{
  "type": "object",
  "properties": {
    "selected_memories": { "type": "array", "items": { "type": "string" } }
  },
  "required": ["selected_memories"],
  "additionalProperties": false
}
``` claude-code:109-119

**`alreadySurfaced`** is typed as `ReadonlySet<string>` (a set of absolute file paths). It is populated by `collectSurfacedMemories()`, which scans all messages for `relevant_memories` attachments and collects their paths. It is threaded across turns by being computed from the message array at the start of each prefetch — since messages accumulate across turns, previously surfaced paths are naturally included. The selector filters them out *before* the Sonnet call so the 5-slot budget is spent on fresh candidates. claude-code:39-48 claude-code:2251-2266

**Freshness warning:** `memoryFreshnessText()` triggers for memories >1 day old (i.e., `memoryAgeDays(mtimeMs) > 1`). The exact injected text is:

````

This memory is ${d} days old. Memories are point-in-time observations, not live state — claims about code behavior or file:line citations may be outdated. Verify against current code before asserting as fact.

```

This is prepended to the memory header via `memoryHeader()`. For fresh memories (≤1 day), the header is just `Memory (saved ${age}): ${path}:`. claude-code:33-42 claude-code:2327-2332

---

### 22. autoDream (Memory Consolidation)

**End-to-end flow:**

1. `initAutoDream()` is called at startup from `startBackgroundHousekeeping()`. It creates a closure-scoped `runner` function. claude-code:122-125

2. **Gate order** (cheapest first): Time gate → Scan throttle → Session gate → Lock. claude-code:130-190

3. On passing all gates, it builds the consolidation prompt and runs a forked agent.

**The exact 4-phase prompt** (verbatim from `buildConsolidationPrompt()`):

```

# Dream: Memory Consolidation

You are performing a dream — a reflective pass over your memory files. Synthesize what you've learned recently into durable, well-organized memories so that future sessions can orient quickly.

Memory directory: `${memoryRoot}`
${DIR_EXISTS_GUIDANCE}

Session transcripts: `${transcriptDir}` (large JSONL files — grep narrowly, don't read whole files)

---

## Phase 1 — Orient

-   `ls` the memory directory to see what already exists
-   Read `${ENTRYPOINT_NAME}` to understand the current index
-   Skim existing topic files so you improve them rather than creating duplicates
-   If `logs/` or `sessions/` subdirectories exist (assistant-mode layout), review recent entries there

## Phase 2 — Gather recent signal

Look for new information worth persisting. Sources in rough priority order:

1. **Daily logs** (`logs/YYYY/MM/YYYY-MM-DD.md`) if present — these are the append-only stream
2. **Existing memories that drifted** — facts that contradict something you see in the codebase now
3. **Transcript search** — if you need specific context (e.g., "what was the error message from yesterday's build failure?"), grep the JSONL transcripts for narrow terms:
   `grep -rn "<narrow term>" ${transcriptDir}/ --include="*.jsonl" | tail -50`

Don't exhaustively read transcripts. Look only for things you already suspect matter.

## Phase 3 — Consolidate

For each thing worth remembering, write or update a memory file at the top level of the memory directory. Use the memory file format and type conventions from your system prompt's auto-memory section — it's the source of truth for what to save, how to structure it, and what NOT to save.

Focus on:

-   Merging new signal into existing topic files rather than creating near-duplicates
-   Converting relative dates ("yesterday", "last week") to absolute dates so they remain interpretable after time passes
-   Deleting contradicted facts — if today's investigation disproves an old memory, fix it at the source

## Phase 4 — Prune and index

Update `${ENTRYPOINT_NAME}` so it stays under ${MAX_ENTRYPOINT_LINES} lines AND under ~25KB. It's an **index**, not a dump — each entry should be one line under ~150 characters: `- [Title](file.md) — one-line hook`. Never write memory content directly into it.

-   Remove pointers to memories that are now stale, wrong, or superseded
-   Demote verbose entries: if an index line is over ~200 chars, it's carrying content that belongs in the topic file — shorten the line, move the detail
-   Add pointers to newly important memories
-   Resolve contradictions — if two files disagree, fix the wrong one

---

Return a brief summary of what you consolidated, updated, or pruned. If nothing changed (memories are already tight), say so.

````claude-code:10-64

**Merge vs. delete decisions** are made by the LLM agent itself — the prompt instructs it to merge new signal into existing topic files, delete contradicted facts, and prune stale index entries. The output is both new files and edits to existing ones (via `FileEditTool` and `FileWriteTool`).

**File-based mutex:** The lock file is `.consolidate-lock` inside the auto-memory directory (`getAutoMemPath()`). Its **mtime IS `lastConsolidatedAt`**. The body contains the holder's PID. Stale timeout is `HOLDER_STALE_MS = 60 * 60 * 1000` (1 hour). Contention handling: if the lock exists and mtime is within 1 hour AND the PID is alive, acquisition returns `null`. Dead PID or stale → reclaim by writing own PID, then re-read to verify (last writer wins). On failure, `rollbackConsolidationLock()` rewinds mtime via `utimes()`. claude-code:1-84 claude-code:91-108

---

### 23. Bundled Skills Injection

**File extraction:** When a `BundledSkillDefinition` has a `files` field, on first invocation `extractBundledSkillFiles()` writes them to `getBundledSkillExtractDir(name)` which is `join(getBundledSkillsRoot(), skillName)`. claude-code:59-73

**Nonce directory naming:** `getBundledSkillsRoot()` returns `join(getClaudeTempDir(), 'bundled-skills', MACRO.VERSION, nonce)` where `nonce = randomBytes(16).toString('hex')` — a 32-char hex string, unique per process. claude-code:365-370

**Exact `open()` flags:** On non-Windows: `fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | O_NOFOLLOW`. On Windows: `'wx'`. File mode is `0o600`, directory mode is `0o700`. claude-code:176-193

**Prefix prepended:** `prependBaseDir()` prepends `"Base directory for this skill: ${baseDir}\n\n"` to the first text block of the skill prompt. claude-code:208-220

**`getSkillToolCommands()`** filters all commands to those that are `type: 'prompt'`, not `disableModelInvocation`, not `source: 'builtin'`, and loaded from `'bundled'`, `'skills'`, `'commands_DEPRECATED'`, or having `hasUserSpecifiedDescription` or `whenToUse`. These are formatted into a skill listing attachment injected into the conversation. claude-code:563-581

**Skill-as-tool vs. slash command:** When the model calls the `Skill` tool, `SkillTool.ts` resolves the command name, loads the prompt via `getPromptForCommand()`, and either injects it inline (as a meta user message) or forks a subagent. When a user invokes `/skillname`, the same `getPromptForCommand()` is called but through the slash command pipeline.

**`allowedTools` enforcement:** Each skill's `allowedTools` array is stored on the `Command` object. During skill execution in a forked context, the `getAppState()` is wrapped to inject these into `toolPermissionContext.alwaysAllowRules.command`, effectively auto-allowing those tools for the skill's execution scope. claude-code:344-396

---

### 24. Effort Option Mapping

The `effort` option (`low|medium|high|max`) maps to the API's `output_config.effort` field — it is **not** a thinking budget, temperature change, or system prompt instruction.

The exact code in `configureEffortParams()`: claude-code:440-466

- If `effortValue` is `undefined`, it pushes `EFFORT_BETA_HEADER` to betas (letting the API use its default).
- If it's a string (`'low'|'medium'|'high'|'max'`), it sets `outputConfig.effort = effortValue` and pushes the beta header.
- Numeric effort (ant-only) goes into `extraBodyParams.anthropic_internal.effort_override`.

**Resolution chain** (`resolveAppliedEffort()`): `env CLAUDE_CODE_EFFORT_LEVEL` → `appState.effortValue` → `getDefaultEffortForModel(model)`. If resolved to `'max'` on a non-Opus-4.6 model, it's downgraded to `'high'`. claude-code:152-167

Effort is applied in the main API call chain (`configureEffortParams` is called during request construction in `claude.ts`). It does **not** separately affect subagents — subagents use their own model/effort configuration.

Thinking is configured **independently** of effort — adaptive thinking is used for models that support it, otherwise a budget-based thinking config is used. claude-code:1601-1631

---

## Section 6 — Hooks & Observability

### 25. Hook Execution Model

Hooks are **spawned as child processes** (for command hooks) via `spawn()` from `child_process`, or executed via LLM sideQuery (prompt/agent hooks), or HTTP POST (http hooks). claude-code:7-9 claude-code:957-984

**Timeouts:**
- **BashCommandHook:** Per-hook `timeout` field (seconds) or default `TOOL_HOOK_EXECUTION_TIMEOUT_MS = 10 * 60 * 1000` (10 minutes). SessionEnd hooks: `SESSION_END_HOOK_TIMEOUT_MS_DEFAULT = 1500` ms. claude-code:166-182
- **PromptHook:** `hook.timeout * 1000` or default `30000` ms (30s). claude-code:55-55
- **AgentHook:** `hook.timeout * 1000` or default `60000` ms (60s). claude-code:75-75
- **HttpHook:** Per-hook `timeout` field or the same `TOOL_HOOK_EXECUTION_TIMEOUT_MS`.

**Output injection:** Hook results are injected as `AttachmentMessage` objects with `type: 'hook_success'` or `'hook_non_blocking_error'`, role is effectively `user` (attachment messages are system-injected user-side content), and `isMeta` is not explicitly set on these (they appear in the transcript). claude-code:2628-2644

---

### 26. `asyncRewake: true`

When a background bash hook has `asyncRewake: true`, the hook is spawned as a child process but **bypasses the async hook registry**. Instead, `shellCommand.result` (a Promise that resolves on process exit) is `.then()`-chained. On exit code 2, it calls `enqueuePendingNotification()` with `mode: 'task-notification'`, wrapping the stderr/stdout in a `<system-reminder>` tag. This notification is picked up by `useQueueProcessor` (if idle) or injected mid-query via `queued_command` attachments (if busy). There is no IPC/signal mechanism — it's a Promise chain on the child process exit event. claude-code:205-246

---

### 27. PreToolUse / PostToolUse Hook Event Payloads

**PreToolUse** (from SDK schema):
```typescript
BaseHookInput & {
  hook_event_name: 'PreToolUse'
  tool_name: string
  tool_input: unknown
  tool_use_id: string
}
``` claude-code:414-423

**PostToolUse:**
```typescript
BaseHookInput & {
  hook_event_name: 'PostToolUse'
  tool_name: string
  tool_input: unknown
  tool_response: unknown
  tool_use_id: string
}
``` claude-code:436-446

**PreToolUse short-circuit:** A hook returns `{ decision: 'block' }` in its JSON output (or exits with code 2). When blocked, the model receives a `blockingError` message: `[${hook.command}]: ${stderr || 'No stderr output'}`. claude-code:2648-2668

The `PreToolUseHookSpecificOutput` can also return `permissionDecision: 'allow'|'deny'|'ask'`, `updatedInput`, and `additionalContext`. claude-code:806-814

**SDK stream exposure:** Hook events are emitted via `emitHookStarted()` and `emitHookResponse()` which feed into the SDK's event stream.

---

### 28. Cost Tracking

**Token reading:** `addToTotalSessionCost()` in `cost-tracker.ts` receives a `Usage` object and reads `usage.input_tokens`, `usage.output_tokens`, `usage.cache_read_input_tokens`, `usage.cache_creation_input_tokens`, and `usage.server_tool_use?.web_search_requests`. claude-code:266-276

**Streaming handling:** During streaming, usage arrives in `message_delta`. The `updateUsage()` function merges partial usage — it takes the new value if `> 0`, otherwise keeps the prior value. The final usage is written back to the last yielded message via direct property mutation (not object replacement, to preserve transcript queue references). claude-code:2213-2256 claude-code:2924-2987

**Cache savings calculation:** `cache_read_input_tokens` IS used. The discount is model-specific via `promptCacheReadTokens` in `ModelCosts`. For example, Sonnet: read tokens cost $0.30/Mtok vs $3/Mtok for regular input (10x discount). The formula in `tokensToUSDCost()`:
```typescript
(usage.cache_read_input_tokens / 1_000_000) * modelCosts.promptCacheReadTokens
``` claude-code:131-142 claude-code:35-70

---

## Section 7 — Design Decisions

### 29. Two Tool-Calling Code Paths

There is **no text-based `ACTION:` parsing path** in this codebase. A grep for `ACTION:` across all `.ts` files returns only unrelated hits in plugin operations. The codebase uses exclusively native function calling via `tool_use` blocks from the Anthropic API. There is no evidence of a maintained or dead-code text-based tool-calling path.

### 30. `react-kernel.ts`

This file **does not exist** in the codebase. A glob search for `**/react-kernel*` and a grep for `react-kernel` both return zero results. The question's premise appears to be based on outdated or incorrect information.

### 31. Settings System Layers

The settings system has **5 sources** (not 4), merged in priority order: claude-code:7-22

1. `userSettings` — `~/.claude/settings.json` (global)
2. `projectSettings` — `.claude/settings.json` (committed)
3. `localSettings` — `.claude/settings.local.json` (gitignored)
4. `flagSettings` — from `--settings` CLI flag
5. `policySettings` — managed settings (remote > HKLM/plist > managed-settings.json > HKCU)

Policy settings have **highest priority** and override everything. The `managed`/`policySettings` layer specifically protects against users overriding enterprise security policies — e.g., an org can enforce `deny` rules for dangerous commands that individual users cannot override. Without it, a user could add `allow: ["Bash(rm -rf:*)"]` in their project settings and bypass org policy. claude-code:674-739

If collapsed to just `global + project`, a malicious `.claude/settings.json` in a cloned repo could override a user's global deny rules, creating a security vulnerability.

### 32. Permission Pattern Matching

The system uses string patterns like `"Bash(git *)"` parsed by a **custom parser** in `shellRuleMatching.ts`. It is NOT glob, minimatch, or a custom lexer — it's a hand-rolled regex-based matcher.

`parsePermissionRule()` classifies rules into three types:
- **exact**: literal string match
- **prefix**: legacy `:*` syntax (e.g., `npm:*` → prefix `npm`)
- **wildcard**: contains unescaped `*` (converted to `.*` regex) claude-code:159-184

`matchWildcardPattern()` converts `*` to `.*`, handles `\*` (escaped literal star) and `\\` (escaped backslash) via null-byte sentinel placeholders, then builds a regex with `^...$` anchoring and the `s` (dotAll) flag. A trailing ` *` with only one unescaped star is made optional (`( .*)?`) so `git *` matches bare `git`. claude-code:90-154

Edge cases the string form handles: compound command blocking (prefix rules don't match `cd /path && evil`), xargs prefix matching, env var stripping for deny rules, output redirection stripping, and safe wrapper stripping (`timeout`, `time`, `nice`, `nohup`). claude-code:778-935

### 33. `createResolveOnce`

The exact implementation:

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
``` claude-code:75-94

It's a closure over two booleans: `claimed` and `delivered`. The `claim()` method is an **atomic check-and-mark** — it returns `true` only for the first caller, closing the window between checking `isResolved()` and calling `resolve()`. This is used in the permission race where up to 5 concurrent resolvers compete: user interaction, PermissionRequest hooks, bash classifier, bridge (CCR), and channel (Telegram/iMessage). The comments explicitly describe the race:

> *"Atomically check-and-mark as resolved. Returns true if this caller won the race (nobody else has resolved yet), false otherwise. Use this in async callbacks BEFORE awaiting, to close the window between the `isResolved()` check and the actual `resolve()` call."* claude-code:63-73

### 34. `detectCompletionGaps`

This function **does not exist** in the codebase. A grep returns zero results. Similarly, `withMinIterations` and `final-answer` meta-tool return zero results. These concepts are not present in this version of the code.

### 35. CONTEXT_COLLAPSE Feature

`CONTEXT_COLLAPSE` is a feature-gated context management strategy that differs from both microcompact and autocompact:

- **Microcompact** strips redundant content from individual messages (e.g., removing thinking blocks, truncating tool results).
- **Autocompact** summarizes the entire conversation into a single compact summary when token usage exceeds a threshold.
- **Context collapse** is a **granular, span-based** approach: it identifies spans of messages that can be summarized individually, replacing them with `<collapsed>` placeholder messages while preserving the rest of the conversation intact.

**`recoverFromOverflow`** is called in the 413 recovery path. When a prompt-too-long error is withheld, the query loop first tries to "drain" all staged collapses — committing staged summaries to free context space. If `drained.committed > 0`, the loop continues with `transition: { reason: 'collapse_drain_retry' }`. If that retry still 413s, it falls through to reactive compact. claude-code:1085-1117

**Staged collapses** are spans identified by a background context-agent that produces summaries. These sit in a queue (`staged` array with `startUuid`, `endUuid`, `summary`, `risk`, `stagedAt`). "Draining" means committing all staged spans at once — replacing the original messages with summary placeholders. Collapses are persisted as `marble-origami-commit` entries in the transcript JSONL, and the staged queue is snapshot as `marble-origami-snapshot`. claude-code:255-295

The collapsed view is a **read-time projection** — `projectView()` replays the commit log on every query loop entry, splicing out archived messages and inserting summary placeholders. claude-code:428-447

### 36. `pendingToolUseSummary`

`pendingToolUseSummary` is typed as `Promise<ToolUseSummaryMessage | null> | undefined` on the `State` object in the query loop. claude-code:211-211

**When set:** After tool execution completes, if `config.gates.emitToolUseSummaries` is true, tool count > 0, not aborted, and not a subagent, `generateToolUseSummary()` is fired off asynchronously (via Haiku) and the resulting promise is stored as `nextPendingToolUseSummary`. claude-code:1411-1482

**When resolved:** At the top of the next loop iteration, after the streaming response completes: `const summary = await pendingToolUseSummary; if (summary) yield summary`. claude-code:1054-1060

**`ToolUseSummaryMessage` contains:**
```typescript
{
  type: 'tool_use_summary',
  summary: string,           // e.g., "Read 2 files, wrote 1 file"
  precedingToolUseIds: string[],
  uuid: string,
  timestamp: string,
}
``` claude-code:5105-5116

The summary is generated by Haiku with a system prompt asking for a git-commit-subject-style label (~30 chars). It IS related to the SDK's `tool_use_summary` message type — the SDK schema `SDKToolUseSummaryMessageSchema` has `type: 'tool_use_summary'`, `summary`, and `preceding_tool_use_ids`. claude-code:15-24 claude-code:1769-1777
### Citations
**File:** src/memdir/memoryScan.ts (L13-19)
```typescript
export type MemoryHeader = {
  filename: string
  filePath: string
  mtimeMs: number
  description: string | null
  type: MemoryType | undefined
}
````

**File:** src/memdir/memoryScan.ts (L35-73)

```typescript
export async function scanMemoryFiles(
  memoryDir: string,
  signal: AbortSignal,
): Promise<MemoryHeader[]> {
  try {
    const entries = await readdir(memoryDir, { recursive: true })
    const mdFiles = entries.filter(
      f => f.endsWith('.md') && basename(f) !== 'MEMORY.md',
    )

    const headerResults = await Promise.allSettled(
      mdFiles.map(async (relativePath): Promise<MemoryHeader> => {
        const filePath = join(memoryDir, relativePath)
        const { content, mtimeMs } = await readFileInRange(
          filePath,
          0,
          FRONTMATTER_MAX_LINES,
          undefined,
          signal,
        )
        const { frontmatter } = parseFrontmatter(content, filePath)
        return {
          filename: relativePath,
          filePath,
          mtimeMs,
          description: frontmatter.description || null,
          type: parseMemoryType(frontmatter.type),
        }
      }),
    )

    return headerResults
      .filter(
        (r): r is PromiseFulfilledResult<MemoryHeader> =>
          r.status === 'fulfilled',
      )
      .map(r => r.value)
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, MAX_MEMORY_FILES)
```

**File:** src/memdir/findRelevantMemories.ts (L18-24)

```typescript
const SELECT_MEMORIES_SYSTEM_PROMPT = `You are selecting memories that will be useful to Claude Code as it processes a user's query. You will be given the user's query and a list of available memory files with their filenames and descriptions.

Return a list of filenames for the memories that will clearly be useful to Claude Code as it processes the user's query (up to 5). Only include memories that you are certain will be helpful based on their name and description.
- If you are unsure if a memory will be useful in processing the user's query, then do not include it in your list. Be selective and discerning.
- If there are no memories in the list that would clearly be useful, feel free to return an empty list.
- If a list of recently-used tools is provided, do not select memories that are usage reference or API documentation for those tools (Claude Code is already exercising them). DO still select memories containing warnings, gotchas, or known issues about those tools — active use is exactly when those matter.
`
```

**File:** src/memdir/findRelevantMemories.ts (L39-48)

```typescript
export async function findRelevantMemories(
  query: string,
  memoryDir: string,
  signal: AbortSignal,
  recentTools: readonly string[] = [],
  alreadySurfaced: ReadonlySet<string> = new Set(),
): Promise<RelevantMemory[]> {
  const memories = (await scanMemoryFiles(memoryDir, signal)).filter(
    m => !alreadySurfaced.has(m.filePath),
  )
```

**File:** src/memdir/findRelevantMemories.ts (L109-119)

```typescript
      output_format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            selected_memories: { type: 'array', items: { type: 'string' } },
          },
          required: ['selected_memories'],
          additionalProperties: false,
        },
      },
```

**File:** src/utils/attachments.ts (L2251-2266)

```typescript
export function collectSurfacedMemories(messages: ReadonlyArray<Message>): {
    paths: Set<string>
    totalBytes: number
} {
    const paths = new Set<string>()
    let totalBytes = 0
    for (const m of messages) {
        if (
            m.type === 'attachment' &&
            m.attachment.type === 'relevant_memories'
        ) {
            for (const mem of m.attachment.memories) {
                paths.add(mem.path)
                totalBytes += mem.content.length
            }
        }
    }
    return { paths, totalBytes }
}
```

**File:** src/utils/attachments.ts (L2327-2332)

```typescript
export function memoryHeader(path: string, mtimeMs: number): string {
    const staleness = memoryFreshnessText(mtimeMs)
    return staleness
        ? `${staleness}\n\nMemory: ${path}:`
        : `Memory (saved ${memoryAge(mtimeMs)}): ${path}:`
}
```

**File:** src/memdir/memoryAge.ts (L33-42)

```typescript
export function memoryFreshnessText(mtimeMs: number): string {
    const d = memoryAgeDays(mtimeMs)
    if (d <= 1) return ''
    return (
        `This memory is ${d} days old. ` +
        `Memories are point-in-time observations, not live state — ` +
        `claims about code behavior or file:line citations may be outdated. ` +
        `Verify against current code before asserting as fact.`
    )
}
```

**File:** src/services/autoDream/autoDream.ts (L122-125)

```typescript
export function initAutoDream(): void {
  let lastSessionScanAt = 0

  runner = async function runAutoDream(context, appendSystemMessage) {
```

**File:** src/services/autoDream/autoDream.ts (L130-190)

```typescript
// --- Time gate ---
let lastAt: number
try {
    lastAt = await readLastConsolidatedAt()
} catch (e: unknown) {
    logForDebugging(
        `[autoDream] readLastConsolidatedAt failed: ${(e as Error).message}`
    )
    return
}
const hoursSince = (Date.now() - lastAt) / 3_600_000
if (!force && hoursSince < cfg.minHours) return

// --- Scan throttle ---
const sinceScanMs = Date.now() - lastSessionScanAt
if (!force && sinceScanMs < SESSION_SCAN_INTERVAL_MS) {
    logForDebugging(
        `[autoDream] scan throttle — time-gate passed but last scan was ${Math.round(
            sinceScanMs / 1000
        )}s ago`
    )
    return
}
lastSessionScanAt = Date.now()

// --- Session gate ---
let sessionIds: string[]
try {
    sessionIds = await listSessionsTouchedSince(lastAt)
} catch (e: unknown) {
    logForDebugging(
        `[autoDream] listSessionsTouchedSince failed: ${(e as Error).message}`
    )
    return
}
// Exclude the current session (its mtime is always recent).
const currentSession = getSessionId()
sessionIds = sessionIds.filter((id) => id !== currentSession)
if (!force && sessionIds.length < cfg.minSessions) {
    logForDebugging(
        `[autoDream] skip — ${sessionIds.length} sessions since last consolidation, need ${cfg.minSessions}`
    )
    return
}

// --- Lock ---
// Under force, skip acquire entirely — use the existing mtime so
// kill's rollback is a no-op (rewinds to where it already is).
// The lock file stays untouched; next non-force turn sees it as-is.
let priorMtime: number | null
if (force) {
    priorMtime = lastAt
} else {
    try {
        priorMtime = await tryAcquireConsolidationLock()
    } catch (e: unknown) {
        logForDebugging(
            `[autoDream] lock acquire failed: ${(e as Error).message}`
        )
        return
    }
    if (priorMtime === null) return
}
```

**File:** src/services/autoDream/consolidationPrompt.ts (L10-64)

```typescript
export function buildConsolidationPrompt(
  memoryRoot: string,
  transcriptDir: string,
  extra: string,
): string {
  return `# Dream: Memory Consolidation

You are performing a dream — a reflective pass over your memory files. Synthesize what you've learned recently into durable, well-organized memories so that future sessions can orient quickly.

Memory directory: \`${memoryRoot}\`
${DIR_EXISTS_GUIDANCE}

Session transcripts: \`${transcriptDir}\` (large JSONL files — grep narrowly, don't read whole files)

---

## Phase 1 — Orient

- \`ls\` the memory directory to see what already exists
- Read \`${ENTRYPOINT_NAME}\` to understand the current index
- Skim existing topic files so you improve them rather than creating duplicates
- If \`logs/\` or \`sessions/\` subdirectories exist (assistant-mode layout), review recent entries there

## Phase 2 — Gather recent signal

Look for new information worth persisting. Sources in rough priority order:

1. **Daily logs** (\`logs/YYYY/MM/YYYY-MM-DD.md\`) if present — these are the append-only stream
2. **Existing memories that drifted** — facts that contradict something you see in the codebase now
3. **Transcript search** — if you need specific context (e.g., "what was the error message from yesterday's build failure?"), grep the JSONL transcripts for narrow terms:
   \`grep -rn "<narrow term>" ${transcriptDir}/ --include="*.jsonl" | tail -50\`

Don't exhaustively read transcripts. Look only for things you already suspect matter.

## Phase 3 — Consolidate

For each thing worth remembering, write or update a memory file at the top level of the memory directory. Use the memory file format and type conventions from your system prompt's auto-memory section — it's the source of truth for what to save, how to structure it, and what NOT to save.

Focus on:
- Merging new signal into existing topic files rather than creating near-duplicates
- Converting relative dates ("yesterday", "last week") to absolute dates so they remain interpretable after time passes
- Deleting contradicted facts — if today's investigation disproves an old memory, fix it at the source

## Phase 4 — Prune and index

Update \`${ENTRYPOINT_NAME}\` so it stays under ${MAX_ENTRYPOINT_LINES} lines AND under ~25KB. It's an **index**, not a dump — each entry should be one line under ~150 characters: \`- [Title](file.md) — one-line hook\`. Never write memory content directly into it.

- Remove pointers to memories that are now stale, wrong, or superseded
- Demote verbose entries: if an index line is over ~200 chars, it's carrying content that belongs in the topic file — shorten the line, move the detail
- Add pointers to newly important memories
- Resolve contradictions — if two files disagree, fix the wrong one

---

Return a brief summary of what you consolidated, updated, or pruned. If nothing changed (memories are already tight), say so.${extra ? `\n\n## Additional context\n\n${extra}` : ''}`
```

**File:** src/services/autoDream/consolidationLock.ts (L1-84)

```typescript
// Lock file whose mtime IS lastConsolidatedAt. Body is the holder's PID.
//
// Lives inside the memory dir (getAutoMemPath) so it keys on git-root
// like memory does, and so it's writable even when the memory path comes
// from an env/settings override whose parent may not be.

import { mkdir, readFile, stat, unlink, utimes, writeFile } from 'fs/promises'
import { join } from 'path'
import { getOriginalCwd } from '../../bootstrap/state.js'
import { getAutoMemPath } from '../../memdir/paths.js'
import { logForDebugging } from '../../utils/debug.js'
import { isProcessRunning } from '../../utils/genericProcessUtils.js'
import { listCandidates } from '../../utils/listSessionsImpl.js'
import { getProjectDir } from '../../utils/sessionStorage.js'

const LOCK_FILE = '.consolidate-lock'

// Stale past this even if the PID is live (PID reuse guard).
const HOLDER_STALE_MS = 60 * 60 * 1000

function lockPath(): string {
    return join(getAutoMemPath(), LOCK_FILE)
}

/**
 * mtime of the lock file = lastConsolidatedAt. 0 if absent.
 * Per-turn cost: one stat.
 */
export async function readLastConsolidatedAt(): Promise<number> {
    try {
        const s = await stat(lockPath())
        return s.mtimeMs
    } catch {
        return 0
    }
}

/**
 * Acquire: write PID → mtime = now. Returns the pre-acquire mtime
 * (for rollback), or null if blocked / lost a race.
 *
 *   Success → do nothing. mtime stays at now.
 *   Failure → rollbackConsolidationLock(priorMtime) rewinds mtime.
 *   Crash   → mtime stuck, dead PID → next process reclaims.
 */
export async function tryAcquireConsolidationLock(): Promise<number | null> {
    const path = lockPath()

    let mtimeMs: number | undefined
    let holderPid: number | undefined
    try {
        const [s, raw] = await Promise.all([stat(path), readFile(path, 'utf8')])
        mtimeMs = s.mtimeMs
        const parsed = parseInt(raw.trim(), 10)
        holderPid = Number.isFinite(parsed) ? parsed : undefined
    } catch {
        // ENOENT — no prior lock.
    }

    if (mtimeMs !== undefined && Date.now() - mtimeMs < HOLDER_STALE_MS) {
        if (holderPid !== undefined && isProcessRunning(holderPid)) {
            logForDebugging(
                `[autoDream] lock held by live PID ${holderPid} (mtime ${Math.round(
                    (Date.now() - mtimeMs) / 1000
                )}s ago)`
            )
            return null
        }
        // Dead PID or unparseable body — reclaim.
    }

    // Memory dir may not exist yet.
    await mkdir(getAutoMemPath(), { recursive: true })
    await writeFile(path, String(process.pid))

    // Two reclaimers both write → last wins the PID. Loser bails on re-read.
    let verify: string
    try {
        verify = await readFile(path, 'utf8')
    } catch {
        return null
    }
    if (parseInt(verify.trim(), 10) !== process.pid) return null

    return mtimeMs ?? 0
}
```

**File:** src/services/autoDream/consolidationLock.ts (L91-108)

```typescript
export async function rollbackConsolidationLock(
    priorMtime: number
): Promise<void> {
    const path = lockPath()
    try {
        if (priorMtime === 0) {
            await unlink(path)
            return
        }
        await writeFile(path, '')
        const t = priorMtime / 1000 // utimes wants seconds
        await utimes(path, t, t)
    } catch (e: unknown) {
        logForDebugging(
            `[autoDream] rollback failed: ${
                (e as Error).message
            } — next trigger delayed to minHours`
        )
    }
}
```

**File:** src/skills/bundledSkills.ts (L59-73)

```typescript
if (files && Object.keys(files).length > 0) {
    skillRoot = getBundledSkillExtractDir(definition.name)
    // Closure-local memoization: extract once per process.
    // Memoize the promise (not the result) so concurrent callers await
    // the same extraction instead of racing into separate writes.
    let extractionPromise: Promise<string | null> | undefined
    const inner = definition.getPromptForCommand
    getPromptForCommand = async (args, ctx) => {
        extractionPromise ??= extractBundledSkillFiles(definition.name, files)
        const extractedDir = await extractionPromise
        const blocks = await inner(args, ctx)
        if (extractedDir === null) return blocks
        return prependBaseDir(blocks, extractedDir)
    }
}
```

**File:** src/skills/bundledSkills.ts (L176-193)

```typescript
const O_NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0
// On Windows, use string flags — numeric O_EXCL can produce EINVAL through libuv.
const SAFE_WRITE_FLAGS =
    process.platform === 'win32'
        ? 'wx'
        : fsConstants.O_WRONLY |
          fsConstants.O_CREAT |
          fsConstants.O_EXCL |
          O_NOFOLLOW

async function safeWriteFile(p: string, content: string): Promise<void> {
    const fh = await open(p, SAFE_WRITE_FLAGS, 0o600)
    try {
        await fh.writeFile(content, 'utf8')
    } finally {
        await fh.close()
    }
}
```

**File:** src/skills/bundledSkills.ts (L208-220)

```typescript
function prependBaseDir(
    blocks: ContentBlockParam[],
    baseDir: string
): ContentBlockParam[] {
    const prefix = `Base directory for this skill: ${baseDir}\n\n`
    if (blocks.length > 0 && blocks[0]!.type === 'text') {
        return [
            { type: 'text', text: prefix + blocks[0]!.text },
            ...blocks.slice(1),
        ]
    }
    return [{ type: 'text', text: prefix }, ...blocks]
}
```

**File:** src/utils/permissions/filesystem.ts (L365-370)

```typescript
export const getBundledSkillsRoot = memoize(
    function getBundledSkillsRoot(): string {
        const nonce = randomBytes(16).toString('hex')
        return join(getClaudeTempDir(), 'bundled-skills', MACRO.VERSION, nonce)
    }
)
```

**File:** src/commands.ts (L563-581)

```typescript
export const getSkillToolCommands = memoize(
    async (cwd: string): Promise<Command[]> => {
        const allCommands = await getCommands(cwd)
        return allCommands.filter(
            (cmd) =>
                cmd.type === 'prompt' &&
                !cmd.disableModelInvocation &&
                cmd.source !== 'builtin' &&
                // Always include skills from /skills/ dirs, bundled skills, and legacy /commands/ entries
                // (they all get an auto-derived description from the first line if frontmatter is missing).
                // Plugin/MCP commands still require an explicit description to appear in the listing.
                (cmd.loadedFrom === 'bundled' ||
                    cmd.loadedFrom === 'skills' ||
                    cmd.loadedFrom === 'commands_DEPRECATED' ||
                    cmd.hasUserSpecifiedDescription ||
                    cmd.whenToUse)
        )
    }
)
```

**File:** src/skills/loadSkillsDir.ts (L344-396)

````typescript
    async getPromptForCommand(args, toolUseContext) {
      let finalContent = baseDir
        ? `Base directory for this skill: ${baseDir}\n\n${markdownContent}`
        : markdownContent

      finalContent = substituteArguments(
        finalContent,
        args,
        true,
        argumentNames,
      )

      // Replace ${CLAUDE_SKILL_DIR} with the skill's own directory so bash
      // injection (!`...`) can reference bundled scripts. Normalize backslashes
      // to forward slashes on Windows so shell commands don't treat them as escapes.
      if (baseDir) {
        const skillDir =
          process.platform === 'win32' ? baseDir.replace(/\\/g, '/') : baseDir
        finalContent = finalContent.replace(/\$\{CLAUDE_SKILL_DIR\}/g, skillDir)
      }

      // Replace ${CLAUDE_SESSION_ID} with the current session ID
      finalContent = finalContent.replace(
        /\$\{CLAUDE_SESSION_ID\}/g,
        getSessionId(),
      )

      // Security: MCP skills are remote and untrusted — never execute inline
      // shell commands (!`…` / ```! … ```) from their markdown body.
      // ${CLAUDE_SKILL_DIR} is meaningless for MCP skills anyway.
      if (loadedFrom !== 'mcp') {
        finalContent = await executeShellCommandsInPrompt(
          finalContent,
          {
            ...toolUseContext,
            getAppState() {
              const appState = toolUseContext.getAppState()
              return {
                ...appState,
                toolPermissionContext: {
                  ...appState.toolPermissionContext,
                  alwaysAllowRules: {
                    ...appState.toolPermissionContext.alwaysAllowRules,
                    command: allowedTools,
                  },
                },
              }
            },
          },
          `/${skillName}`,
          shell,
        )
      }
````

**File:** src/services/api/claude.ts (L440-466)

```typescript
function configureEffortParams(
    effortValue: EffortValue | undefined,
    outputConfig: BetaOutputConfig,
    extraBodyParams: Record<string, unknown>,
    betas: string[],
    model: string
): void {
    if (!modelSupportsEffort(model) || 'effort' in outputConfig) {
        return
    }

    if (effortValue === undefined) {
        betas.push(EFFORT_BETA_HEADER)
    } else if (typeof effortValue === 'string') {
        // Send string effort level as is
        outputConfig.effort = effortValue
        betas.push(EFFORT_BETA_HEADER)
    } else if (process.env.USER_TYPE === 'ant') {
        // Numeric effort override - ant-only (uses anthropic_internal)
        const existingInternal =
            (extraBodyParams.anthropic_internal as Record<string, unknown>) ||
            {}
        extraBodyParams.anthropic_internal = {
            ...existingInternal,
            effort_override: effortValue,
        }
    }
}
```

**File:** src/services/api/claude.ts (L1601-1631)

```typescript
// IMPORTANT: Do not change the adaptive-vs-budget thinking selection below
// without notifying the model launch DRI and research. This is a sensitive
// setting that can greatly affect model quality and bashing.
if (hasThinking && modelSupportsThinking(options.model)) {
    if (
        !isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING) &&
        modelSupportsAdaptiveThinking(options.model)
    ) {
        // For models that support adaptive thinking, always use adaptive
        // thinking without a budget.
        thinking = {
            type: 'adaptive',
        } satisfies BetaMessageStreamParams['thinking']
    } else {
        // For models that do not support adaptive thinking, use the default
        // thinking budget unless explicitly specified.
        let thinkingBudget = getMaxThinkingTokensForModel(options.model)
        if (
            thinkingConfig.type === 'enabled' &&
            thinkingConfig.budgetTokens !== undefined
        ) {
            thinkingBudget = thinkingConfig.budgetTokens
        }
        thinkingBudget = Math.min(maxOutputTokens - 1, thinkingBudget)
        thinking = {
            budget_tokens: thinkingBudget,
            type: 'enabled',
        } satisfies BetaMessageStreamParams['thinking']
    }
}
```

**File:** src/services/api/claude.ts (L2213-2256)

```typescript
          case 'message_delta': {
            usage = updateUsage(usage, part.usage)
            // Capture research from message_delta if available (internal only).
            // Always overwrite with the latest value. Also write back to
            // already-yielded messages since message_delta arrives after
            // content_block_stop.
            if (
              process.env.USER_TYPE === 'ant' &&
              'research' in (part as unknown as Record<string, unknown>)
            ) {
              research = (part as unknown as Record<string, unknown>).research
              for (const msg of newMessages) {
                msg.research = research
              }
            }

            // Write final usage and stop_reason back to the last yielded
            // message. Messages are created at content_block_stop from
            // partialMessage, which was set at message_start before any tokens
            // were generated (output_tokens: 0, stop_reason: null).
            // message_delta arrives after content_block_stop with the real
            // values.
            //
            // IMPORTANT: Use direct property mutation, not object replacement.
            // The transcript write queue holds a reference to message.message
            // and serializes it lazily (100ms flush interval). Object
            // replacement ({ ...lastMsg.message, usage }) would disconnect
            // the queued reference; direct mutation ensures the transcript
            // captures the final values.
            stopReason = part.delta.stop_reason

            const lastMsg = newMessages.at(-1)
            if (lastMsg) {
              lastMsg.message.usage = usage
              lastMsg.message.stop_reason = stopReason
            }

            // Update cost
            const costUSDForPart = calculateUSDCost(resolvedModel, usage)
            costUSD += addToTotalSessionCost(
              costUSDForPart,
              usage,
              options.model,
            )
```

**File:** src/services/api/claude.ts (L2924-2987)

```typescript
export function updateUsage(
    usage: Readonly<NonNullableUsage>,
    partUsage: BetaMessageDeltaUsage | undefined
): NonNullableUsage {
    if (!partUsage) {
        return { ...usage }
    }
    return {
        input_tokens:
            partUsage.input_tokens !== null && partUsage.input_tokens > 0
                ? partUsage.input_tokens
                : usage.input_tokens,
        cache_creation_input_tokens:
            partUsage.cache_creation_input_tokens !== null &&
            partUsage.cache_creation_input_tokens > 0
                ? partUsage.cache_creation_input_tokens
                : usage.cache_creation_input_tokens,
        cache_read_input_tokens:
            partUsage.cache_read_input_tokens !== null &&
            partUsage.cache_read_input_tokens > 0
                ? partUsage.cache_read_input_tokens
                : usage.cache_read_input_tokens,
        output_tokens: partUsage.output_tokens ?? usage.output_tokens,
        server_tool_use: {
            web_search_requests:
                partUsage.server_tool_use?.web_search_requests ??
                usage.server_tool_use.web_search_requests,
            web_fetch_requests:
                partUsage.server_tool_use?.web_fetch_requests ??
                usage.server_tool_use.web_fetch_requests,
        },
        service_tier: usage.service_tier,
        cache_creation: {
            // SDK type BetaMessageDeltaUsage is missing cache_creation, but it's real!
            ephemeral_1h_input_tokens:
                (partUsage as BetaUsage).cache_creation
                    ?.ephemeral_1h_input_tokens ??
                usage.cache_creation.ephemeral_1h_input_tokens,
            ephemeral_5m_input_tokens:
                (partUsage as BetaUsage).cache_creation
                    ?.ephemeral_5m_input_tokens ??
                usage.cache_creation.ephemeral_5m_input_tokens,
        },
        // cache_deleted_input_tokens: returned by the API when cache editing
        // deletes KV cache content, but not in SDK types. Kept off NonNullableUsage
        // so the string is eliminated from external builds by dead code elimination.
        // Uses the same > 0 guard as other token fields to prevent message_delta
        // from overwriting the real value with 0.
        ...(feature('CACHED_MICROCOMPACT')
            ? {
                  cache_deleted_input_tokens:
                      (
                          partUsage as unknown as {
                              cache_deleted_input_tokens?: number
                          }
                      ).cache_deleted_input_tokens != null &&
                      (
                          partUsage as unknown as {
                              cache_deleted_input_tokens: number
                          }
                      ).cache_deleted_input_tokens > 0
                          ? (
                                partUsage as unknown as {
                                    cache_deleted_input_tokens: number
                                }
                            ).cache_deleted_input_tokens
                          : (
                                usage as unknown as {
                                    cache_deleted_input_tokens?: number
                                }
                            ).cache_deleted_input_tokens ?? 0,
              }
            : {}),
        inference_geo: usage.inference_geo,
        iterations: partUsage.iterations ?? usage.iterations,
        speed: (partUsage as BetaUsage).speed ?? usage.speed,
    }
}
```

**File:** src/utils/effort.ts (L152-167)

```typescript
export function resolveAppliedEffort(
    model: string,
    appStateEffortValue: EffortValue | undefined
): EffortValue | undefined {
    const envOverride = getEffortEnvOverride()
    if (envOverride === null) {
        return undefined
    }
    const resolved =
        envOverride ?? appStateEffortValue ?? getDefaultEffortForModel(model)
    // API rejects 'max' on non-Opus-4.6 models — downgrade to 'high'.
    if (resolved === 'max' && !modelSupportsMaxEffort(model)) {
        return 'high'
    }
    return resolved
}
```

**File:** src/utils/hooks.ts (L7-9)

```typescript
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { pathExists } from './file.js'
import { wrapSpawn } from './ShellCommand.js'
```

**File:** src/utils/hooks.ts (L166-182)

```typescript
const TOOL_HOOK_EXECUTION_TIMEOUT_MS = 10 * 60 * 1000

/**
 * SessionEnd hooks run during shutdown/clear and need a much tighter bound
 * than TOOL_HOOK_EXECUTION_TIMEOUT_MS. This value is used by callers as both
 * the per-hook default timeout AND the overall AbortSignal cap (hooks run in
 * parallel, so one value suffices). Overridable via env var for users whose
 * teardown scripts need more time.
 */
const SESSION_END_HOOK_TIMEOUT_MS_DEFAULT = 1500
export function getSessionEndHookTimeoutMs(): number {
    const raw = process.env.CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS
    const parsed = raw ? parseInt(raw, 10) : NaN
    return Number.isFinite(parsed) && parsed > 0
        ? parsed
        : SESSION_END_HOOK_TIMEOUT_MS_DEFAULT
}
```

**File:** src/utils/hooks.ts (L205-246)

```typescript
if (asyncRewake) {
    // asyncRewake hooks bypass the registry entirely. On completion, if exit
    // code 2 (blocking error), enqueue as a task-notification so it wakes the
    // model via useQueueProcessor (idle) or gets injected mid-query via
    // queued_command attachments (busy).
    //
    // NOTE: We deliberately do NOT call shellCommand.background() here, because
    // it calls taskOutput.spillToDisk() which breaks in-memory stdout/stderr
    // capture (getStderr() returns '' in disk mode). The StreamWrappers stay
    // attached and pipe data into the in-memory TaskOutput buffers. The abort
    // handler already no-ops on 'interrupt' reason (user submitted a new
    // message), so the hook survives new prompts. A hard cancel (Escape) WILL
    // kill the hook via the abort handler, which is the desired behavior.
    void shellCommand.result.then(async (result) => {
        // result resolves on 'exit', but stdio 'data' events may still be
        // pending. Yield to I/O so the StreamWrapper data handlers drain into
        // TaskOutput before we read it.
        await new Promise((resolve) => setImmediate(resolve))
        const stdout = await shellCommand.taskOutput.getStdout()
        const stderr = shellCommand.taskOutput.getStderr()
        shellCommand.cleanup()
        emitHookResponse({
            hookId,
            hookName,
            hookEvent,
            output: stdout + stderr,
            stdout,
            stderr,
            exitCode: result.code,
            outcome: result.code === 0 ? 'success' : 'error',
        })
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
    return true
}
```

**File:** src/utils/hooks.ts (L957-984)

```typescript
let child: ChildProcessWithoutNullStreams
if (shellType === 'powershell') {
    const pwshPath = await getCachedPowerShellPath()
    if (!pwshPath) {
        throw new Error(
            `Hook "${hook.command}" has shell: 'powershell' but no PowerShell ` +
                `executable (pwsh or powershell) was found on PATH. Install ` +
                `PowerShell, or remove "shell": "powershell" to use bash.`
        )
    }
    child = spawn(pwshPath, buildPowerShellArgs(finalCommand), {
        env: envVars,
        cwd: safeCwd,
        // Prevent visible console window on Windows (no-op on other platforms)
        windowsHide: true,
    }) as ChildProcessWithoutNullStreams
} else {
    // On Windows, use Git Bash explicitly (cmd.exe can't run bash syntax).
    // On other platforms, shell: true uses /bin/sh.
    const shell = isWindows ? findGitBashPath() : true
    child = spawn(finalCommand, [], {
        env: envVars,
        cwd: safeCwd,
        shell,
        // Prevent visible console window on Windows (no-op on other platforms)
        windowsHide: true,
    }) as ChildProcessWithoutNullStreams
}
```

**File:** src/utils/hooks.ts (L2628-2644)

```typescript
        yield {
          message: createAttachmentMessage({
            type: 'hook_success',
            hookName,
            toolUseID,
            hookEvent,
            content: result.stdout.trim(),
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.status,
            command: hookCommand,
            durationMs,
          }),
          outcome: 'success' as const,
          hook,
        }
        return
```

**File:** src/utils/hooks.ts (L2648-2668)

```typescript
      if (result.status === 2) {
        emitHookResponse({
          hookId,
          hookName,
          hookEvent,
          output: result.output,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.status,
          outcome: 'error',
        })
        yield {
          blockingError: {
            blockingError: `[${hook.command}]: ${result.stderr || 'No stderr output'}`,
            command: hook.command,
          },
          outcome: 'blocking' as const,
          hook,
        }
        return
      }
```

**File:** src/utils/hooks/execPromptHook.ts (L55-55)

```typescript
const hookTimeoutMs = hook.timeout ? hook.timeout * 1000 : 30000
```

**File:** src/utils/hooks/execAgentHook.ts (L75-75)

```typescript
const hookTimeoutMs = hook.timeout ? hook.timeout * 1000 : 60000
```

**File:** src/entrypoints/sdk/coreSchemas.ts (L414-423)

```typescript
export const PreToolUseHookInputSchema = lazySchema(() =>
    BaseHookInputSchema().and(
        z.object({
            hook_event_name: z.literal('PreToolUse'),
            tool_name: z.string(),
            tool_input: z.unknown(),
            tool_use_id: z.string(),
        })
    )
)
```

**File:** src/entrypoints/sdk/coreSchemas.ts (L436-446)

```typescript
export const PostToolUseHookInputSchema = lazySchema(() =>
    BaseHookInputSchema().and(
        z.object({
            hook_event_name: z.literal('PostToolUse'),
            tool_name: z.string(),
            tool_input: z.unknown(),
            tool_response: z.unknown(),
            tool_use_id: z.string(),
        })
    )
)
```

**File:** src/entrypoints/sdk/coreSchemas.ts (L806-814)

```typescript
export const PreToolUseHookSpecificOutputSchema = lazySchema(() =>
    z.object({
        hookEventName: z.literal('PreToolUse'),
        permissionDecision: PermissionBehaviorSchema().optional(),
        permissionDecisionReason: z.string().optional(),
        updatedInput: z.record(z.string(), z.unknown()).optional(),
        additionalContext: z.string().optional(),
    })
)
```

**File:** src/entrypoints/sdk/coreSchemas.ts (L1769-1777)

```typescript
export const SDKToolUseSummaryMessageSchema = lazySchema(() =>
    z.object({
        type: z.literal('tool_use_summary'),
        summary: z.string(),
        preceding_tool_use_ids: z.array(z.string()),
        uuid: UUIDPlaceholder(),
        session_id: z.string(),
    })
)
```

**File:** src/cost-tracker.ts (L266-276)

```typescript
  modelUsage.inputTokens += usage.input_tokens
  modelUsage.outputTokens += usage.output_tokens
  modelUsage.cacheReadInputTokens += usage.cache_read_input_tokens ?? 0
  modelUsage.cacheCreationInputTokens += usage.cache_creation_input_tokens ?? 0
  modelUsage.webSearchRequests +=
    usage.server_tool_use?.web_search_requests ?? 0
  modelUsage.costUSD += cost
  modelUsage.contextWindow = getContextWindowForModel(model, getSdkBetas())
  modelUsage.maxOutputTokens = getModelMaxOutputTokens(model).default
  return modelUsage
}
```

**File:** src/utils/modelCost.ts (L35-70)

```typescript
// Standard pricing tier for Sonnet models: $3 input / $15 output per Mtok
export const COST_TIER_3_15 = {
    inputTokens: 3,
    outputTokens: 15,
    promptCacheWriteTokens: 3.75,
    promptCacheReadTokens: 0.3,
    webSearchRequests: 0.01,
} as const satisfies ModelCosts

// Pricing tier for Opus 4/4.1: $15 input / $75 output per Mtok
export const COST_TIER_15_75 = {
    inputTokens: 15,
    outputTokens: 75,
    promptCacheWriteTokens: 18.75,
    promptCacheReadTokens: 1.5,
    webSearchRequests: 0.01,
} as const satisfies ModelCosts

// Pricing tier for Opus 4.5: $5 input / $25 output per Mtok
export const COST_TIER_5_25 = {
    inputTokens: 5,
    outputTokens: 25,
    promptCacheWriteTokens: 6.25,
    promptCacheReadTokens: 0.5,
    webSearchRequests: 0.01,
} as const satisfies ModelCosts

// Fast mode pricing for Opus 4.6: $30 input / $150 output per Mtok
export const COST_TIER_30_150 = {
    inputTokens: 30,
    outputTokens: 150,
    promptCacheWriteTokens: 37.5,
    promptCacheReadTokens: 3,
    webSearchRequests: 0.01,
} as const satisfies ModelCosts
```

**File:** src/utils/modelCost.ts (L131-142)

```typescript
function tokensToUSDCost(modelCosts: ModelCosts, usage: Usage): number {
    return (
        (usage.input_tokens / 1_000_000) * modelCosts.inputTokens +
        (usage.output_tokens / 1_000_000) * modelCosts.outputTokens +
        ((usage.cache_read_input_tokens ?? 0) / 1_000_000) *
            modelCosts.promptCacheReadTokens +
        ((usage.cache_creation_input_tokens ?? 0) / 1_000_000) *
            modelCosts.promptCacheWriteTokens +
        (usage.server_tool_use?.web_search_requests ?? 0) *
            modelCosts.webSearchRequests
    )
}
```

**File:** src/utils/settings/constants.ts (L7-22)

```typescript
export const SETTING_SOURCES = [
    // User settings (global)
    'userSettings',

    // Project settings (shared per-directory)
    'projectSettings',

    // Local settings (gitignored)
    'localSettings',

    // Flag settings (from --settings flag)
    'flagSettings',

    // Policy settings (managed-settings.json or remote settings from API)
    'policySettings',
] as const
```

**File:** src/utils/settings/settings.ts (L674-739)

```typescript
    for (const source of getEnabledSettingSources()) {
      // policySettings: "first source wins" — use the highest-priority source
      // that has content. Priority: remote > HKLM/plist > managed-settings.json > HKCU
      if (source === 'policySettings') {
        let policySettings: SettingsJson | null = null
        const policyErrors: ValidationError[] = []

        // 1. Remote (highest priority)
        const remoteSettings = getRemoteManagedSettingsSyncFromCache()
        if (remoteSettings && Object.keys(remoteSettings).length > 0) {
          const result = SettingsSchema().safeParse(remoteSettings)
          if (result.success) {
            policySettings = result.data
          } else {
            // Remote exists but is invalid — surface errors even as we fall through
            policyErrors.push(
              ...formatZodError(result.error, 'remote managed settings'),
            )
          }
        }

        // 2. Admin-only MDM (HKLM / macOS plist)
        if (!policySettings) {
          const mdmResult = getMdmSettings()
          if (Object.keys(mdmResult.settings).length > 0) {
            policySettings = mdmResult.settings
          }
          policyErrors.push(...mdmResult.errors)
        }

        // 3. managed-settings.json + managed-settings.d/ (file-based, requires admin)
        if (!policySettings) {
          const { settings, errors } = loadManagedFileSettings()
          if (settings) {
            policySettings = settings
          }
          policyErrors.push(...errors)
        }

        // 4. HKCU (lowest — user-writable, only if nothing above exists)
        if (!policySettings) {
          const hkcu = getHkcuSettings()
          if (Object.keys(hkcu.settings).length > 0) {
            policySettings = hkcu.settings
          }
          policyErrors.push(...hkcu.errors)
        }

        // Merge the winning policy source into the settings chain
        if (policySettings) {
          mergedSettings = mergeWith(
            mergedSettings,
            policySettings,
            settingsMergeCustomizer,
          )
        }
        for (const error of policyErrors) {
          const errorKey = `${error.file}:${error.path}:${error.message}`
          if (!seenErrors.has(errorKey)) {
            seenErrors.add(errorKey)
            allErrors.push(error)
          }
        }

        continue
      }
```

**File:** src/utils/permissions/shellRuleMatching.ts (L90-154)

```typescript
export function matchWildcardPattern(
    pattern: string,
    command: string,
    caseInsensitive = false
): boolean {
    // Trim leading/trailing whitespace from pattern
    const trimmedPattern = pattern.trim()

    // Process the pattern to handle escape sequences: \* and \\
    let processed = ''
    let i = 0

    while (i < trimmedPattern.length) {
        const char = trimmedPattern[i]

        // Handle escape sequences
        if (char === '\\' && i + 1 < trimmedPattern.length) {
            const nextChar = trimmedPattern[i + 1]
            if (nextChar === '*') {
                // \* -> literal asterisk placeholder
                processed += ESCAPED_STAR_PLACEHOLDER
                i += 2
                continue
            } else if (nextChar === '\\') {
                // \\ -> literal backslash placeholder
                processed += ESCAPED_BACKSLASH_PLACEHOLDER
                i += 2
                continue
            }
        }

        processed += char
        i++
    }

    // Escape regex special characters except *
    const escaped = processed.replace(/[.+?^${}()|[\]\\'"]/g, '\\$&')

    // Convert unescaped * to .* for wildcard matching
    const withWildcards = escaped.replace(/\*/g, '.*')

    // Convert placeholders back to escaped regex literals
    let regexPattern = withWildcards
        .replace(ESCAPED_STAR_PLACEHOLDER_RE, '\\*')
        .replace(ESCAPED_BACKSLASH_PLACEHOLDER_RE, '\\\\')

    // When a pattern ends with ' *' (space + unescaped wildcard) AND the trailing
    // wildcard is the ONLY unescaped wildcard, make the trailing space-and-args
    // optional so 'git *' matches both 'git add' and bare 'git'.
    // This aligns wildcard matching with prefix rule semantics (git:*).
    // Multi-wildcard patterns like '* run *' are excluded — making the last
    // wildcard optional would incorrectly match 'npm run' (no trailing arg).
    const unescapedStarCount = (processed.match(/\*/g) || []).length
    if (regexPattern.endsWith(' .*') && unescapedStarCount === 1) {
        regexPattern = regexPattern.slice(0, -3) + '( .*)?'
    }

    // Create regex that matches the entire string.
    // The 's' (dotAll) flag makes '.' match newlines, so wildcards match
    // commands containing embedded newlines (e.g. heredoc content after splitCommand_DEPRECATED).
    const flags = 's' + (caseInsensitive ? 'i' : '')
    const regex = new RegExp(`^${regexPattern}$`, flags)

    return regex.test(command)
}
```

**File:** src/utils/permissions/shellRuleMatching.ts (L159-184)

```typescript
export function parsePermissionRule(
    permissionRule: string
): ShellPermissionRule {
    // Check for legacy :* prefix syntax first (backwards compatibility)
    const prefix = permissionRuleExtractPrefix(permissionRule)
    if (prefix !== null) {
        return {
            type: 'prefix',
            prefix,
        }
    }

    // Check for new wildcard syntax (contains * but not :* at end)
    if (hasWildcards(permissionRule)) {
        return {
            type: 'wildcard',
            pattern: permissionRule,
        }
    }

    // Otherwise, it's an exact match
    return {
        type: 'exact',
        command: permissionRule,
    }
}
```

**File:** src/tools/BashTool/bashPermissions.ts (L778-935)

```typescript
function filterRulesByContentsMatchingInput(
    input: z.infer<typeof BashTool.inputSchema>,
    rules: Map<string, PermissionRule>,
    matchMode: 'exact' | 'prefix',
    {
        stripAllEnvVars = false,
        skipCompoundCheck = false,
    }: { stripAllEnvVars?: boolean; skipCompoundCheck?: boolean } = {}
): PermissionRule[] {
    const command = input.command.trim()

    // Strip output redirections for permission matching
    // This allows rules like Bash(python:*) to match "python script.py > output.txt"
    // Security validation of redirection targets happens separately in checkPathConstraints
    const commandWithoutRedirections =
        extractOutputRedirections(command).commandWithoutRedirections

    // For exact matching, try both the original command (to preserve quotes)
    // and the command without redirections (to allow rules without redirections to match)
    // For prefix matching, only use the command without redirections
    const commandsForMatching =
        matchMode === 'exact'
            ? [command, commandWithoutRedirections]
            : [commandWithoutRedirections]

    // Strip safe wrapper commands (timeout, time, nice, nohup) and env vars for matching
    // This allows rules like Bash(npm install:*) to match "timeout 10 npm install foo"
    // or "GOOS=linux go build"
    const commandsToTry = commandsForMatching.flatMap((cmd) => {
        const strippedCommand = stripSafeWrappers(cmd)
        return strippedCommand !== cmd ? [cmd, strippedCommand] : [cmd]
    })

    // SECURITY: For deny/ask rules, also try matching after stripping ALL leading
    // env var prefixes. This prevents bypass via `FOO=bar denied_command` where
    // FOO is not in the safe-list. The safe-list restriction in stripSafeWrappers
    // is intentional for allow rules (see HackerOne #3543050), but deny rules
    // must be harder to circumvent — a denied command should stay denied
    // regardless of env var prefixes.
    //
    // We iteratively apply both stripping operations to all candidates until no
    // new candidates are produced (fixed-point). This handles interleaved patterns
    // like `nohup FOO=bar timeout 5 claude` where:
    //   1. stripSafeWrappers strips `nohup` → `FOO=bar timeout 5 claude`
    //   2. stripAllLeadingEnvVars strips `FOO=bar` → `timeout 5 claude`
    //   3. stripSafeWrappers strips `timeout 5` → `claude` (deny match)
    //
    // Without iteration, single-pass compositions miss multi-layer interleaving.
    if (stripAllEnvVars) {
        const seen = new Set(commandsToTry)
        let startIdx = 0

        // Iterate until no new candidates are produced (fixed-point)
        while (startIdx < commandsToTry.length) {
            const endIdx = commandsToTry.length
            for (let i = startIdx; i < endIdx; i++) {
                const cmd = commandsToTry[i]
                if (!cmd) {
                    continue
                }
                // Try stripping env vars
                const envStripped = stripAllLeadingEnvVars(cmd)
                if (!seen.has(envStripped)) {
                    commandsToTry.push(envStripped)
                    seen.add(envStripped)
                }
                // Try stripping safe wrappers
                const wrapperStripped = stripSafeWrappers(cmd)
                if (!seen.has(wrapperStripped)) {
                    commandsToTry.push(wrapperStripped)
                    seen.add(wrapperStripped)
                }
            }
            startIdx = endIdx
        }
    }

    // Precompute compound-command status for each candidate to avoid re-parsing
    // inside the rule filter loop (which would scale splitCommand calls with
    // rules.length × commandsToTry.length). The compound check only applies to
    // prefix/wildcard matching in 'prefix' mode, and only for allow rules.
    // SECURITY: deny/ask rules must match compound commands so they can't be
    // bypassed by wrapping a denied command in a compound expression.
    const isCompoundCommand = new Map<string, boolean>()
    if (matchMode === 'prefix' && !skipCompoundCheck) {
        for (const cmd of commandsToTry) {
            if (!isCompoundCommand.has(cmd)) {
                isCompoundCommand.set(cmd, splitCommand(cmd).length > 1)
            }
        }
    }

    return Array.from(rules.entries())
        .filter(([ruleContent]) => {
            const bashRule = bashPermissionRule(ruleContent)

            return commandsToTry.some((cmdToMatch) => {
                switch (bashRule.type) {
                    case 'exact':
                        return bashRule.command === cmdToMatch
                    case 'prefix':
                        switch (matchMode) {
                            // In 'exact' mode, only return true if the command exactly matches the prefix rule
                            case 'exact':
                                return bashRule.prefix === cmdToMatch
                            case 'prefix': {
                                // SECURITY: Don't allow prefix rules to match compound commands.
                                // e.g., Bash(cd:*) must NOT match "cd /path && python3 evil.py".
                                // In the normal flow commands are split before reaching here, but
                                // shell escaping can defeat the first splitCommand pass — e.g.,
                                //   cd src\&\& python3 hello.py  →  splitCommand  →  ["cd src&& python3 hello.py"]
                                // which then looks like a single command that starts with "cd ".
                                // Re-splitting the candidate here catches those cases.
                                if (isCompoundCommand.get(cmdToMatch)) {
                                    return false
                                }
                                // Ensure word boundary: prefix must be followed by space or end of string
                                // This prevents "ls:*" from matching "lsof" or "lsattr"
                                if (cmdToMatch === bashRule.prefix) {
                                    return true
                                }
                                if (
                                    cmdToMatch.startsWith(bashRule.prefix + ' ')
                                ) {
                                    return true
                                }
                                // Also match "xargs <prefix>" for bare xargs with no flags.
                                // This allows Bash(grep:*) to match "xargs grep pattern",
                                // and deny rules like Bash(rm:*) to block "xargs rm file".
                                // Natural word-boundary: "xargs -n1 grep" does NOT start with
                                // "xargs grep " so flagged xargs invocations are not matched.
                                const xargsPrefix = 'xargs ' + bashRule.prefix
                                if (cmdToMatch === xargsPrefix) {
                                    return true
                                }
                                return cmdToMatch.startsWith(xargsPrefix + ' ')
                            }
                        }
                        break
                    case 'wildcard':
                        // SECURITY FIX: In exact match mode, wildcards must NOT match because we're
                        // checking the full unparsed command. Wildcard matching on unparsed commands
                        // allows "foo *" to match "foo arg && curl evil.com" since .* matches operators.
                        // Wildcards should only match after splitting into individual subcommands.
                        if (matchMode === 'exact') {
                            return false
                        }
                        // SECURITY: Same as for prefix rules, don't allow wildcard rules to match
                        // compound commands in prefix mode. e.g., Bash(cd *) must not match
                        // "cd /path && python3 evil.py" even though "cd *" pattern would match it.
                        if (isCompoundCommand.get(cmdToMatch)) {
                            return false
                        }
                        // In prefix mode (after splitting), wildcards can safely match subcommands
                        return matchWildcardPattern(
                            bashRule.pattern,
                            cmdToMatch
                        )
                }
            })
        })
        .map(([, rule]) => rule)
}
```

**File:** src/hooks/toolPermission/PermissionContext.ts (L63-73)

```typescript
type ResolveOnce<T> = {
    resolve(value: T): void
    isResolved(): boolean
    /**
     * Atomically check-and-mark as resolved. Returns true if this caller
     * won the race (nobody else has resolved yet), false otherwise.
     * Use this in async callbacks BEFORE awaiting, to close the window
     * between the `isResolved()` check and the actual `resolve()` call.
     */
    claim(): boolean
}
```

**File:** src/hooks/toolPermission/PermissionContext.ts (L75-94)

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

**File:** src/query.ts (L211-211)

```typescript
pendingToolUseSummary: Promise<ToolUseSummaryMessage | null> | undefined
```

**File:** src/query.ts (L428-447)

```typescript
// Project the collapsed context view and maybe commit more collapses.
// Runs BEFORE autocompact so that if collapse gets us under the
// autocompact threshold, autocompact is a no-op and we keep granular
// context instead of a single summary.
//
// Nothing is yielded — the collapsed view is a read-time projection
// over the REPL's full history. Summary messages live in the collapse
// store, not the REPL array. This is what makes collapses persist
// across turns: projectView() replays the commit log on every entry.
// Within a turn, the view flows forward via state.messages at the
// continue site (query.ts:1192), and the next projectView() no-ops
// because the archived messages are already gone from its input.
if (feature('CONTEXT_COLLAPSE') && contextCollapse) {
    const collapseResult = await contextCollapse.applyCollapsesIfNeeded(
        messagesForQuery,
        toolUseContext,
        querySource
    )
    messagesForQuery = collapseResult.messages
}
```

**File:** src/query.ts (L1054-1060)

```typescript
// Yield tool use summary from previous turn — haiku (~1s) resolved during model streaming (5-30s)
if (pendingToolUseSummary) {
    const summary = await pendingToolUseSummary
    if (summary) {
        yield summary
    }
}
```

**File:** src/query.ts (L1085-1117)

```typescript
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
```

**File:** src/query.ts (L1411-1482)

```typescript
// Generate tool use summary after tool batch completes — passed to next recursive call
let nextPendingToolUseSummary: Promise<ToolUseSummaryMessage | null> | undefined
if (
    config.gates.emitToolUseSummaries &&
    toolUseBlocks.length > 0 &&
    !toolUseContext.abortController.signal.aborted &&
    !toolUseContext.agentId // subagents don't surface in mobile UI — skip the Haiku call
) {
    // Extract the last assistant text block for context
    const lastAssistantMessage = assistantMessages.at(-1)
    let lastAssistantText: string | undefined
    if (lastAssistantMessage) {
        const textBlocks = lastAssistantMessage.message.content.filter(
            (block) => block.type === 'text'
        )
        if (textBlocks.length > 0) {
            const lastTextBlock = textBlocks.at(-1)
            if (lastTextBlock && 'text' in lastTextBlock) {
                lastAssistantText = lastTextBlock.text
            }
        }
    }

    // Collect tool info for summary generation
    const toolUseIds = toolUseBlocks.map((block) => block.id)
    const toolInfoForSummary = toolUseBlocks.map((block) => {
        // Find the corresponding tool result
        const toolResult = toolResults.find(
            (result) =>
                result.type === 'user' &&
                Array.isArray(result.message.content) &&
                result.message.content.some(
                    (content) =>
                        content.type === 'tool_result' &&
                        content.tool_use_id === block.id
                )
        )
        const resultContent =
            toolResult?.type === 'user' &&
            Array.isArray(toolResult.message.content)
                ? toolResult.message.content.find(
                      (c): c is ToolResultBlockParam =>
                          c.type === 'tool_result' && c.tool_use_id === block.id
                  )
                : undefined
        return {
            name: block.name,
            input: block.input,
            output:
                resultContent && 'content' in resultContent
                    ? resultContent.content
                    : null,
        }
    })

    // Fire off summary generation without blocking the next API call
    nextPendingToolUseSummary = generateToolUseSummary({
        tools: toolInfoForSummary,
        signal: toolUseContext.abortController.signal,
        isNonInteractiveSession: toolUseContext.options.isNonInteractiveSession,
        lastAssistantText,
    })
        .then((summary) => {
            if (summary) {
                return createToolUseSummaryMessage(summary, toolUseIds)
            }
            return null
        })
        .catch(() => null)
}
```

**File:** src/types/logs.ts (L255-295)

```typescript
export type ContextCollapseCommitEntry = {
    type: 'marble-origami-commit'
    sessionId: UUID
    /** 16-digit collapse ID. Max across entries reseeds the ID counter. */
    collapseId: string
    /** The summary placeholder's uuid — registerSummary() needs it. */
    summaryUuid: string
    /** Full <collapsed id="...">text</collapsed> string for the placeholder. */
    summaryContent: string
    /** Plain summary text for ctx_inspect. */
    summary: string
    /** Span boundaries — projectView finds these in the resumed Message[]. */
    firstArchivedUuid: string
    lastArchivedUuid: string
}

/**
 * Snapshot of the staged queue and spawn trigger state. Unlike commits
 * (append-only, replay-all), snapshots are last-wins — only the most
 * recent snapshot entry is applied on restore. Written after every
 * ctx-agent spawn resolves (when staged contents may have changed).
 *
 * Staged boundaries are UUIDs (session-stable), not collapse IDs (which
 * reset with the uuidToId bimap). Restoring a staged span issues fresh
 * collapse IDs for those messages on the next decorate/display, but the
 * span itself resolves correctly.
 */
export type ContextCollapseSnapshotEntry = {
    type: 'marble-origami-snapshot'
    sessionId: UUID
    staged: Array<{
        startUuid: string
        endUuid: string
        summary: string
        risk: number
        stagedAt: number
    }>
    /** Spawn trigger state — so the +interval clock picks up where it left off. */
    armed: boolean
    lastSpawnTokens: number
}
```

**File:** src/utils/messages.ts (L5105-5116)

```typescript
export function createToolUseSummaryMessage(
    summary: string,
    precedingToolUseIds: string[]
): ToolUseSummaryMessage {
    return {
        type: 'tool_use_summary',
        summary,
        precedingToolUseIds,
        uuid: randomUUID(),
        timestamp: new Date().toISOString(),
    }
}
```

**File:** src/services/toolUseSummary/toolUseSummaryGenerator.ts (L15-24)

```typescript
const TOOL_USE_SUMMARY_SYSTEM_PROMPT = `Write a short summary label describing what these tool calls accomplished. It appears as a single-line row in a mobile app and truncates around 30 characters, so think git-commit-subject, not sentence.

Keep the verb in past tense and the most distinctive noun. Drop articles, connectors, and long location context first.

Examples:
- Searched in auth/
- Fixed NPE in UserService
- Created signup endpoint
- Read config.json
- Ran failing tests`
```
