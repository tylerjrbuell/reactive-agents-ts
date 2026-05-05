# Context Engine & Memory Intelligence — Unified Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce agent iterations by 40-60% and eliminate context-related failures for local models through unified context scoring, background memory consolidation, cross-agent experience learning, guarded completion, and parallel tool execution.

**Architecture:** Three-tier intelligence layer built on existing memory storage (Semantic, Episodic, Working, Procedural). Tier 1: ContextEngine replaces static context building with per-iteration scoring and budget allocation. Tier 2: MemoryConsolidator runs background replay/connect/compress cycles on episodic entries to produce high-quality semantic knowledge. Tier 3: ExperienceStore captures tool patterns and task strategies for cross-agent learning.

**Tech Stack:** Effect-TS, bun:sqlite (existing), sqlite-vec (existing), EventBus (existing), Gateway crons (existing)

---

## Success Criteria

### Hard Metrics (test.ts delegate mode, cogito:14b)

| Metric | Current | Target |
|--------|---------|--------|
| Parent agent steps | 6-13 | ≤5 |
| Sub-agent steps | 30 | ≤6 |
| Total tokens (parent + sub) | 21-41K | ≤10K |
| Total wall time | 52-71s | ≤25s |
| Wrong parameter name errors | 2-4/run | 0 |
| Required tool redirect loops | 1-3/run | 0 |
| Sub-agent tool access errors | 2/run | 0 |
| Experience reuse (2nd+ run) | N/A | Tips injected at bootstrap |

### Qualitative Criteria

1. Context never goes blind — tool parameter names always available regardless of step count
2. Agent knows its own state — `context-status` shows stored keys, pending tools, iteration budget
3. Sub-agents are self-sufficient — scratchpad always available, iterations capped, parent keys forwarded
4. Second run is smarter than first — ExperienceStore tips appear at bootstrap
5. Memory improves over time — MemoryConsolidator distills episodic logs into actionable knowledge
6. Parallel tools save iterations — independent tools execute concurrently in one iteration

### "Done" Definition

Run test.ts in delegate mode 3 times:
- Run 1: Parent ≤5 steps, sub-agent ≤6 steps, no tool access errors, total ≤12K tokens
- Run 2: Same task — "Learned from prior runs" in bootstrap log, possibly 1 fewer step
- Run 3: Consistent performance, experience confidence increases
- All existing 1654 tests pass, new tests cover all new systems

### Out of Scope

- LLM model quality (hallucinated data is model problem)
- Signal infrastructure (Docker networking external)
- Frontier model optimization (targets local/mid tier)
- UI/dashboard changes

---

## Tier 1: ContextEngine — Per-Iteration Context Intelligence

### Overview

Replaces `buildInitialContext()`, `buildCompactedContext()`, `progressiveSummarize()`, `buildCompletedSummary()`, `buildPinnedToolReference()`, and `buildIterationAwareness()` with a unified scoring-and-rendering pipeline. No LLM calls — pure algorithmic, runs every iteration.

### Architecture

```
ContextEngine.build(state, context) -> string
  |
  +-- 1. COLLECT all context items into a scored pool:
  |     +-- ToolSchemas[]        (from input.availableToolSchemas)
  |     +-- Steps[]              (from state.steps)
  |     +-- Memories[]           (from bootstrap — task-filtered semantic + episodic)
  |     +-- PinnedItems[]        (tool reference, required tools, iteration info)
  |     +-- TaskContext          (task description, prior context, system prompt)
  |
  +-- 2. SCORE each item (0.0-1.0):
  |     +-- recencyScore     — exponential decay from current iteration
  |     +-- relevanceScore   — keyword overlap with task + recent observations
  |     +-- outcomeScore     — did this step lead to success or error?
  |     +-- pinScore         — hard 1.0 for pinned items (tool ref, task, rules)
  |     +-- typeWeight       — errors > successful observations > thoughts > summaries
  |
  +-- 3. BUDGET allocation (tier-adaptive token budget):
  |     +-- Pinned section:     ~15% (always: tool ref, task, rules)
  |     +-- Recent steps:       ~45% (last N steps in full detail)
  |     +-- Scored history:     ~25% (older steps ranked by score, compacted)
  |     +-- Memory context:     ~10% (task-relevant memories only)
  |     +-- Reserve:            ~5%  (iteration awareness, urgency signals)
  |
  +-- 4. RENDER to string (format based on tier):
        +-- Pinned block (tool schemas, required tools markers)
        +-- Memory block (if relevant memories scored above threshold)
        +-- History block (scored + budget-fitted steps)
        +-- Recent block (full detail recent steps)
        +-- Rules + iteration awareness
```

