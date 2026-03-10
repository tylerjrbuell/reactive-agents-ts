# Final Answer, Debrief & Chat — Design Document

**Date:** 2026-03-09
**Status:** Approved

---

## Problem

Three related gaps in the framework that compound each other:

1. **No hard exit gate.** `"FINAL ANSWER:"` is a regex on model output — fragile, ignorable. Models loop 30 iterations retrying side-effect tools after already succeeding because nothing forces them to stop.

2. **No structured debrief.** When a run ends, everything the framework learned — tool call history, errors, reasoning steps, what was stored to memory — evaporates. There is no artifact another agent, a human, or a future run can reference.

3. **No conversational interaction.** `run()` is fire-and-forget. There is no way to ask the agent "what have you found so far?" mid-run or "what did you do last time?" between runs without building it yourself.

---

## Design

### Component 1 — `final-answer` Tool (Hard Gate)

A new meta-tool that **terminates the ReAct loop immediately** when called. Unlike the text-regex approach, the execution engine checks tool call results after every action and short-circuits the loop when it sees `final-answer` was called.

```typescript
final-answer({
  output: string,       // The actual deliverable — answer text, JSON, file path, etc.
  format: "text" | "json" | "markdown" | "csv" | "html",
  summary: string,      // Agent's self-report of what was accomplished (fed to debrief)
  confidence?: "high" | "medium" | "low"
})
```

**Behavior:**
- Handler validates `output` against `format` (JSON.parse check for json, CSV column check for csv)
- Stores output + format + agent summary into execution state
- Returns `{ accepted: true }` — react-kernel checks this and hard-exits
- `terminatedBy` gains a new value: `"final_answer_tool"` (distinct from legacy `"final_answer"` text match)
- `"FINAL ANSWER:"` text matching is kept as a dumb-model fallback only

**Visibility gating** (same pattern as `task-complete`): `final-answer` appears in the tool list only when:
- ≥ 2 iterations have elapsed
- No pending errors
- At least one non-meta tool has been called
- All required tools have been called (if any were specified)

`task-complete` remains for backward compatibility but its description notes `final-answer` is preferred.

---

### Component 2 — Debrief Synthesizer

After `final-answer` fires and before `AgentResult` is returned, the debrief synthesizer runs a two-step process:

**Step 1 — Deterministic signal collection (zero tokens):**

| Signal | Source |
|--------|--------|
| Reasoning steps | `KernelState.steps` (ThoughtTracer) |
| Tool call history | `KernelState.actionsTaken` (name, params, result, success/fail) |
| Errors encountered | Collected from observation results tagged as errors |
| Tokens / duration / iterations | `MetricsCollector` via EventBus |
| Memory writes this run | Episodic entries created during execution |
| Agent's self-report | `summary` + `confidence` from `final-answer` tool call |

**Step 2 — One small LLM call (structured output, haiku-class):**

A tightly templated prompt feeds all Step 1 signals and requests:
```json
{
  "summary": "2-3 sentence narrative of what was accomplished",
  "keyFindings": ["finding 1", "finding 2"],
  "errorsEncountered": ["error description if any"],
  "lessonsLearned": ["lesson 1"],
  "caveats": "anything uncertain or incomplete"
}
```

**Step 3 — Merge into full `AgentDebrief` struct:**
```typescript
interface AgentDebrief {
  outcome: "success" | "partial" | "failed";
  summary: string;                    // from LLM
  keyFindings: string[];              // from LLM
  errorsEncountered: string[];        // from LLM + deterministic
  lessonsLearned: string[];           // from LLM → auto-fed to ExperienceStore
  confidence: "high" | "medium" | "low";
  caveats?: string;
  toolsUsed: { name: string; calls: number; successRate: number }[];
  metrics: { tokens: number; duration: number; iterations: number; cost: number };
  markdown: string;                   // deterministic render of the above
}
```

`lessonsLearned` is automatically written to `ExperienceStore` — no extra wiring needed.

**Debrief is skipped** (returns `undefined`) when:
- No memory system is configured (`.withMemory()` not called)
- Debriefing is explicitly disabled via config
- The run terminated by `max_iterations` or `end_turn` (debrief still generated, but `outcome: "partial"`)

---

### Component 3 — SQLite Persistence

New table in the existing memory SQLite DB alongside episodic/semantic/procedural:

