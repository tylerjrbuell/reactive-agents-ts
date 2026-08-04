# Reactive Agents — CC Harness Improvements Implementation Plan

**Date:** 2026-04-03  
**Status:** Draft — ready for implementation  
**Source research:** `docs/superpowers/specs/2026-04-03-harness-improvements-research.md`  
**Codebase baseline:** v0.8.5+, 3,242 tests, 381 files, kernel composable phase architecture shipped

---

## Executive Summary

Three independent research passes against the Claude Code codebase (Claurst reverse-engineering spec, Anthropic Agent SDK docs, DeepWiki source-level Q&A Sections 1–7) produced 28 concrete findings. Of these, 12 map to active gaps in reactive-agents that affect correctness, token efficiency, or task reliability at scale. The remaining findings either confirm we're already doing the right thing or represent polish/roadmap items.

**The single most impactful change:** The withheld error pattern (P0-1) plus two-stage output token recovery (P0-2) together eliminate an entire class of premature task terminations. CC's harness silently recovers from `max_output_tokens` by escalating to 64k then injecting a continuation prompt — up to 3 times — before surfacing the error. We surface it immediately. This is a correctness bug for any long-form task.

**The highest-leverage efficiency change:** Microcompact (P1-1) with frozen tool result immutability (P1-2) eliminates the LLM cost of compaction for the common case (reading-then-writing files in a single session). CC handles context reduction through two tiers — strip-content (free) and LLM-summarize (expensive) — while we go straight to the expensive path every time.

---

## Current Architecture Mapping

The composable phase architecture shipped April 3 creates clean insertion points for every P0 and P1 item:

```
packages/reasoning/src/strategies/kernel/
  kernel-runner.ts       ← P0-3, P0-4, P1-4 live here (loop control, hook guards)
  kernel-state.ts        ← P0-1, P0-2, P1-4 (state fields: withheld flags, recovery count)
  kernel-hooks.ts        ← P0-4 (api-error hook guard)
  phases/
    context-builder.ts   ← P1-5, P1-6, P1-7, P2-1 (compaction circuit breaker, cache discipline)
    think.ts             ← P0-2 (output token escalation in LLM call path)
    guard.ts             ← P0-3 (hookActive guard injection)
    act.ts               ← P1-2, P1-3 (frozen tool results, two-partition sort)
  utils/
    loop-detector.ts     ← P1-5 (token-delta diminishing returns)
    tool-execution.ts    ← P1-2, P1-3 (frozen categories, stable pool sort)
    
packages/runtime/src/execution-engine.ts  ← P0-1 (withheld error surfacing gate)
packages/memory/                          ← P2-2 (alreadySurfaced cross-turn dedup)
packages/llm-provider/src/               ← P2-3 (effort API field)
packages/reactive-intelligence/          ← P2-4 (createResolveOnce for controller)
```

---

## Priority Tiers

### P0 — Correctness (active regressions, fix immediately)

These are bugs where the current behavior is wrong compared to how a production harness should operate. They cause task failure on valid inputs.

---

#### P0-1: Withheld Error Pattern

**Problem:** `ExecutionEngine` surfaces transient/recoverable errors immediately to EventBus consumers and `agent.run()` callers. A `max_output_tokens` response from the LLM causes the run to terminate and return an error. The harness should retry internally through at least two recovery paths before conceding.

**CC approach:** Errors are withheld from the yield stream during recovery. The loop retries. Only after exhausting all recovery paths does the error get propagated.

**Where it lives in reactive-agents:**
- `packages/runtime/src/execution-engine.ts` — where `runKernel()` result is evaluated and errors are emitted to EventBus
- `packages/reasoning/src/strategies/kernel/kernel-state.ts` — `KernelState` needs `withheldError` and `recoveryCount` fields
- `packages/reasoning/src/strategies/kernel/kernel-runner.ts` — where the loop decides to continue or return

**Implementation:**

Add two fields to `KernelState`:

```typescript
// kernel-state.ts additions
readonly withheldError?: {
  type: 'max_output_tokens' | 'context_too_long' | 'media_size'
  raw: string
  recoveryCount: number   // 0..3, resets on successful next_turn
}
readonly maxOutputTokensOverride?: number  // 64k escalation, fires once per turn
```

Add recovery logic to `kernel-runner.ts` — in the main loop, after the kernel step returns:

```typescript
// If status === 'failed' and error indicates max_output_tokens:
//   1. If maxOutputTokensOverride not set → escalate (set override = 64k, re-run same turn)
//   2. If recoveryCount < 3 → inject recovery message, increment count, continue
//   3. After 3 attempts → allow failure to surface

// Recovery message (verbatim from CC):
const RECOVERY_MESSAGE = 
  "Output token limit hit. Resume directly — no apology, no recap of what you " +
  "were doing. Pick up mid-thought if that is where the cut happened. Break " +
  "remaining work into smaller pieces."
```

The recovery message is injected as a `user` message into `state.messages` before the next think iteration. Do NOT emit `AgentError` to EventBus during recovery — only emit if all recovery paths are exhausted.

**Files to change:** `kernel-state.ts`, `kernel-runner.ts`, `execution-engine.ts`  
**New files:** none  
**Effort:** Medium (3–4 hours)

---

#### P0-2: Two-Stage `max_output_tokens` Recovery

**Problem:** We retry on token limit errors with the same `maxOutputTokens` value that just failed. Stage 1 (escalate to 64k) will succeed in most cases where the model simply needed more room for the current response. Without Stage 1 we go straight to Stage 2 (conversation injection) which is more disruptive.