### Key Behaviors

- **Micro-compaction every turn**: Every iteration re-scores and re-budgets. Early iterations have few steps so everything fits. Later iterations aggressively compress low-score items.
- **Error preservation**: Failed observations get 1.5x score boost — model needs to see what went wrong.
- **Observation key extraction**: Instead of `"array(8 items), 2100 chars"`, extracts identifiers: `"8 commits: [0bd00ac] feat: add benchmarks, [f2023a3] feat: benchmarks..."`.
- **Task-relevant memory injection**: `SemanticMemory.search(taskDescription, limit: 5, minImportance: 0.3)` replaces `generateMarkdown()`.

### What It Replaces

| Current | New |
|---------|-----|
| `buildInitialContext()` | `ContextEngine.collect()` + `ContextEngine.render()` |
| `buildCompactedContext()` | Eliminated — scoring handles this |
| `progressiveSummarize()` | Eliminated — budget allocation handles this |
| `buildCompletedSummary()` | Rolled into scoring (completed actions auto-compressed) |
| `buildPinnedToolReference()` | Pinned section in budget allocation |
| `buildIterationAwareness()` | Reserve section in budget allocation |

### File

New: `packages/reasoning/src/context/context-engine.ts`

---

## Tier 2: MemoryConsolidator — Background Memory Intelligence

### Overview

Background service that turns raw episodic entries into high-quality semantic knowledge. Runs event-driven (after N entries) with cron fallback. Uses existing Gateway infrastructure.

### Three Operations