```sql
CREATE TABLE IF NOT EXISTS agent_debriefs (
  id             TEXT PRIMARY KEY,
  task_id        TEXT NOT NULL,
  agent_id       TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  task_prompt    TEXT NOT NULL,
  outcome        TEXT NOT NULL CHECK(outcome IN ('success', 'partial', 'failed')),
  output         TEXT NOT NULL,
  output_format  TEXT NOT NULL,
  debrief_json   TEXT NOT NULL,
  debrief_markdown TEXT NOT NULL,
  tokens_used    INTEGER,
  duration_ms    INTEGER,
  model          TEXT,
  terminated_by  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_debriefs_agent_id ON agent_debriefs(agent_id);
CREATE INDEX IF NOT EXISTS idx_debriefs_created_at ON agent_debriefs(created_at);
```

**Query patterns enabled:**
- `rax inspect <taskId>` — dump past run debrief to terminal
- ExperienceStore joins on `agent_id` + tool patterns for richer cross-run context
- Future agent runs query: "what happened last time for a similar task?"
- A2A: debrief JSON is the canonical response payload for agent-to-agent calls

**Builder API:**
```typescript
// Automatic when .withMemory() is enabled — same DB, no extra config
.withMemory({ tier: "enhanced", dbPath: "./memory-db" })

// Optional override for debrief-specific config
.withDebriefConfig({
  model: "claude-haiku-4-5-20251001",  // small model for synthesis
  retainDays: 90,                       // optional TTL
  enabled: true,                        // default true when memory is on
})
```

---

### Component 4 — Enriched `AgentResult`

`AgentResult` gains optional fields that do not break existing code reading only `result.output`:

```typescript
interface AgentResult {
  // Existing — unchanged
  readonly output: string;
  readonly success: boolean;
  readonly taskId: string;
  readonly agentId: string;
  readonly metadata: AgentResultMetadata;

  // New — from final-answer tool
  readonly format?: "text" | "json" | "markdown" | "csv" | "html";
  readonly terminatedBy?: "final_answer_tool" | "final_answer" | "max_iterations" | "end_turn";

  // New — debrief (present when memory enabled)
  readonly debrief?: AgentDebrief;
}
```

`AgentResultMetadata` gains `confidence?: "high" | "medium" | "low"` sourced from the `final-answer` tool call.

---

### Component 5 — `agent.chat()` & `agent.session()`

**Method signatures on `ReactiveAgent`:**

```typescript
// Single conversational exchange
chat(message: string, options?: ChatOptions): Promise<ChatReply>

// Multi-turn session with auto-managed history
session(options?: SessionOptions): AgentSession
```

```typescript
interface ChatReply {
  message: string;
  toolsUsed?: string[];        // populated if tools were invoked
  fromMemory?: boolean;        // answered from debrief/memory without LLM call
  iterations?: number;         // set if ReAct loop was used
}

interface AgentSession {
  chat(message: string): Promise<ChatReply>;
  history(): ChatMessage[];
  end(): Promise<void>;        // persists conversation to episodic memory
}
```

**Adaptive routing inside `chat()`:**

```
Incoming message
      │
      ▼
Intent classifier (heuristic, ~0 tokens)
  keywords: search/fetch/check/find/write/create/what is the current...
      │
  ┌───┴────────────────┐
  │                    │
Conversational       Tool-capable
  │                    │
Direct LLM call      Lightweight ReAct loop
+ memory context     (no completion gate —
+ debrief context    exits when no tool needed,
  │                  then returns message)
  └──────┬─────────────┘
         │
    ChatReply { message, toolsUsed? }
```

**Conversation context injected into every `chat()` call:**
- Last run's `debrief.summary` + `debrief.keyFindings`
- Current working memory contents
- Conversation history (within session, or last N exchanges between sessions)

**Mid-run chat (agent paused):**
When the agent is paused at a collaborative checkpoint, `chat()` injects the current execution state — iterations elapsed, tools called so far, latest observation — as additional context. The model can answer "I've fetched the commits and am about to send the Signal message" from real state.

**Session history persistence:**
On `session.end()`, the full conversation is written to episodic memory tagged as `type: "conversation"`. Future runs and chat calls can query it.

---

## Dependency Order

```
Task 1: final-answer tool + hard gate in react-kernel
    ↓
Task 2: Debrief synthesizer (DebriefSynthesizer service)
    ↓
Task 3: SQLite DebriefStore (agent_debriefs table)
    ↓
Task 4: AgentResult enrichment (types + builder wiring)
    ↓
Task 5: agent.chat() — direct LLM path
    ↓
Task 6: agent.chat() — tool-capable ReAct path + adaptive routing
    ↓
Task 7: agent.session() + history persistence
```

Each task is independently shippable and testable.

---

## What This Does Not Change

- `run()` signature is unchanged — `output`, `success`, `taskId`, `agentId`, `metadata` all remain
- `"FINAL ANSWER:"` text detection stays as a fallback for models that don't use tools
- `task-complete` tool stays for backward compatibility
- No new required dependencies — uses existing SQLite DB, existing LLM provider, existing memory layer