**CC approach:**
1. Stage 1: Re-issue the exact same LLM request with `maxOutputTokens = 64000`. No message injection. Fires once per turn, guarded by `maxOutputTokensOverride`.
2. Stage 2: Inject recovery message and continue the conversation. Fires up to 3 times, counted by `maxOutputTokensRecoveryCount`. **Resets to 0 on `next_turn`** (when a successful tool-use response comes back).

**Where it lives in reactive-agents:**
- `packages/reasoning/src/strategies/kernel/phases/think.ts` — where the LLM `complete()` call is made
- `packages/reasoning/src/strategies/kernel/kernel-state.ts` — the two guard fields

**Implementation:**

In `think.ts`, detect the `max_output_tokens` stop reason in the LLM response. If detected:

```typescript
// Stage 1: escalate once
if (!state.maxOutputTokensOverride) {
  return transitionState(state, {
    status: 'thinking',
    maxOutputTokensOverride: 64_000,
    withheldError: { type: 'max_output_tokens', raw: response.stopReason, recoveryCount: 0 }
  })
}

// Stage 2: inject recovery message (up to 3 times)
if ((state.withheldError?.recoveryCount ?? 0) < 3) {
  const updatedMessages = [...state.messages, {
    role: 'user' as const,
    content: RECOVERY_MESSAGE
  }]
  return transitionState(state, {
    status: 'thinking',
    messages: updatedMessages,
    withheldError: { 
      ...state.withheldError!,
      recoveryCount: (state.withheldError?.recoveryCount ?? 0) + 1
    }
  })
}

// Exhausted — surface the error
return transitionState(state, { status: 'failed', error: 'Max output tokens limit hit after recovery attempts' })
```

Reset `withheldError.recoveryCount` to 0 when a turn completes successfully with tool calls (in `act.ts` or `kernel-runner.ts`).

**Files to change:** `kernel-state.ts`, `phases/think.ts`, `kernel-runner.ts`  
**Effort:** Small (2 hours, builds on P0-1 fields)

---

#### P0-3: Hook Infinite Loop Prevention — `hookActive` Flag

**Problem:** `KernelHooks` runs post-kernel processing unconditionally. When a hook fires and causes the loop to continue (e.g., a hook that injects a correction and forces another iteration), the hook will fire again on that next iteration, potentially creating an unbounded loop. CC fixed a production incident (estimated ~250K wasted API calls/day) by adding the `stopHookActive` flag.

**CC approach:**  
- `stopHookActive: true` is set when a stop hook causes continuation. Hooks can inspect this and skip processing.
- `hasAttemptedReactiveCompact: boolean` is **preserved** (not reset) across `stop_hook_blocking` transitions. Resetting it would allow: compact → still-413 → hook fires → compact again → infinite loop.

**Where it lives in reactive-agents:**
- `packages/reasoning/src/strategies/kernel/kernel-state.ts` — needs `hookActive` field
- `packages/reasoning/src/strategies/kernel/kernel-runner.ts` — needs to set the flag before calling hooks and reset after
- `packages/reasoning/src/strategies/kernel/kernel-hooks.ts` — hooks need to check the flag

**Implementation:**

Add to `KernelState`:

```typescript
readonly hookActive?: boolean    // guards against re-entrant hook triggering
readonly hasAttemptedCompaction?: boolean  // preserved across hook-triggered continuations
```

In `kernel-runner.ts`, before executing post-step hooks:

```typescript
// Set hookActive before running hooks
const stateWithHookFlag = transitionState(state, { hookActive: true })
const afterHooks = yield* executeKernelHooks(stateWithHookFlag, context, hooks)
// Clear hookActive after hooks complete
return transitionState(afterHooks, { hookActive: false })
```

If a hook causes continuation (e.g., by injecting a blocking error), the `hasAttemptedCompaction` flag must be carried through — NOT reset to `false`. In `kernel-runner.ts` loop continuation logic:

```typescript
// When hook causes continuation:
const nextState = transitionState(afterHooks, {
  hookActive: undefined,
  hasAttemptedCompaction: state.hasAttemptedCompaction, // PRESERVE — never reset
})
```

**Files to change:** `kernel-state.ts`, `kernel-runner.ts`, `kernel-hooks.ts`  
**Effort:** Small (2 hours)

---

#### P0-4: API Error → Skip Hooks Guard

**Problem:** When the last message in the conversation is an API error (not a model response), running post-step hooks on that state creates a death spiral. The hooks evaluate a response that was never produced by the model.

**CC approach:**  
> _"The model never produced a real response — hooks evaluating it create a death spiral."_  
On `lastMessage.isApiErrorMessage === true`, CC runs `StopFailure` hooks only (not normal stop hooks) and returns `'completed'` immediately — skipping all other post-processing.

**Where it lives in reactive-agents:**
- `packages/reasoning/src/strategies/kernel/kernel-runner.ts` — main loop, post-step hook execution branch
- `packages/reasoning/src/strategies/kernel/kernel-hooks.ts` — hook type discrimination

**Implementation:**

In `kernel-runner.ts`, after each kernel step:

```typescript
const isApiError = step.error?.startsWith('[API_ERROR]') || 
                   step.meta?.errorType === 'api_error'

if (isApiError) {
  // Run only failure hooks, skip all stop/completion hooks
  yield* hooks.onError?.(state, new Error(step.error ?? 'API error'))
  // Return immediately — do NOT run completion hooks, do NOT continue loop
  return transitionState(state, { status: 'failed', error: step.error })
}
```

This requires tagging API errors distinctly from tool errors in the kernel step output. Add `errorType: 'api_error' | 'tool_error' | 'guard_error'` to `ReasoningStep.meta`.

