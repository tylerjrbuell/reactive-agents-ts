# Performance & Accuracy Optimization Assessment — v0.6.3

> **Date**: 2026-03-08
> **Scope**: Agent reasoning pipeline — prompt engineering, context engineering, tool abstractions, memory integration, error recovery
> **Method**: Full source audit of reasoning kernel, execution engine, tool system, memory pipeline
> **Baseline**: cogito:14b delegate mode — 13-19 steps, 6.5-10.6K tokens, 33-67s for a 3-tool task
> **Target**: ≤8 steps, ≤4K tokens, <20s for same task

---

## Priority Framework

- **P0 — Revolutionary**: Changes the agent's fundamental ability to solve problems correctly
- **P1 — High Impact**: Measurable reduction in iterations, tokens, or failure rate
- **P2 — Quality**: Improves reliability and edge-case handling
- **P3 — Polish**: Nice-to-have optimizations

---

## P0 — Revolutionary (Fundamental Capability Gaps)

### OPT-01: Tool Schemas Lost After Compaction — Agent Goes Blind

**Files**: `react-kernel.ts:258-273`, `compaction.ts:110-180`, `context-utils.ts:82-111`
**Symptom**: After 6+ steps, `progressiveSummarize()` replaces full tool schemas with ultra-compact groupings like `[Steps 3-8: file-read x2, web-search x1]`. The agent LOSES parameter names, required fields, and descriptions for ALL tools.