**REPLAY** — Extract patterns from recent episodic entries
- Input: Last N episodic entries since last consolidation
- Output: Candidate semantic entries with tags + importance
- Method: LLM call (background, latency doesn't matter)
- Prompt: "Extract reusable knowledge: tool patterns, error solutions, task strategies, entity relationships."

**CONNECT** — Find and merge related semantic entries
- Input: New candidates + existing semantic entries
- Output: Merged/strengthened entries, deprecated entries marked
- Method: Embedding similarity (sqlite-vec KNN) + LLM merge
- Logic:
  - similarity > 0.85 existing entry: merge (LLM combines, bump importance)
  - Contradicts existing: replace (mark old deprecated, insert new)
  - Novel: insert as new semantic entry

**COMPRESS** — Decay and prune low-value memories
- `importance *= decayFactor` (0.95 per cycle)
- `importance += accessBoost` (0.1 per access since last cycle)
- If `importance < 0.1` AND no access for 7 days: archive
- If contradicted by newer entry: delete

### Trigger Mechanism (Hybrid)

```typescript
// Event-driven: fires after threshold
EventBus.on("EpisodicEntryCreated", (event) => {
  pendingCount++;
  if (pendingCount >= CONSOLIDATION_THRESHOLD) {  // default: 10
    pendingCount = 0;
    runConsolidation(event.agentId);
  }
});

// Cron fallback via Gateway
{ schedule: "0 */6 * * *", instruction: "consolidate-memory" }
```

### What Gets Consolidated (Examples)

| Episodic Entries | Consolidated Semantic Entry |
|--|--|
| 3 runs where signal/send_message failed with "error -1" | "Signal send_message fails with error -1 when Docker lacks network. Check networking." importance: 0.8 |
| 5 runs using list_commits -> scratchpad-write -> scratchpad-read | "For commit analysis: fetch, store in scratchpad, read back. Include scratchpad-read in sub-agent tools." importance: 0.7 |
| 2 runs where sub-agent hallucinated without specific values | "Sub-agents have ZERO parent context. Include all specific values in task." importance: 0.9 |

### Integration with Existing Memory

```
BEFORE (current bootstrap):
  semanticMemory.generateMarkdown()    // dumps ALL
  episodicMemory.getRecent(20)         // flat list

AFTER (with consolidator):
  semanticMemory.search(taskDescription, limit: 5)  // task-relevant only
  episodicMemory.getRecent(5)                        // fewer needed
  proceduralMemory.getPatterns(taskType)             // learned patterns
```

### File

New: `packages/memory/src/services/memory-consolidator.ts`

---

## Tier 3: ExperienceStore — Cross-Agent Learning

### Overview

Captures what worked and what didn't during agent execution. Surfaces patterns to future agents running similar tasks. Stored by taskType (not agentId) for cross-agent sharing.

### What Gets Captured (Automatic)

**ToolPatterns** — Successful tool sequences
```json
{
  "taskType": "github-summary",
  "pattern": ["github/list_commits", "scratchpad-write", "scratchpad-read"],
  "avgSteps": 5, "avgTokens": 3200, "successRate": 0.85,
  "tips": ["Include scratchpad-read in sub-agent tools"]
}
```

**ErrorRecoveries** — What fixed a failed tool call
```json
{
  "tool": "signal/send_message_to_user",
  "errorPattern": "signal-cli error -1",
  "recovery": "Check Docker networking. Retry with different recipient format.",
  "occurrences": 3
}
```

**TaskStrategies** — Optimal approach by task type + model tier
```json
{
  "taskType": "delegate-fetch-summarize-send",
  "optimalStrategy": "reactive", "optimalSteps": 6,
  "tips": ["Delegate fetch+summarize to sub-agent, keep send in parent"],
  "modelTier": "local", "confidence": 0.7
}
```

**ParameterHints** — Learned parameter corrections
```json
{
  "tool": "scratchpad-write", "param": "content",
  "hint": "Must be string, not object. JSON.stringify() if structured.",
  "learnedFrom": 4
}
```

### Capture Hook (Post-Execution)

```typescript
// In execution-engine.ts, after phase.complete:
yield* experienceStore.record({
  agentId, taskDescription, taskType: inferTaskType(task.input),
  steps, toolsUsed, success, totalSteps, totalTokens,
  errors: extractErrors(steps), modelTier,
});
```

### Relevance Matching (Three-Layer Filter)

```
experienceStore.query(taskDescription, taskType, modelTier)
  |
  +-- Layer 1: TASK TYPE match (coarse)
  |   Normalized categories: "git-operations", "messaging", etc.
  |   Same or parent category only.
  |
  +-- Layer 2: EMBEDDING SIMILARITY (semantic)
  |   KNN against stored experience descriptions. similarity > 0.6 only.
  |
  +-- Layer 3: MODEL TIER affinity (practical)
      Same tier: 1.0x, adjacent: 0.7x, distant: 0.3x
```

Only experiences passing all 3 layers AND confidence >= 0.5 get injected. If nothing passes, no experiences section — zero noise.

### Confidence & Decay

- `confidence = successCount / totalOccurrences`
- Injected only when confidence >= 0.5 AND occurrences >= 2
- Decay: if not accessed in 30 days, `confidence *= 0.8` per cycle
- Contradicted: if recent runs fail pattern, reduce confidence

### Cross-Agent Sharing

```
Agent A: "fetch commits + send Signal" -> records patterns
Agent B: "fetch PRs + send Signal"     -> sees Agent A's Signal patterns
Agent C: "fetch commits + write file"  -> sees Agent A's GitHub patterns
```

### File

New: `packages/memory/src/services/experience-store.ts`

Storage: Uses existing ProceduralMemory SQLite tables. Schema:
- `tool_patterns` — successful sequences by task type
- `error_recoveries` — error -> fix mappings by tool
- `task_strategies` — optimal approach by task type + tier
- `parameter_hints` — learned corrections by tool

---

## Meta-Tools & Sub-Agent Fixes

### New Meta-Tool: `context-status`

```
context-status() -> {
  iteration: 5, maxIterations: 10, remaining: 5,
  toolsUsed: ["github/list_commits", "scratchpad-write"],
  toolsPending: ["signal/send_message_to_user"],
  storedKeys: ["_tool_result_1", "commit-summary"],
  stepsCompleted: 8, tokensUsed: 4200
}
```

File: `packages/tools/src/skills/context-status.ts`

### New Meta-Tool: `task-complete` (Guarded)

```
task-complete({"summary": "Fetched 5 commits, sent via Signal"})
```

Explicit completion signal. Kernel recognizes as termination. Summary stored in episodic memory and ExperienceStore. `FINAL ANSWER:` still works as fallback.

**Visibility gating** — `task-complete` is only in the tool schema when ALL conditions met:
- All required tools called at least once
- No pending tool errors unaddressed
- iteration >= 2 (prevent instant completion)
- At least one non-meta tool called

If called when conditions not met, returns: "Cannot complete yet. Pending: signal/send_message_to_user (required)"

File: `packages/tools/src/skills/task-complete.ts`

### Sub-Agent Fix 1: Auto-Include Scratchpad

```typescript
// agent-tool-adapter.ts
const ALWAYS_INCLUDE = ["scratchpad-read", "scratchpad-write"];
const effectiveTools = [...new Set([...(opts.tools ?? []), ...ALWAYS_INCLUDE])];
```

### Sub-Agent Fix 2: MaxIterations Cap

Sub-agents default to `Math.min(parentMax, 6)`. Overridable via spawn-agent parameter.

### Sub-Agent Fix 3: Scratchpad Forwarding

Sub-agent scratchpad writes forwarded to parent with namespaced keys:
```
Sub writes:   scratchpad-write("commit-summary", "...")
Parent reads: scratchpad-read("sub:commit-fetcher:commit-summary")
```

Parent observation from spawn-agent includes forwarded keys list.

---

## Parallel & Chained Tool Execution

### Parallel Mode — Independent tools run concurrently

```
Agent outputs:
  ACTION: github/list_commits({"owner": "tylerjrbuell", "repo": "reactive-agents-ts"})
  ACTION: github/list_issues({"owner": "tylerjrbuell", "repo": "reactive-agents-ts"})

Kernel: 2 independent ACTIONs, no data dependency
Execution: Effect.all([execute(tool1), execute(tool2)], { concurrency: "unbounded" })

Observation [parallel]:
  [1] github/list_commits: array(30 commits) — [STORED: _tool_result_1]
  [2] github/list_issues: array(12 issues) — [STORED: _tool_result_2]
```

### Chain Mode — Dependent tools with data forwarding

```
Agent outputs:
  ACTION: github/list_commits({"owner": "tylerjrbuell", "repo": "reactive-agents-ts"})
  THEN: scratchpad-write({"key": "commits", "content": "$RESULT"})

Kernel: THEN keyword = chain dependency
Execution: Run tool1, replace $RESULT with output, run tool2

Observation [chain]:
  [1] github/list_commits: array(30 commits) ok
  [2] scratchpad-write: saved "commits" ok
```

### Detection Logic

```typescript
interface ToolRequestGroup {
  mode: "single" | "parallel" | "chain";
  requests: ToolRequest[];
}

// Multiple ACTION: with no THEN: = parallel
// ACTION: followed by THEN: = chain
// Single ACTION: = backwards compatible
```

### Safety Constraints

- Max 3 parallel tools per iteration
- Max 3 chain depth
- Side-effect tools (send_, create_, delete_) cannot run in parallel
- `$RESULT` only references immediately preceding tool output
- Chain fails fast: first error skips remaining steps

---

## System Wiring

### Builder API

```typescript
ReactiveAgents.create()
  .withMemory()                // existing
  .withMemoryConsolidation()   // NEW: background consolidation
  .withExperienceLearning()    // NEW: cross-agent experience
  .withReasoning()             // existing, now uses ContextEngine
  .withTools()                 // existing, includes context-status + task-complete
```

### Runtime Layers

```
createRuntime(options)
  +-- MemoryConsolidatorLive  (requires LLMService + SemanticMemory + EpisodicMemory + EventBus)
  +-- ExperienceStoreLive     (requires ProceduralMemory + SemanticMemory)
  +-- ContextEngineLive       (replaces static context building)
  +-- ... existing layers ...
```

### Execution Engine Phase Modifications

```
[bootstrap] — MODIFIED
  +-- SemanticMemory.search(taskDescription) instead of generateMarkdown()
  +-- ExperienceStore.query(taskDescription, taskType) -> inject learned tips
  +-- Store both in ctx for ContextEngine

[think] — MODIFIED
  +-- ContextEngine.build() replaces buildInitialContext + compaction
  +-- Parallel/chain tool parsing
  +-- task-complete visibility gating

[act] — MODIFIED
  +-- Parallel execution via Effect.all
  +-- Chain execution via sequential Effect.flatMap with $RESULT
  +-- Sub-agent scratchpad forwarding

[complete] — MODIFIED
  +-- ExperienceStore.record() captures run patterns

[memory-flush] — EXISTING
  +-- EventBus: EpisodicEntryCreated -> triggers consolidation check
```

### Event Flow

```
Agent completes run
  -> [memory-flush] writes episodic entries
  -> EventBus: EpisodicEntryCreated (xN)
  -> MemoryConsolidator: pendingCount += N
  -> If pendingCount >= 10: runConsolidation()
      -> REPLAY: LLM extracts patterns
      -> CONNECT: KNN finds related entries, merges
      -> COMPRESS: Decay old, prune below threshold
  -> Next agent bootstraps with improved semantic search
  -> ExperienceStore also captured tool patterns
  -> Next similar agent sees tips at bootstrap
```

---

## New Files

```
packages/reasoning/src/context/context-engine.ts        — ContextEngine
packages/memory/src/services/memory-consolidator.ts      — MemoryConsolidator
packages/memory/src/services/experience-store.ts         — ExperienceStore
packages/tools/src/skills/context-status.ts              — context-status meta-tool
packages/tools/src/skills/task-complete.ts               — task-complete meta-tool
```

## Modified Files

```
packages/reasoning/src/strategies/shared/react-kernel.ts   — Use ContextEngine, multi-tool parsing
packages/reasoning/src/strategies/shared/tool-utils.ts     — parseAllToolRequests parallel/chain
packages/reasoning/src/strategies/shared/kernel-runner.ts  — task-complete gating, parallel exec
packages/reasoning/src/strategies/shared/tool-execution.ts — parallel Effect.all, chain $RESULT
packages/tools/src/adapters/agent-tool-adapter.ts          — Auto-include scratchpad, iter cap, forwarding
packages/runtime/src/execution-engine.ts                   — Bootstrap changes, experience recording
packages/runtime/src/builder.ts                            — New builder methods
packages/runtime/src/runtime.ts                            — New layers
packages/memory/src/services/memory-service.ts             — Task-relevant search at bootstrap
```

## Testing

```
packages/reasoning/tests/context/context-engine.test.ts
  - Scoring: recency decay, error boost, relevance scoring
  - Budget: items fit within tier budget, pinned always included
  - Rendering: tier-adaptive formatting
  - Micro-compaction: context shrinks as steps accumulate
  - Memory injection: relevant included, irrelevant excluded

packages/reasoning/tests/strategies/multi-tool-execution.test.ts
  - Parallel: 2 independent tools run concurrently
  - Chain: THEN keyword forwards $RESULT
  - Safety: side-effect tools sequential, max depth enforced
  - Failure: chain aborts on first error
  - Backward compat: single ACTION still works

packages/reasoning/tests/strategies/task-complete-guard.test.ts
  - Hidden when required tools not met
  - Visible when all conditions satisfied
  - Rejects early completion with feedback
  - Works alongside FINAL ANSWER fallback

packages/memory/tests/services/memory-consolidator.test.ts
  - Replay: extracts patterns from episodic entries
  - Connect: merges similar semantic entries
  - Compress: decays importance, prunes threshold
  - Event trigger: fires after N entries
  - Cron trigger: fires on schedule

packages/memory/tests/services/experience-store.test.ts
  - Record: captures tool patterns, errors, strategies
  - Query: returns relevant by task type + embedding
  - Relevance: rejects irrelevant (3-layer filter)
  - Confidence: only >= 0.5 with 2+ occurrences
  - Cross-agent: Agent B sees Agent A patterns
  - Decay: unused experiences lose confidence

packages/tools/tests/meta-tools.test.ts
  - context-status: correct state returned
  - task-complete: records summary, triggers completion
  - Sub-agent scratchpad forwarding

packages/runtime/tests/integration/context-pipeline.test.ts
  - End-to-end: bootstrap -> think -> act -> observe with ContextEngine
  - Memory injection: task-relevant memories in context
  - Experience injection: prior tips at bootstrap
  - Sub-agent: scoped tools + scratchpad + capped iterations
```