**Files to change:** `kernel-runner.ts`, `kernel-hooks.ts`, step-utils.ts (for error tagging)  
**Effort:** Small (1–2 hours)

---

#### P0-5: Compaction Circuit Breaker

**Problem:** We have no limit on consecutive compaction failures. A context that is irrecoverably over the token limit will retry compaction indefinitely, burning API calls.

**CC background:** 1,279 production sessions had 50+ consecutive autocompact failures (up to 3,272 per session), wasting ~250K API calls/day. CC added `MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3`.

**Where it lives in reactive-agents:**
- `packages/reasoning/src/strategies/kernel/phases/context-builder.ts` — where compaction is triggered

**Implementation:**

Add to `KernelState`:

```typescript
readonly consecutiveCompactionFailures: number  // 0..MAX, resets on success
```

In `context-builder.ts`:

```typescript
const MAX_CONSECUTIVE_COMPACTION_FAILURES = 3

if (state.consecutiveCompactionFailures >= MAX_CONSECUTIVE_COMPACTION_FAILURES) {
  // Stop retrying — continue with current (over-limit) context
  // Log a warning but do NOT throw / abort
  context.hooks?.onWarning?.('compaction_circuit_breaker', 
    `${MAX_CONSECUTIVE_COMPACTION_FAILURES} consecutive compaction failures — skipping`)
  return state
}
```

Reset counter on successful compaction. Increment on failure (catch block around compaction call).

**Files to change:** `kernel-state.ts`, `phases/context-builder.ts`  
**Effort:** Very small (1 hour)

---

### P1 — Reliability & Efficiency (token cost + production reliability)

These changes directly reduce token spend and improve reliability on multi-turn tasks. No correctness bugs, but measurable impact on cost and success rate for long runs.

---

#### P1-1: Microcompact — Two-Tier Compaction

**Problem:** Our only compaction path is full LLM summarization, which consumes ~20K output tokens per compact. CC uses a cheaper first-pass (microcompact) that strips tool result content without any LLM call — just direct message mutation. LLM summarization only runs when microcompact isn't enough.

**CC implementation details:**
- Eligible tool types: file-read, shell, grep, glob, web-search, web-fetch, file-edit, file-write
- Algorithm: collect all eligible tool result IDs, keep the last `N` (floor at 1 — critical: `slice(-0)` returns full array, which is a bug to avoid), replace the rest with `'[Old tool result content cleared]'`
- Path 2 (cached API): queue `cache_edits` blocks instead of mutating locally — defers the boundary message until after the API response confirms `cache_deleted_input_tokens`

**Where it lives in reactive-agents:**
- New file: `packages/reasoning/src/strategies/kernel/utils/micro-compact.ts`
- Called from: `packages/reasoning/src/strategies/kernel/phases/context-builder.ts`

**Implementation:**

```typescript
// micro-compact.ts
const MICROCOMPACTABLE_TOOLS = new Set([
  'file-read', 'file-write', 'file-edit', 
  'bash', 'shell', 'execute-code',
  'grep', 'glob', 
  'web-search', 'web-fetch',
])

export interface MicroCompactOptions {
  keepRecentN: number    // how many recent tool results to preserve (floor: 1)
  replacementText: string  // '[Old tool result content cleared]'
}

export function microCompactMessages(
  messages: readonly KernelMessage[],
  options: MicroCompactOptions,
): readonly KernelMessage[] {
  // 1. Collect all tool_result message indices for compactable tools
  const eligible: number[] = []
  messages.forEach((msg, i) => {
    if (msg.role === 'tool_result' && MICROCOMPACTABLE_TOOLS.has(msg.toolName)) {
      eligible.push(i)
    }
  })

  // 2. Keep the most recent N (floor at 1 to avoid slice(-0) bug)
  const keepN = Math.max(1, options.keepRecentN)
  const toReplace = eligible.slice(0, -keepN)  // all but last keepN
  
  if (toReplace.length === 0) return messages

  // 3. Replace eligible old results
  const toReplaceSet = new Set(toReplace)
  return messages.map((msg, i) =>
    toReplaceSet.has(i)
      ? { ...msg, content: options.replacementText }
      : msg
  )
}
```

In `context-builder.ts`, check token estimate before deciding whether to run LLM compaction:

```typescript
// If token count > WARNING_THRESHOLD but < AUTOCOMPACT_THRESHOLD:
//   Try microcompact first (zero LLM cost)
//   Re-estimate tokens after microcompact
//   If still over: run LLM autocompact

// WARNING_THRESHOLD  = effectiveContextWindow - 20_000
// AUTOCOMPACT_THRESHOLD = effectiveContextWindow - 13_000
```

**Files to change:** `phases/context-builder.ts`  
**New files:** `utils/micro-compact.ts`  
**Effort:** Medium (3–4 hours)

---

#### P1-2: Frozen Tool Result Immutability

**Problem:** Our tool result compression re-evaluates every turn which may bust prompt cache. Once a tool result has been "seen but not replaced" by the compressor, that decision must be final — the server has cached the prefix containing that full result.

**CC approach:** Three categories from `partitionByPriorDecision()`:
- `mustReapply` — previously replaced → always re-apply the cached replacement text (byte-identical)
- `frozen` — seen but NOT replaced → NEVER replace (would bust the already-cached prefix)
- `fresh` — never seen → eligible for compression; replace largest first (greedy until under budget)

**Where it lives in reactive-agents:**
- `packages/reasoning/src/strategies/kernel/utils/tool-execution.ts` — tool result compression
- `packages/reasoning/src/strategies/kernel/kernel-state.ts` — needs a set of frozen tool result IDs