**Impact**: Agent must guess parameter names after step 6. With cogito:14b, this causes:
- `phone_number` instead of `recipient` (Signal tool)
- `filepath` instead of `path` (file-write)
- Re-calling tools it already called (can't verify from summaries what data it has)

**Fix**: Pin primary/required tool schemas in a persistent section that survives compaction. When building compacted context, re-inject a compact tool reference block:
```
[Active tools — always use these exact parameter names]:
- signal/send_message_to_user({"recipient": "string ★", "message": "string ★"})
- github/list_commits({"owner": "string ★", "repo": "string ★"})
```
Cost: ~100-200 tokens. Prevents: 2-4 wasted iterations per task.

**Effort**: Small (1-2 hours)

### OPT-02: Required Tools Not Signaled Upfront — Late Redirect Wastes Iterations

**Files**: `kernel-runner.ts:173-201`, `react-kernel.ts:280-289`
**Symptom**: Required tools guard only fires AFTER the agent declares FINAL ANSWER. Agent spends 5+ iterations reasoning, declares done, gets redirected: "⚠️ Required tools not yet used: signal/send_message_to_user". Then must restart reasoning from scratch.

**Impact**: 2-4 wasted iterations per required-tool redirect. Agent frustration (repeated forced restarts) degrades output quality.

**Fix**: Two changes:
1. Mark required tools in initial tool schema with `⭐ REQUIRED` prefix
2. Add RULES entry: "Tools marked ⭐ MUST be called before giving FINAL ANSWER."

This converts reactive correction to proactive planning — agent knows upfront which tools are mandatory.

**Effort**: Small (1 hour)

### OPT-03: 50+ Tools Overwhelm Small Models — No Intelligent Culling

**Files**: `react-kernel.ts:146-175`, `tool-utils.ts:390-423`
**Symptom**: GitHub MCP exposes 40+ tools. Combined with 7 built-in + Signal tools = ~50 total. `filterToolsByRelevance()` splits into primary (mentioned in task) and secondary (everything else). When >15 secondary tools, they're shown as bare names with NO schema. Small models can't discover or use them.

**Impact**: Agent wastes tokens scanning 50 tool names. With small models, tool selection accuracy drops significantly when choices exceed ~10-15 tools.

**Fix**: Implement tiered tool presentation:
1. **Primary tools** (task-mentioned): Full schema with descriptions
2. **Likely useful** (top 5-8 by category/description match): Compact schema with parameter hints
3. **Available on request**: "...and 35 more tools. Use by exact name if needed."

Also: Add description-based matching to `filterToolsByRelevance()` — if task says "send a message", `signal/send_message_to_user` should be primary even if the exact tool name isn't mentioned.

**Effort**: Medium (2-3 hours)

### OPT-04: Memory Bootstrap Is Static — No Task-Relevant Retrieval

**Files**: `execution-engine.ts:395-419`, `memory-service.ts`
**Symptom**: At bootstrap, memory returns a pre-formatted markdown dump of ALL semantic entries + last 20 episodic entries. No filtering by task relevance. No importance weighting.

**Impact**: Agent receives unfocused memory context. For a "fetch commits and send Signal" task, it gets unrelated semantic entries about identity, verification, etc. This pollutes the context window and wastes tokens.

**Fix**: Replace static markdown dump with task-aware memory retrieval:
```typescript
const relevantMemories = yield* semanticSearch({
  query: extractTaskText(task.input),
  limit: 5,
  minImportance: 0.5,
});
const relevantEpisodes = yield* episodicSearch({
  query: extractTaskText(task.input),
  limit: 3,
  recencyBias: 0.7,
});
```
Only inject memories that score above a relevance threshold.

**Effort**: Medium (2-3 hours)

---

## P1 — High Impact (Measurable Performance Gains)

### OPT-05: Already-Done Section Wastes 300-500 Tokens

**Files**: `react-kernel.ts:719-738`
**Symptom**: `buildCompletedSummary()` lists every successful observation truncated to 80 chars each. For a 10-step task, this becomes 800+ tokens just saying "don't repeat these."

**Fix**: Replace verbose per-item list with compact action-count format:
```
ALREADY DONE: github/list_commits ✓, scratchpad-write ✓, spawn-agent ✓ (2x)
↓ Pick your next action from tools NOT listed above.
```
Saves 200-400 tokens per compaction cycle.

**Effort**: Small (30 minutes)

### OPT-06: No Iteration Backpressure — Agent Doesn't Know It's Running Out of Time

**Files**: `react-kernel.ts:278-289`, `kernel-runner.ts:120-170`
**Symptom**: Agent has no awareness of how many iterations remain. It plans elaborate multi-step approaches when it has only 2 iterations left. Then hits max iterations and produces truncated output.

**Fix**: Inject iteration awareness into the thought prompt:
```
[Iteration 7/10 — 3 remaining. Be decisive.]
```
When iterations > 60% of max, add urgency signal. When iterations > 80%, add: "You MUST give FINAL ANSWER on this turn or next."

**Effort**: Small (30 minutes)

### OPT-07: Observation Summaries Too Lossy — Agent Re-Fetches Data It Already Has

**Files**: `context-utils.ts:40-61`
**Symptom**: `summarizeStepForContext()` reduces a full API response to `Observation [github/list_commits]: array(8 items), 2100 chars`. Agent knows 8 items were received but not what they contain. Must call scratchpad-read (extra iteration) or re-fetch (duplicate tool call).

**Fix**: Improve summary to preserve key identifiers:
```
Observation [github/list_commits]: array(8 commits) — keys: hash, message, author
  First: "feat: add benchmarks" (0bd00ac) | Last: "fix: JSON repair" (487e270)
  Full data: scratchpad-read("_tool_result_0")
```
Cost: ~50 extra tokens per summary. Prevents: 1-2 re-fetch iterations.

**Effort**: Medium (1-2 hours)

### OPT-08: System Prompt Missing Mid-Tier Guidance

**Files**: `react-kernel.ts:192-218`
**Symptom**: "mid" tier (the DEFAULT for cogito:14b) gets a minimal system prompt: `"You are a reasoning agent. Think step by step and use available tools when needed."` No guidance on tool selection strategy, error recovery, or efficiency.

**Fix**: Mid-tier system prompt should include:
```
You are a reasoning agent. Think step-by-step and use tools precisely.

Guidelines:
- Choose the most specific tool for each sub-task.
- When a tool fails, read the error message carefully — it shows the correct parameter format.
- Be efficient: each tool call costs an iteration. Plan your approach before acting.
- If you have enough information to answer, give your FINAL ANSWER immediately.
```

**Effort**: Small (30 minutes)

### OPT-09: MCP Tool Descriptions Default to Empty

**Files**: `tool-service.ts:429`, `tool-utils.ts:373-378`
**Symptom**: When MCP servers don't provide parameter descriptions, they arrive as empty strings. `formatToolSchemaCompact()` shows only types: `github/list_commits(owner: string, repo: string, first?: number)`. Small models don't know what `first` means.

**Fix**: Two-part fix:
1. Auto-generate descriptions from parameter names: `first` → `"Number of items to return"`, `after` → `"Cursor for pagination"`, `owner` → `"Repository owner/org name"`.
2. In compact format, show inferred purpose: `github/list_commits(owner: string [repo owner], repo: string [repo name], first?: number [count])`

**Effort**: Medium (1-2 hours)

### OPT-10: Tool Error Messages Don't Show Correct Format

**Files**: `tool-execution.ts:197-253`
**Symptom**: When JSON parsing fails, agent sees: `Malformed JSON for tool "signal/send_message_to_user". Expected JSON with keys: recipient, message.` This tells WHAT is wrong but not the exact syntax. Agent must guess the format.

**Current good behavior**: Missing parameter errors DO show expected schema (from execution-engine.ts error enrichment). But malformed JSON errors don't.

**Fix**: Include example in error:
```
Malformed JSON for "signal/send_message_to_user".
Correct format: ACTION: signal/send_message_to_user({"recipient": "+1234567890", "message": "Hello"})
```

**Effort**: Small (1 hour)

---

## P2 — Quality (Reliability & Edge Cases)

### OPT-11: Two Reasoning Paths With Different Semantics

**Files**: `execution-engine.ts:689-950` (reasoning), `execution-engine.ts:1023-1614` (direct-LLM)
**Issue**: The reasoning path and direct-LLM fallback handle tool results, memory context, error enrichment, and episodic logging differently. Memory entries from reasoning path use `eventType: "strategy-outcome"`, direct-LLM uses `"decision-made"`. Bootstrap searches for `"strategy-outcome"` only, missing entries from the other path.

**Impact**: Inconsistent memory across execution modes. Agent learning from prior runs is path-dependent.

**Fix**: Unify episodic logging schema. Use consistent `eventType` values regardless of execution path. Extract memory logging into a shared helper.

**Effort**: Medium (2-3 hours)

### OPT-12: Temperature Not Adaptive to Progress

**Files**: `context-profile.ts`, `react-kernel.ts:255`
**Issue**: Temperature is fixed per tier (local: 0.3, mid: 0.5). When agent is stuck in a loop (repeating same action), maintaining the same temperature perpetuates the loop.

**Fix**: Implement adaptive temperature:
```typescript
const baseTemp = profile.temperature ?? 0.5;
const loopDetected = state.steps.length >= 4 &&
  lastNStepsRepeatSameTool(state.steps, 3);
const temp = loopDetected ? Math.min(baseTemp + 0.2, 0.9) : baseTemp;
```

**Effort**: Small (1 hour)

### OPT-13: Fabricated Observation Detection Is Fragile

**Files**: `react-kernel.ts:387-398`
**Issue**: After extracting ACTION, the kernel strips fabricated observations using regex: `/\nObservation[:\s]/i`. This misses variants like "Result:", "Response:", "Output:", or the model continuing after the action without the Observation prefix.

**Fix**: Strip EVERYTHING after the first complete `ACTION: tool(...)` line. If the model writes anything after the JSON closing brace, discard it:
```typescript
const actionMatch = thought.match(/ACTION:\s*\S+\([\s\S]*?\)\s*/);
if (actionMatch) {
  thought = thought.slice(0, actionMatch.index! + actionMatch[0].length).trimEnd();
}
```

**Effort**: Small (1 hour)

### OPT-14: Scratchpad Keys Are Cryptic — Agent Doesn't Know What's Stored

**Files**: `tool-utils.ts:480-496`
**Issue**: Scratchpad keys are `_tool_result_0`, `_tool_result_1`, etc. When the agent sees `[STORED: _tool_result_3 | spawn-agent]` in its context, it knows something was stored but not what. If multiple tools stored results, the agent can't distinguish them without reading each one.

**Fix**: Use descriptive keys: `_github_list_commits_0`, `_web_search_results_1`. Format: `_{toolName}_{counter}`.

**Effort**: Small (30 minutes)

### OPT-15: No Loop Detection — Agent Repeats Same Tool Call

**Files**: `kernel-runner.ts:120-170`
**Issue**: No mechanism detects when the agent calls the same tool with the same arguments repeatedly. The ALREADY DONE section shows successful observations, but if a tool fails and the agent retries the exact same call, there's no guard.

**Fix**: Track `(toolName, JSON.stringify(args))` pairs. If same pair appears 2+ times, inject: "⚠️ You already tried this exact call and it failed. Try a different approach or parameters."

**Effort**: Small (1 hour)

---

## P3 — Polish

### OPT-16: Context Budget Doesn't Account for Tool Result Sizes

**Files**: `context-budget.ts`
**Issue**: Budget allocations don't include tool result overhead. A single web-search can return 2000+ chars before compression.

### OPT-17: Episodic Memory Timestamp Precision Loss

**Issue**: Episodic entries stored with date-only precision (`.toISOString().slice(0, 10)`), losing intra-day ordering.

### OPT-18: No Tool Result Caching Across Iterations

**Issue**: If agent calls `github/list_commits` twice with same args, both execute. Should cache within a session.

### OPT-19: Transform Pipe Syntax Too Complex for Small Models

**Issue**: `| transform: .results[0].title` syntax is powerful but small models never use it correctly. Should be simplified or removed from small model prompts.

---

## Architecture Analysis: What State Does the Agent Need?

### Current State Available at Thinking Time

| Data Point | Available? | Quality | Notes |
|---|---|---|---|
| Task description | ✅ | Good | In system prompt and context |
| Tool schemas (full) | ✅ first 6 steps | **Degrades** | Lost after compaction |
| Tool schemas (names) | ✅ always | Poor | Names without params after compaction |
| Previous thoughts | ✅ | Good | Full detail for last 4 steps |
| Previous observations | ✅ recent | **Degrades** | Summarized to "array(8), 2100 chars" for old steps |
| Previous actions | ✅ | Good | Tool name preserved |
| Error details | ✅ | Medium | Shows error + hint, but not correct format |
| Iteration count | ❌ | **Missing** | Agent has no idea how many iterations remain |
| Required tools | ❌ upfront | **Missing** | Only learns when redirected after declaring done |
| Memory (semantic) | ✅ | **Unfocused** | Static markdown dump, not task-filtered |
| Memory (episodic) | ✅ | **Unfocused** | Last 20 entries, not task-relevant |
| Parent context | ✅ | Medium | Task description + tool results from parent |
| Budget remaining | ❌ | **Missing** | Agent doesn't know token/cost budget status |
| Confidence signal | ❌ | **Missing** | No feedback on whether it's on the right track |

### What's Missing for Revolutionary Performance

1. **Persistent tool reference** — Tool schemas must survive compaction
2. **Proactive required-tools signal** — Mark mandatory tools upfront, not after failure
3. **Iteration awareness** — Agent must know its budget (iterations remaining)
4. **Task-relevant memory** — Search, don't dump
5. **Richer observation summaries** — Preserve key identifiers, not just counts
6. **Loop detection** — Prevent repeating failed actions
7. **Intelligent tool filtering** — Description-based matching, not just name matching
8. **Progressive urgency** — Increasing decisiveness pressure as iterations deplete

---

## Competitive Edge Opportunities

### vs. Google ADK
- ADK has "always-on memory" with background consolidation — we have it (GAP-04 fixed) but need task-relevant retrieval
- ADK uses Vertex AI for embeddings — we need to make embedding bridge (GAP-01 fixed) actually improve search quality

### vs. CrewAI
- CrewAI has role-based tool assignment — we have it via `.withAgentTool()` but need smarter filtering
- CrewAI's "expected output" field guides agents — we should add expected output format to task description

### vs. LangGraph
- LangGraph has explicit state machines — our ReAct loop is more flexible but needs the same precision via tool pinning and iteration awareness
- LangGraph's checkpointing is superior — we need execution checkpoints for pause/resume

### What Would Make This Revolutionary

1. **Self-correcting agent loop**: Loop detection + adaptive temperature + error-guided recovery = agent that gets unstuck without human intervention
2. **Zero-waste context engineering**: Only show what matters, pin what's needed, discard what's consumed — every token in context earns its place
3. **Small-model parity**: If a 14B model can solve the same tasks as GPT-4 through better context engineering, that's a 10x cost reduction
4. **Proactive vs. reactive**: Tell the agent what it needs upfront (required tools, iteration budget, expected output format) instead of correcting it after failure

---

## Recommended Implementation Order

### Sprint 1: Context Precision (P0) — Biggest Bang for Buck
1. **OPT-01**: Pin tool schemas through compaction
2. **OPT-02**: Signal required tools upfront
3. **OPT-06**: Iteration awareness injection
4. **OPT-05**: Compact already-done section

### Sprint 2: Tool Intelligence (P0-P1)
5. **OPT-03**: Tiered tool presentation with description matching
6. **OPT-09**: MCP parameter description auto-generation
7. **OPT-10**: Error messages with correct format examples

### Sprint 3: Memory & Context Quality (P1)
8. **OPT-04**: Task-relevant memory retrieval
9. **OPT-07**: Richer observation summaries
10. **OPT-08**: Mid-tier system prompt enhancement

### Sprint 4: Self-Correction (P2)
11. **OPT-15**: Loop detection
12. **OPT-12**: Adaptive temperature
13. **OPT-13**: Stronger fabrication prevention
14. **OPT-14**: Descriptive scratchpad keys

---

## Summary

| Priority | Count | Expected Impact |
|----------|-------|-----------------|
| P0 Revolutionary | 4 | -40% iterations, -50% token waste |
| P1 High Impact | 6 | -20% iterations, +30% accuracy |
| P2 Quality | 5 | +15% reliability on edge cases |
| P3 Polish | 4 | Minor optimizations |
| **Total** | **19** | |

**Core Insight**: The agent's reasoning ability is bottlenecked not by the LLM's intelligence but by what it can SEE. Tool schemas disappear after compaction, required tools aren't signaled, iteration budgets are invisible, memory is unfocused, and error messages don't show correct formats. Fixing the agent's **visibility** — ensuring every piece of decision-critical information is present at every thinking step — is the single highest-leverage change possible. The architecture is strong; the information flow needs precision.