**Implementation:**

Add to `KernelState`:

```typescript
// Immutability model for tool result compression
readonly frozenToolResultIds: ReadonlySet<string>   // seen but NOT compressed — never compress
readonly replacedToolResultIds: ReadonlyMap<string, string>  // id → replacement text (must re-apply)
```

In `tool-execution.ts`, before deciding whether to compress a tool result:

```typescript
function partitionToolResults(
  results: ToolResult[],
  state: KernelState,
): { mustReapply: ToolResult[], frozen: ToolResult[], fresh: ToolResult[] } {
  return results.reduce((acc, result) => {
    if (state.replacedToolResultIds.has(result.id)) {
      acc.mustReapply.push(result)  // always re-apply, byte-identical
    } else if (state.frozenToolResultIds.has(result.id)) {
      acc.frozen.push(result)       // never compress
    } else {
      acc.fresh.push(result)        // eligible for compression
    }
    return acc
  }, { mustReapply: [], frozen: [], fresh: [] })
}
```

After each compression decision, update `frozenToolResultIds` and `replacedToolResultIds` in the returned `KernelState`. Results that were considered for compression but NOT compressed (because they were under budget) become `frozen`.

**Files to change:** `kernel-state.ts`, `utils/tool-execution.ts`  
**Effort:** Medium (3 hours)

---

#### P1-3: Tool Pool Stability — Two-Partition Sort

**Problem:** We sort our tool list as a flat array by name. When MCP tools are registered mid-session, they may sort alphabetically between existing built-in tools, invalidating the server-side cache prefix for all subsequent API calls.

**CC approach:** Two-partition sort — built-in tools form a stable alphabetical prefix; MCP tools form a stable alphabetical suffix. This preserves the server-side cache breakpoint that sits after the last built-in tool.

**Where it lives in reactive-agents:**
- `packages/reasoning/src/strategies/kernel/utils/tool-utils.ts` — tool list assembly before API call

**Implementation:**

```typescript
// tool-utils.ts
export function buildStableToolPool(
  builtInTools: ToolSchema[],
  mcpTools: ToolSchema[],
): ToolSchema[] {
  const byName = (a: ToolSchema, b: ToolSchema) => a.name.localeCompare(b.name)
  
  // Deduplicate: built-in wins on name conflict
  const builtInNames = new Set(builtInTools.map(t => t.name))
  const filteredMcp = mcpTools.filter(t => !builtInNames.has(t.name))
  
  return [
    ...builtInTools.sort(byName),    // stable prefix (server cache breakpoint here)
    ...filteredMcp.sort(byName),     // stable suffix
  ]
}
```

Replace the current flat sort in the tool pool assembly with this two-partition version.

**Files to change:** `utils/tool-utils.ts`  
**Effort:** Very small (30 min)

---

#### P1-4: `hasAttemptedCompaction` Preserved Across Hook Continuations

This is documented under P0-3 but is a separate state field that needs its own careful implementation. The key invariant:

**The `hasAttemptedCompaction` flag must NEVER be reset on hook-triggered loop continuation.** Only reset it when the conversation genuinely moves to the next user-initiated turn (a tool call succeeds and the loop continues normally via `next_turn`).

In `kernel-runner.ts`, the continuation logic has two paths:
1. Normal tool-use continuation (`next_turn`): reset `hasAttemptedCompaction = false`
2. Hook-blocking continuation (`stop_hook_blocking`): **carry forward** `hasAttemptedCompaction` unchanged

```typescript
// In the main loop, when deciding how to continue:
const isHookBlockingContinuation = /* hook caused the continuation */
const nextHasAttemptedCompaction = isHookBlockingContinuation
  ? state.hasAttemptedCompaction   // PRESERVE
  : false                          // reset only on real next_turn
```

**Files to change:** `kernel-runner.ts`, `kernel-state.ts`  
**Effort:** Very small (part of P0-3)

---

#### P1-5: Token-Delta Diminishing Returns Guard

**Problem:** We have entropy sensor trajectory analysis (converging/diverging/oscillating) but lack the simple token-delta "spinning" guard. Entropy is richer but costlier to compute. Token delta is free and catches the specific pathology where the model is generating text but not making progress.

**CC exact constants:**
```
COMPLETION_THRESHOLD = 0.9  (90% of token budget)
DIMINISHING_THRESHOLD = 500  (tokens)
continuationCount >= 3       (at least 3 prior continuations before triggering)
2 consecutive sub-threshold checks required (not just 1)
```

**Nudge message:** `"Stopped at X% of token target (Y / Z). Keep working — do not summarize."`

**Where it lives in reactive-agents:**
- `packages/reasoning/src/strategies/kernel/utils/loop-detector.ts` — add `detectDiminishingReturns()`

**Implementation:**

```typescript
// loop-detector.ts addition
export interface TokenDeltaTracker {
  continuationCount: number
  lastDeltaTokens: number     // token delta from the immediately preceding check
  totalTokens: number
  tokenBudget: number
}

export function detectDiminishingReturns(tracker: TokenDeltaTracker): {
  isDiminishing: boolean
  shouldContinue: boolean     // false = inject nudge, true = normal
  nudgeMessage?: string
} {
  const COMPLETION_THRESHOLD = 0.9
  const DIMINISHING_THRESHOLD = 500
  
  const budgetUsed = tracker.totalTokens / tracker.tokenBudget
  const currentDelta = tracker.totalTokens - (tracker.totalTokens - tracker.lastDeltaTokens)
  
  const isDiminishing =
    tracker.continuationCount >= 3 &&
    currentDelta < DIMINISHING_THRESHOLD &&
    tracker.lastDeltaTokens < DIMINISHING_THRESHOLD  // 2 consecutive checks
  
  if (budgetUsed >= COMPLETION_THRESHOLD) {
    if (isDiminishing) {
      return {
        isDiminishing: true,
        shouldContinue: true,
        nudgeMessage: `Stopped at ${Math.round(budgetUsed * 100)}% of token target ` +
          `(${tracker.totalTokens} / ${tracker.tokenBudget}). ` +
          `Keep working — do not summarize.`
      }
    }
  }
  
  return { isDiminishing: false, shouldContinue: true }
}
```

This complements the entropy sensor — entropy catches semantic spinning, token-delta catches output spinning. Run both. If entropy says `diverging` AND delta is diminishing, that's a strong `early_stop` signal.

**Files to change:** `utils/loop-detector.ts`, `kernel-runner.ts` (to thread tracker through iterations)  
**Effort:** Small (2 hours)

---

#### P1-6: System Prompt Cache Discipline

**Problem:** `buildStaticContext`/`buildDynamicContext` in `context-builder.ts` compute all sections every turn without distinguishing cache-stable vs cache-breaking sections. MCP tool instructions in particular change when tools connect/disconnect, but we don't mark them as intentionally uncached — we just silently break the cache.

**CC approach:** Two explicit tiers:
- `systemPromptSection()` — memoized, cache-stable (session guidance, memory)
- `DANGEROUS_uncachedSystemPromptSection('reason')` — recomputes every turn, requires a justification string

**Where it lives in reactive-agents:**
- `packages/reasoning/src/strategies/kernel/phases/context-builder.ts` — system prompt assembly

**Implementation:**

Add a cache-discipline wrapper in `context-builder.ts`:

```typescript
// Memoized sections (stable across the session)
const SESSION_STABLE_SECTIONS = ['base_instructions', 'persona', 'tool_guidance', 'harness_skill']

// Cache-breaking sections (change between turns — requires justification)
const TURN_VARIABLE_SECTIONS = {
  'mcp_instructions': 'MCP servers connect/disconnect between turns',
  'dynamic_context': 'Context window pressure changes per turn',
  'task_context': 'Task context injected per-run',
}
```

In practice this means building the system prompt in two arrays: a stable prefix (memoized for the session) and a dynamic suffix (rebuilt each turn). The cache break point sits between them, and only the dynamic suffix needs re-caching each turn.

This is especially impactful for Anthropic's prompt caching — the cache prefix must be byte-identical on every turn. Any change to session-stable content resets the cache for the entire session.

**Files to change:** `phases/context-builder.ts`  
**Effort:** Medium (2–3 hours)

---

#### P1-7: CompactBoundaryMessage — Scan at Top of Loop

**Problem:** After a compaction, the kernel should slice the message history from the compact boundary forward — not re-process already-summarized history. We don't have this scan.

**CC approach:** `getMessagesAfterCompactBoundary()` is called at the **top of every loop iteration** — scans backward for the last `compact_boundary` system message and returns only the slice from that point forward.

**Where it lives in reactive-agents:**
- `packages/reasoning/src/strategies/kernel/phases/context-builder.ts` — top of context assembly
- `packages/reasoning/src/strategies/kernel/kernel-state.ts` — `CompactBoundaryMessage` type

**Implementation:**

After compaction completes, insert a sentinel message into `state.messages`:

```typescript
// In context-builder.ts, after successful compaction:
const boundaryMessage: KernelMessage = {
  role: 'user',
  content: JSON.stringify({
    type: 'compact_boundary',
    trigger: 'auto',
    preTokens: estimatedTokensBefore,
    messagesSummarized: compactedCount,
  }),
}
// prepend the summary + boundary; discard old messages
const newMessages: KernelMessage[] = [
  { role: 'user', content: `[Previous context summary]\n\n${summary}` },
  boundaryMessage,
  ...messagesAfterBoundary,  // only post-compaction messages
]
```

At the top of the `context-builder` phase, scan backward for the last boundary:

```typescript
function getMessagesAfterCompactBoundary(messages: readonly KernelMessage[]): readonly KernelMessage[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role === 'user' && msg.content.includes('"type":"compact_boundary"')) {
      return messages.slice(i + 1)  // everything after the boundary
    }
  }
  return messages  // no boundary found — return all messages
}
```

**Files to change:** `kernel-state.ts`, `phases/context-builder.ts`  
**Effort:** Small (2 hours)

---

### P2 — Quality & DX (correctness improvements, better outputs)

These improve output quality and developer ergonomics. No active regressions, but meaningful improvements for production workloads.

---

#### P2-1: 9-Section Compact Summarization Prompt

**Problem:** Our `DebriefSynthesizer` has a post-run structure optimized for reporting findings, not for continuation context. CC's compact summarization prompt is specifically tuned to produce a summary that lets the loop resume mid-task.

**CC's 9 sections** (in priority order for the model):
1. Primary Request and Intent — all explicit user requests, in detail
2. Key Technical Concepts — technologies/frameworks discussed
3. Files and Code Sections — specific files with full code snippets; "pay special attention to the most recent messages"
4. Errors and Fixes — all errors and how they were fixed; "pay special attention to specific user feedback"
5. Problem Solving — problems solved and ongoing troubleshooting
6. All User Messages — list ALL non-tool-result user messages (critical for tracking changing intent)
7. Pending Tasks — explicitly requested tasks not yet completed
8. Current Work — "describe in detail precisely what was being worked on immediately before this summary"
9. Optional Next Step — "IMPORTANT: ensure this step is DIRECTLY in line with the user's most recent explicit request. If your last task was concluded, only list next steps if explicitly in line with the user's request."

**Additional CC details:**
- System prompt for the compact call: `"You are a helpful AI assistant tasked with summarizing conversations."` with `thinkingConfig: { type: 'disabled' }`
- Model writes `<analysis>` scratchpad first, which is stripped before injection
- `CLAUDE.md` is NOT directly referenced in the summarization — the prompt looks for a `## Compact Instructions` section in included context

**Where it lives in reactive-agents:**
- `packages/reasoning/src/strategies/kernel/phases/context-builder.ts` — autocompact call
- Consider a shared `packages/runtime/src/compaction/` directory

**Implementation:**

Extract the LLM compaction prompt into a dedicated constant:

```typescript
// compaction-prompt.ts
export const COMPACT_SUMMARIZATION_SYSTEM = 
  "You are a helpful AI assistant tasked with summarizing conversations."

export function buildCompactSummarizationPrompt(conversationText: string): string {
  return `Your task is to create a detailed summary of the conversation above.
  
First, write your analysis in <analysis></analysis> tags.

Then produce a summary with EXACTLY these 9 sections:

## 1. Primary Request and Intent
[All explicit requests made in this conversation, in detail]

## 2. Key Technical Concepts
[All technologies, frameworks, libraries, APIs discussed]

## 3. Files and Code Sections
[Every file examined, modified, or created. Include full code snippets for critical sections.
Pay special attention to the most recent messages.]

## 4. Errors and Fixes
[Every error encountered and exactly how it was resolved.
Pay special attention to specific user feedback about what was wrong.]

## 5. Problem Solving
[Problems that were solved, and any ongoing troubleshooting]

## 6. All User Messages
[LIST ALL user messages that are not tool results, in order]

## 7. Pending Tasks
[Tasks that were explicitly requested but not yet completed]

## 8. Current Work
[Describe in detail precisely what was being worked on immediately before this summary.
Include which file, which function, what change was being made.]

## 9. Optional Next Step
[IMPORTANT: ensure this step is DIRECTLY in line with the user's most recent explicit request.
If the last task was concluded, only list next steps if explicitly in line with the request.
Do not start on tangential requests without confirming with the user.]

Conversation to summarize:
${conversationText}`
}
```

**Files to change:** `phases/context-builder.ts`  
**New files:** `utils/compaction-prompt.ts`  
**Effort:** Small (1–2 hours)

---

#### P2-2: Memory `alreadySurfaced` Cross-Turn Dedup

**Problem:** We use FTS5 + sqlite-vec KNN for memory retrieval but lack the cross-turn deduplication guard. We may resurface the same memory files on every turn, wasting tokens on files the model already has in context.

**CC approach:**
- `alreadySurfaced: ReadonlySet<string>` of absolute file paths
- Populated by `collectSurfacedMemories()` — scans all messages for `relevant_memories` attachment objects and collects their `.path` fields
- Passed to Pass 2 (LLM selection) as exclusion filter
- Selection budget (5 files max) spends on fresh candidates only

**Where it lives in reactive-agents:**
- `packages/memory/src/` — `SkillResolverService` or wherever memory injection happens

**Implementation:**

Thread a `surfacedMemories: Set<string>` through the execution context. After each memory injection:

```typescript
// Track which memory files have been injected this session
const surfacedThisTurn = new Set(injectedMemories.map(m => m.path))
const updatedSurfaced = new Set([...existingSurfaced, ...surfacedThisTurn])

// On the next memory retrieval pass:
const candidates = await retrieveCandidates(query, { limit: 200 })
const fresh = candidates.filter(c => !updatedSurfaced.has(c.path))
const selected = await llmSelectMemories(fresh, { maxFiles: 5 })
```

**Freshness warning — exact CC text:**
```
This memory is ${d} days old. Memories are point-in-time observations, not
live state — claims about code behavior or file:line citations may be outdated.
Verify against current code before asserting as fact.
```
Triggers when `memoryAgeDays(mtime) > 1`. Fresh memories (≤1 day) get: `Memory (saved ${age}): ${path}:`.

**Also add to memory selection prompt:**  
_"If a list of recently-used tools is provided, do not select memories that are API documentation for those tools (the agent is already exercising them). DO still select memories containing warnings, gotchas, or known issues about those tools — active use is exactly when those matter."_

**Files to change:** `packages/memory/src/` (selection logic), `packages/runtime/src/execution-engine.ts` (thread surfaced set)  
**Effort:** Medium (3 hours)

---

#### P2-3: Effort API Field on Providers

**Problem:** We have complexity routing in `@reactive-agents/cost` that categorizes tasks as simple/complex, but we never send an `effort` signal to the provider. CC's `effort` field (`low|medium|high|max`) maps directly to `output_config.effort` — a beta API field that controls model output behavior independent of thinking budget.

**Key CC detail:** `effort` is NOT a thinking budget or temperature change. It is `output_config.effort` on the Anthropic beta API. `max` is downgraded to `high` on non-Opus-4.6 models (the API rejects `max` on others).

**Where it lives in reactive-agents:**
- `packages/llm-provider/src/providers/anthropic.ts` — `complete()` and `stream()` API call construction

**Implementation:**

Add `effort?: 'low' | 'medium' | 'high' | 'max'` to `LLMCompleteOptions`. In the Anthropic provider:

```typescript
// In anthropic.ts complete() / stream():
if (options.effort) {
  const model = options.model ?? this.config.model
  const resolvedEffort = 
    options.effort === 'max' && !isOpus46(model) ? 'high' : options.effort
  
  requestBody.output_config = { effort: resolvedEffort }
  betas.push('output-config-2025-04-01')  // beta header required
}
```

Expose this through the builder:

```typescript
// ReactiveAgentBuilder
.withEffort('high')   // 'low' | 'medium' | 'high' | 'max'
```

Integrate with `@reactive-agents/cost` complexity routing: simple tasks → `low` effort (faster + cheaper), complex tasks → `high` or `max`.

**Files to change:** `packages/llm-provider/src/providers/anthropic.ts`, `packages/runtime/src/builder.ts`  
**Effort:** Small (2 hours)

---

#### P2-4: `createResolveOnce` Claim Semantics for Reactive Controller

**Problem:** Our `IntelligenceControlSurface` has 10 concurrent evaluators that may fire decisions simultaneously. Last-writer-wins is the current behavior, which means a cheaper/faster evaluator may overwrite a more authoritative one that fires 10ms later.

**CC approach for concurrent decisions:**

```typescript
function createResolveOnce<T>(resolve: (value: T) => void): ResolveOnce<T> {
  let claimed = false
  let delivered = false
  return {
    resolve(value: T) {
      if (delivered) return
      delivered = true; claimed = true
      resolve(value)
    },
    isResolved() { return claimed },
    claim() {
      if (claimed) return false
      claimed = true
      return true
    }
  }
}
```

The `claim()` / `deliver()` separation closes the window between "check if claimed" and "deliver value" in concurrent async handlers.

**Where it lives in reactive-agents:**
- `packages/reactive-intelligence/src/` — `IntelligenceControlSurface`, controller decision dispatch

**Implementation:**

When multiple evaluators produce decisions in the same iteration, use `createResolveOnce` to ensure first-claimer wins:

```typescript
// reactive-controller.ts
const decisionResolver = createResolveOnce(applyControllerDecision)

evaluators.forEach(evaluator => {
  evaluator.evaluate(state).then(decision => {
    if (decision && decisionResolver.claim()) {
      decisionResolver.resolve(decision)
    }
  })
})
```

Priority-ordered evaluators can still pre-empt: have high-priority evaluators attempt `claim()` first (they run first in the Promise chain). Low-priority evaluators check `isResolved()` before doing expensive work.

**Files to change:** `packages/reactive-intelligence/src/controller/`  
**New files:** `packages/reactive-intelligence/src/utils/resolve-once.ts`  
**Effort:** Small (2 hours)

---

### P3 — Polish (nice-to-have, roadmap items)

These are real improvements but lower ROI than P0–P2. Add to roadmap but don't block V1.0.

---

#### P3-1: AutoDream Gating for `MemoryConsolidatorService`

Our `MemoryConsolidatorService` lacks the multi-gate sequencing that prevents runaway consolidation. CC's gate sequence (cheapest first):

1. Time gate: 24h since last consolidation
2. Scan throttle: rate-limit within-session scan attempts
3. Session count gate: at least 5 sessions (excluding current) since last consolidation  
4. Mutex acquisition: `.consolidate-lock`, body = PID, stale = 1 hour, last-writer-wins

Without these gates, consolidation may fire too eagerly — after every session, regardless of whether enough signal has accumulated.

The LLM-agent-driven consolidation prompt (4 phases: Orient → Gather → Consolidate → Prune) documented verbatim in the research doc is superior to our rule-based compaction for the specific case of memory maintenance. Consider adopting for `SkillEvolutionService` refinement cadence as well.

**Where to add:** `packages/memory/src/memory-consolidator.ts`

---

#### P3-2: Async Tool Summary Label (Haiku pattern)

Our `StreamCompleted.toolSummary` is generated synchronously at the end of the run. CC generates tool summaries asynchronously during execution — a Haiku call fires after tool execution completes and resolves at the top of the **next** iteration. This means the summary is ready earlier and doesn't block the response.

The Haiku system prompt that produces ~30 char labels:
> "Write a short summary label describing what these tool calls accomplished. It appears as a single-line row in a mobile app and truncates around 30 characters, so think git-commit-subject, not sentence. Keep the verb in past tense and the most distinctive noun. Examples: 'Searched in auth/', 'Fixed NPE in UserService', 'Created signup endpoint'"

Consider adopting this for `IterationProgress` events — each iteration could carry a `label` field with a Haiku-generated git-commit-style description of what happened.

---

#### P3-3: Local Settings Layer

Add a `localSettings` concept (gitignored `.reactive-agents.local.json` per project) alongside the existing global and project settings. This lets developers override settings locally without committing them. Particularly useful for API keys, model overrides, and verbosity settings in team environments.

---

#### P3-4: `pendingToolUseSummary` Resolve-at-Next-Iteration Pattern

CC resolves `pendingToolUseSummary` at the top of the NEXT loop iteration (not when it was created). This means the async Haiku call has a full iteration's worth of time to complete before being awaited. Consider adopting this deferred-resolution pattern for any async enrichment that can be fire-and-forget during tool execution.

---

## Implementation Order

### Phase 1: P0 corrections (week 1)

These fix active bugs. Do them in order — each builds on state fields added by the previous.

1. **P0-5** (circuit breaker) — 1h, simplest, standalone
2. **P0-4** (API error → skip hooks) — 1–2h, requires error tagging in step-utils
3. **P0-3** (hookActive flag) — 2h, adds two KernelState fields
4. **P0-1** (withheld error) — 3–4h, core pattern, builds on P0-3's state fields
5. **P0-2** (two-stage recovery) — 2h, builds directly on P0-1's state fields

After Phase 1: run full test suite. All P0 changes are additions (new state fields + new conditional branches) — no existing logic is modified destructively.

### Phase 2: P1 efficiency (week 2)

6. **P1-3** (two-partition sort) — 30min, zero risk
7. **P1-4** (preserve compaction flag) — 30min, part of P0-3 PR if convenient
8. **P1-7** (compact boundary scan) — 2h, needed before P1-1
9. **P1-2** (frozen tool results) — 3h, requires new KernelState fields
10. **P1-5** (token-delta guard) — 2h, loop-detector addition
11. **P1-6** (cache discipline) — 2–3h, context-builder refactor
12. **P1-1** (microcompact) — 3–4h, new utility + integration

### Phase 3: P2 quality (week 3)

13. **P2-3** (effort API field) — 2h, provider + builder
14. **P2-1** (compact summarization prompt) — 1–2h, prompt extraction
15. **P2-4** (createResolveOnce) — 2h, reactive-intelligence
16. **P2-2** (alreadySurfaced memory dedup) — 3h, memory package

### Phase 4: P3 polish (ongoing)

17. P3-3 (local settings) — add to builder settings system
18. P3-1 (AutoDream gating) — memory consolidator improvement
19. P3-2 (async tool label) — IterationProgress event enhancement
20. P3-4 (deferred resolve pattern) — async enrichment cleanup

---

## Key Numbers Reference

Constants worth enshrining in a `harness-constants.ts`:

```typescript
// Context management
export const MAX_TOOL_RESULTS_PER_MESSAGE_CHARS = 200_000
export const AUTOCOMPACT_BUFFER_TOKENS = 13_000      // effectiveContextWindow - this = threshold
export const WARNING_THRESHOLD_BUFFER_TOKENS = 20_000
export const MAX_CONSECUTIVE_COMPACTION_FAILURES = 3

// Output token recovery
export const MAX_OUTPUT_TOKENS_ESCALATION = 64_000   // Stage 1 escalation target
export const MAX_OUTPUT_TOKENS_RECOVERY_LIMIT = 3    // Stage 2 max retries
export const RECOVERY_MESSAGE = 
  "Output token limit hit. Resume directly — no apology, no recap of what you " +
  "were doing. Pick up mid-thought if that is where the cut happened. Break " +
  "remaining work into smaller pieces."

// Token-delta diminishing returns
export const COMPLETION_THRESHOLD = 0.9              // 90% of token budget
export const DIMINISHING_THRESHOLD = 500             // tokens per continuation check
export const DIMINISHING_MIN_CONTINUATIONS = 3       // minimum continuations before checking

// Memory
export const MEMORY_FILE_SCAN_LIMIT = 200
export const MEMORY_FRONTMATTER_SCAN_DEPTH = 30      // lines
export const MEMORY_SELECTION_MAX = 5                // files per turn
export const MEMORY_FRESHNESS_THRESHOLD_DAYS = 1     // > 1 day → freshness warning

// Hooks
export const HOOK_DEFAULT_TIMEOUT_MS = 600_000       // 10 min
export const SESSION_END_HOOK_TIMEOUT_MS = 1_500
export const PROMPT_HOOK_TIMEOUT_MS = 30_000
export const AGENT_HOOK_TIMEOUT_MS = 60_000

// AutoDream
export const AUTODREAM_MIN_HOURS = 24
export const AUTODREAM_MIN_SESSIONS = 5
export const AUTODREAM_LOCK_STALE_MS = 3_600_000     // 1 hour

// Tool summary
export const TOOL_SUMMARY_TARGET_CHARS = 30          // git-commit-style label
```

---

## What We're NOT Adopting

Several CC patterns are already handled differently (and correctly) in reactive-agents:

| CC Pattern | Our Approach | Assessment |
|---|---|---|
| Text-based ACTION: parsing | We have it for test mocks only | Keep behind `supportsToolCalling: false` flag; remove in V1.1 |
| Single flat query loop | Composable phase architecture | Ours is superior — more extensible |
| In-process background agents | Effect fibers + separate AbortController | Equivalent, Effect-native |
| `detectCompletionGaps` | Our innovation (not in CC) | Keep — adds value not present in CC |
| `final-answer` meta-tool | Our innovation (not in CC) | Keep — hard-gates loop exit reliably |
| `withMinIterations()` | Our innovation (not in CC) | Keep — harness quality control |

---

## Test Coverage Targets

Each P0/P1 item needs tests before the PR lands:

- **P0-1/P0-2:** Unit tests for recovery state transitions; integration test that max_output_tokens scenario produces correct continuation (not immediate failure)
- **P0-3:** Unit test for hookActive flag preventing re-entrant hooks; test that hasAttemptedCompaction is preserved across hook continuations
- **P0-4:** Unit test that API error state skips completion hooks
- **P0-5:** Unit test that circuit breaker prevents compaction after 3 failures
- **P1-1:** Microcompact unit tests; verify floor-at-1 bug doesn't exist in our implementation
- **P1-2:** Unit test for frozen/mustReapply/fresh partitioning
- **P1-3:** Snapshot test that tool pool sort produces stable prefix/suffix ordering
- **P1-5:** Token-delta diminishing returns detection with known inputs

Existing `packages/testing` mock services should support all of these. Add `TestScenario` turns that return `max_output_tokens` stop reasons for recovery testing.

---

*Plan authored from: Claurst 14-file spec, Anthropic Agent SDK docs, DeepWiki Q&A Sections 1–7 (28 findings, 7 corrected assumptions), cross-referenced against reactive-agents v0.8.5+ kernel composable phase architecture.*
