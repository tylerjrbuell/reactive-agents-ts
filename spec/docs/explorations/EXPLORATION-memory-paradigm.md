# Memory Paradigm Exploration: Markdown-Native, Vector-Enhanced

## Status: Design Exploration (Not Yet Committed to Spec)

This document explores a new memory paradigm for `@reactive-agents/memory` inspired by OpenClaw's practical approach, extended with novel concepts. Review, discuss, and iterate before committing to spec changes.

---

## 1. Problem Statement: Why the Current Approach Falls Short

### Current L2 Spec Architecture

```
Vector DB (LanceDB) ──── primary storage for factual memory
In-memory Ref      ──── working memory (lost on restart)
In-memory Ref      ──── episodic memory (lost on restart)
Zettelkasten       ──── auto-linking (similarity-based, in-memory)
```

### Issues

| Problem | Impact |
|---|---|
| Vector DB as primary storage | Opaque — no one can read/inspect what the agent "knows" |
| Episodic memory is in-memory only | All episode history lost on process restart |
| No persistence mechanism timing | No clear answer for WHEN memories get written |
| No compaction strategy | Context window fills up → conversation dies |
| No session continuity | Each new session starts cold |
| No procedural memory | Agent can't learn HOW to do things, only WHAT happened |
| Heavy dependency (LanceDB + Nomic) | Can't run without external services |
| No consolidation/curation | Memories accumulate forever, never merged or updated |
| Not human-auditable | Developer can't easily inspect what agent remembers |

### The OpenClaw Revelation

OpenClaw demonstrates that a production AI assistant achieves effective persistent memory with **just markdown files and four well-timed persistence mechanisms**. No vector DB. No embeddings. Just structured text files read into context.

This works because:
1. LLMs are text-native — markdown IS their language
2. Context window injection > similarity search for small memory corpora
3. Human-readable storage enables debugging and trust
4. Simplicity enables reliability

---

## 2. Core Paradigm Shift

### Old Paradigm (Database-First)
```
Conversation → Extract → Embed → Store in Vector DB → Search by Similarity → Inject
```

### New Paradigm (Markdown-First)
```
Conversation → LLM Extracts → Agent Writes Markdown → Load into Context → Optional: Index for Search
```

**Key principle**: The agent writes its own memories in a format it can natively read and reason about. Vector indexing is a performance optimization for large memory corpora, not the source of truth.

### Inversion of Control

| Aspect | Database-First | Markdown-First |
|---|---|---|
| Source of truth | Vector DB rows | Markdown files |
| Primary retrieval | Similarity search | Context window injection |
| Human readable | No (embeddings are opaque) | Yes (plain text) |
| Debuggable | Need DB tools | Open in any editor |
| Version controllable | Requires DB migrations | `git diff` |
| Zero-dep capable | No | Yes (just `node:fs`) |
| Scalable search | Yes (native) | Requires index layer |
| Agent-authored | No (programmatic insert) | Yes (LLM writes markdown) |

---

## 3. Memory Type Taxonomy

Based on Google's 2025 Memory Framework whitepaper, extended:

### 3a. Semantic Memory — "What I Know"

Stable facts, user preferences, project knowledge. Always loaded into context.

**OpenClaw equivalent**: `memory.md` file
**Our extension**: Structured sections, LLM-driven consolidation, 200-line cap with smart overflow

```markdown
# Agent Memory: semantic

## User Preferences
- Prefers TypeScript with strict mode
- Uses Bun as runtime, not Node
- Likes concise code, minimal comments
- Timezone: US/Central

## Project Context
- Building: reactive-agents-ts framework
- Stack: Effect-TS, TypeScript, Bun
- Monorepo with @reactive-agents/ namespace
- 15 packages across 10 architectural layers

## Known Facts
- API key for Anthropic stored in .env as ANTHROPIC_API_KEY
- LanceDB path: .reactive-agents/memory
- Test framework: vitest
- CI: GitHub Actions
```

**Key properties:**
- Always loaded into every prompt (bootstrap loading)
- 200-line recommended cap (configurable)
- LLM decides what enters, what gets consolidated, what gets evicted
- Organized by semantic sections (not timestamps)
- Agent can be instructed to update specific sections

### 3b. Episodic Memory — "What Happened"

Records of past events, conversations, outcomes. Organized chronologically.

**Two forms:**

#### Daily Logs (append-only)
```markdown
# Daily Log: 2026-02-17

## 14:32 - Reviewed memory spec architecture
- Analyzed current L2 spec: vector-DB-first approach
- Identified 9 issues with current design
- User shared OpenClaw video concepts
- Decision: explore markdown-native paradigm

## 15:10 - Designed new memory paradigm
- Proposed 3-tier memory: semantic + episodic + procedural
- Designed 6 persistence mechanisms (4 from OpenClaw + 2 novel)
- User chose to explore further before spec rewrite
```

**Key properties:**
- One file per day
- Append-only during the day
- Agent writes entries after significant events
- Previous days' logs available for retrieval (not always loaded)
- Recent N days loaded at bootstrap (configurable, default: 3)

#### Session Snapshots
```markdown
# Session Snapshot: abc123
## Started: 2026-02-17T14:30:00Z
## Duration: 45 minutes
## Summary: Explored new markdown-native memory paradigm for reactive-agents framework
## Key Decisions:
- Invert storage: markdown as source of truth, vector DB as derived index
- Add procedural memory type
- Six persistence mechanisms
## Unresolved:
- How to handle 10K+ memory entries efficiently
- Procedural memory format details
```

**Key properties:**
- Created on session boundaries (new session, explicit save)
- Last N meaningful messages summarized by LLM
- Indexed by session ID + timestamp
- Searchable for "what did we discuss about X?"

### 3c. Procedural Memory — "How I Do Things" (Novel)

Learned workflows, task patterns, and procedures. This is the biggest missing piece from OpenClaw and most agent frameworks.

```markdown
# Procedural Memory

## How to: Review a Spec Document
1. Read the full document top-to-bottom
2. Check for: Build Order section, Effect-TS patterns, Schema types
3. Verify cross-references to other specs
4. Look for stale OOP patterns (class...implements)
5. Confirm dependency headers match master architecture
6. Report: issues found, severity, suggested fixes
*Learned from: sessions on 2026-02-15, 2026-02-16*
*Success rate: 4/4 tasks completed satisfactorily*

## How to: Fix Cross-Document Inconsistencies
1. Run grep across all .md files for the inconsistent term
2. Identify canonical form from the authoritative spec
3. Use sed for bulk replacements in non-authoritative docs
4. Verify with final grep that no stale references remain
*Learned from: session on 2026-02-17*
*Success rate: 1/1*

## Pattern: User Prefers Exploration Before Commitment
- When proposing major architectural changes, present options first
- Use ask_questions with "Explore further first" as an option
- Don't rewrite specs without explicit approval
*Observed: 3 times across sessions*
```

**Key properties:**
- Agent writes these based on repeated successful patterns
- Includes provenance (when/where learned)
- Includes confidence (success rate tracking)
- Updated when procedures improve or fail
- Loaded on-demand when agent encounters similar tasks
- This is HOW the agent gets better over time

### 3d. Working Memory — "What I'm Thinking Right Now"

Active reasoning context. NOT persisted to disk. In-process only.

- Current task context
- Active hypotheses
- Short-term scratchpad
- Capacity-limited (configurable, default 7 items)
- Eviction policy: configurable (FIFO, LRU, importance-weighted)

This remains similar to current spec — in-memory Ref with capacity limit. The key difference: working memory is explicitly the ONLY non-persistent memory type.

---

## 4. Persistence Mechanisms: When Memory Gets Written

This is arguably the most important design dimension. OpenClaw's four mechanisms + two novel additions:

### Mechanism 1: Bootstrap Loading (Session Start)

**When**: Every new conversation/session begins
**What**: 
- Inject `semantic/memory.md` into system prompt (always)
- Load last N daily logs (configurable, default: last 3 days)
- Load relevant procedural memories (matched by task type if detectable)
**How**: `MemoryService.bootstrap(agentId, sessionConfig)` → prepends memory context to system prompt

```
System prompt structure:
┌─────────────────────────────┐
│ Base agent instructions     │
├─────────────────────────────┤
│ === SEMANTIC MEMORY ===     │
│ (full memory.md content)    │
├─────────────────────────────┤
│ === RECENT CONTEXT ===      │
│ (last 3 daily log entries)  │
├─────────────────────────────┤
│ === RELEVANT PROCEDURES === │
│ (matched procedural entries)│
└─────────────────────────────┘
```

### Mechanism 2: Pre-Compaction Flush (Before Context Window Limit)

**When**: Session approaches context window limit (configurable threshold, e.g., 80% of max tokens)
**What**: Silent agentic turn that:
1. Extracts important info from conversation so far
2. Writes new entries to daily log
3. Updates semantic memory if facts changed
4. Updates procedural memory if new patterns emerged
5. Then compaction occurs (summarize conversation, continue)
**How**: `CompactionService.flush(sessionHistory)` → triggers LLM extraction → writes to appropriate memory files → then compacts

**This is critical** — without this, the agent loses important context when the window gets compacted.

### Mechanism 3: Session Snapshots (Session Boundary)

**When**: User starts new session, explicitly saves, or session times out
**What**: 
- LLM summarizes last N meaningful messages (configurable, default: 15)
- Saves as session snapshot file
- Also triggers extraction of any un-flushed learnings
**How**: `MemoryService.snapshot(sessionId, messages)` → creates `sessions/session-{id}.md`

### Mechanism 4: User-Initiated ("Remember This")

**When**: User explicitly asks agent to remember something
**What**: Agent determines:
- Is this a fact/preference? → Semantic memory (memory.md)
- Is this an event/decision? → Episodic memory (daily log)
- Is this a procedure/workflow? → Procedural memory
**How**: `MemoryService.userRemember(content, sessionContext)` → LLM categorizes → writes to appropriate file

### Mechanism 5: Auto-Extraction (Novel — After Significant Turns)

**When**: After each agent turn that involves a decision, outcome, or new information
**What**: Lightweight LLM call evaluates:
- Did this turn contain new facts worth remembering?
- Did a task complete (episodic event)?
- Did we learn a new procedure or improve an existing one?
- Score extraction worthiness (threshold: 0.6)
**How**: `MemoryExtractor.evaluate(turn, existingMemory)` → conditionally writes

**This goes beyond OpenClaw** which only flushes at compaction boundaries. Auto-extraction ensures nothing important slips through even in short sessions that never hit compaction.

**Optimization**: This should be a background/fire-and-forget operation that doesn't block the main conversation flow. Use `Effect.fork` to run extraction in parallel.

### Mechanism 6: Consolidation Cycles (Novel — Background Maintenance)

**When**: Periodically (configurable: daily, weekly, or on-demand)
**What**: LLM reviews existing memory files and:
1. **Merges**: Combines redundant entries ("user likes TypeScript" + "user prefers TS" → single entry)
2. **Updates**: Overwrites stale information (old preference → new preference)
3. **Decays**: Reduces importance of unaccessed memories
4. **Promotes**: Frequently-referenced episodic memories become semantic facts
5. **Prunes**: Removes entries below importance threshold
6. **Re-links**: Updates Zettelkasten connections
**How**: `MemoryConsolidator.consolidate(memoryCorpus)` → rewrites memory files

**Why this matters**: Without consolidation, memory grows unbounded and becomes noisy. This is the difference between an agent that accumulates clutter and one that maintains a curated knowledge base.

---

## 5. File System Layout

```
.reactive-agents/
└── memory/
    └── {agentId}/                     # Per-agent memory isolation
        ├── semantic/
        │   ├── memory.md              # Core semantic memory (always loaded, 200-line cap)
        │   ├── preferences.md         # User/agent preferences (overflow from memory.md)
        │   └── entities.md            # Known entities & relationships (overflow)
        ├── episodic/
        │   ├── daily/
        │   │   ├── 2026-02-17.md      # Today's log (append-only)
        │   │   ├── 2026-02-16.md      # Yesterday's log
        │   │   └── ...                # Older logs (auto-archived after 90 days)
        │   └── sessions/
        │       ├── session-abc123.md  # Session snapshot
        │       └── ...
        ├── procedural/
        │   ├── workflows.md           # Learned multi-step procedures
        │   └── patterns.md            # Observed behavioral patterns
        ├── shared/                    # Cross-agent shared memory (optional)
        │   └── project-context.md     # Shared project knowledge
        └── .index/                    # Auto-generated (gitignored)
            ├── embeddings.lance       # LanceDB vector store
            ├── manifest.json          # Index metadata + checksums
            └── links.json             # Zettelkasten link graph
```

### Key Design Decisions

1. **Per-agent isolation**: Each agent has its own memory directory. Multi-agent sharing via explicit `shared/` directory.
2. **Three semantic overflow files**: When `memory.md` hits 200 lines, lower-priority entries move to `preferences.md` or `entities.md`. The LLM decides what stays in the "always loaded" core file.
3. **`.index/` is derived**: Can be deleted and rebuilt from markdown files. Gitignored.
4. **Daily log rotation**: Logs older than configurable threshold (default: 90 days) get archived/summarized.

---

## 6. Two-Tier Architecture: Zero-Dep → Full Mode

This is a key competitive differentiator. Most frameworks require a vector DB to function. We don't.

### Tier 1: Markdown-Native (Zero External Dependencies)

```
Dependencies: node:fs (built-in)
Storage: Markdown files only
Retrieval: Full-file context injection + string matching
Search: grep-like substring/regex matching across files
Use case: Local dev, small projects, getting started, testing
```

**How retrieval works without embeddings:**
- Semantic memory: Always loaded (full file)
- Daily logs: Last N days loaded (full files)
- Procedural: Pattern-matched by task description (keyword heuristic)
- Search: Simple substring matching across all markdown files

**This is surprisingly effective** for agents with < 1000 memory entries because:
- LLMs can reason about text directly in their context window
- Most agent conversations don't generate massive memory corpora
- Context injection is O(1) — no search latency

### Tier 2: Indexed (With Optional Embeddings)

```
Additional deps: @lancedb/lancedb, embedding provider (nomic/openai)
Storage: Same markdown files (source of truth)
Retrieval: Context injection + semantic vector search
Search: Embedding similarity across all memory content
Use case: Production, large memory corpora, multi-agent systems
```

**How the index works:**
- `MemoryIndexer` watches markdown files for changes
- On change: re-embeds the changed file's content blocks
- Index maps: `(file, section, line_range) → embedding vector`
- Search queries the index, returns relevant markdown sections
- If index is missing or corrupt: falls back to Tier 1 (graceful degradation)

**The index is always rebuildable** from the markdown source files. This means:
- No data loss if index corrupts
- Index can be gitignored
- Different environments can use different embedding models
- Testing doesn't need embeddings at all

---

## 7. Compaction Strategies

When the conversation context window fills up, we need to compress without losing critical information.

### Strategy: Count-Based (Simplest)

```
Trigger: turn_count > threshold (default: 50) OR token_count > threshold (default: 80% of model max)
Action: Summarize oldest half of conversation, replace with summary
```

### Strategy: Time-Based

```
Trigger: No user message for > threshold (default: 5 minutes)
Action: Summarize conversation so far, checkpoint to daily log
```

### Strategy: Semantic (Most Intelligent)

```
Trigger: LLM detects topic/task completion via structured output call
Action: 
  1. Extract key outcomes from completed topic
  2. Write to daily log / update semantic memory
  3. Summarize completed topic into 2-3 sentence recap
  4. Replace detailed messages with recap
```

This is the hardest to implement but produces the best results. The LLM evaluates each turn for "is this a natural breakpoint?" signals:
- Task completion markers ("Done", "Here's the result", etc.)
- Topic shifts (user asks about something unrelated)
- Decision conclusions ("Let's go with option B")

### Strategy: Progressive (Novel)

```
Level 0: Raw conversation messages
Level 1: Summarized into topic-level recaps (first compaction)
Level 2: Summarized into session-level overview (second compaction)
Level 3: Key decisions and outcomes only (third compaction)
```

Each compaction level preserves less detail but retains more conversations. This enables extremely long-running agents that can reference events from hundreds of sessions ago in compressed form.

### Implementation: Configurable Pipeline

```typescript
const CompactionStrategy = Schema.Literal(
  "count",     // Simple turn/token count
  "time",      // Idle period detection
  "semantic",  // LLM-detected topic boundaries
  "progressive" // Multi-level summarization
);

// Recommended default: semantic with count as fallback
const defaultCompactionConfig = {
  primary: "semantic",
  fallback: "count",
  countThreshold: { turns: 50, tokenPercent: 0.8 },
  timeThreshold: { idleMinutes: 5 },
  progressiveLevels: 3,
};
```

---

## 8. Memory Lifecycle Operations

These are the core CRUD+ operations that maintain memory quality over time:

### Extract
LLM identifies what's worth remembering from a conversation turn.

```
Input:  conversation turn (user message + agent response)
        + existing semantic memory (for dedup)
Output: { 
  worthRemembering: boolean,
  category: "semantic" | "episodic" | "procedural",
  content: string,      // The extracted memory
  importance: 0-1,
  updateExisting?: string  // ID of memory to update instead of create
}
```

### Categorize
Routes extracted content to the right memory type.

| Signal | Category |
|---|---|
| Fact, preference, definition | Semantic → memory.md |
| Event, decision, outcome | Episodic → daily log |
| Workflow, procedure, "how to" | Procedural → workflows.md |
| Temporary context | Working memory (not persisted) |

### Consolidate
Merges overlapping or redundant entries.

```
Before:
- "User prefers TypeScript" (2026-02-10)
- "User likes TS with strict mode" (2026-02-14)
- "User wants TypeScript strict, no any" (2026-02-17)

After:
- "User prefers TypeScript with strict mode enabled, no `any` types" (consolidated 2026-02-17)
```

### Overwrite
Updates stale information.

```
Before:
- "Project uses Jest for testing" (2026-01-15)

After user says "we switched to vitest":
- "Project uses vitest for testing" (updated 2026-02-17, was: Jest)
```

### Decay
Importance scores decrease over time for unaccessed memories.

```
decay(importance, daysSinceAccess) = importance * (0.95 ^ daysSinceAccess)
```

Memories that decay below a threshold (default: 0.2) are candidates for pruning during consolidation cycles.

### Promote
Frequently-accessed episodic memories get promoted to semantic facts.

```
If an episodic memory is referenced in > 3 sessions:
  → Extract the core fact/procedure
  → Add to semantic or procedural memory
  → Mark episodic entry as "promoted"
```

### Link (Zettelkasten)
Cross-memory connections with typed relationships.

```
Link types:
- similar:      "TypeScript preferences" ↔ "Build tooling preferences"
- sequential:   "Set up monorepo" → "Configure packages"
- causal:       "User reported bug" → "Fixed validation logic"
- contradicts:  "Uses Jest" ✗ "Uses vitest" (triggers overwrite)
- supports:     "Prefers Effect-TS" + "Uses Schema.Struct everywhere"
```

---

## 9. Service Architecture (Effect-TS)

```
MemoryService (orchestrator)
├── SemanticMemoryService      # memory.md management, 200-line cap, consolidation
├── EpisodicMemoryService      # Daily logs + session snapshots
├── ProceduralMemoryService    # Learned workflows and procedures
├── WorkingMemoryService       # In-process context (Ref-based)
├── CompactionService          # Count/time/semantic/progressive strategies
├── MemoryExtractor            # LLM-driven extraction (requires LLMService)
├── MemoryConsolidator         # Merge/dedup/update/decay (requires LLMService)
├── MemoryFileSystem           # Read/write markdown files (node:fs abstraction)
├── MemoryIndexer              # Optional vector index (Tier 2 only)
└── ZettelkastenService        # Cross-memory linking
```

### Dependency Graph

```
MemoryFileSystem: requires nothing (node:fs only)
WorkingMemoryService: requires nothing (in-memory Ref)
SemanticMemoryService: requires MemoryFileSystem
EpisodicMemoryService: requires MemoryFileSystem
ProceduralMemoryService: requires MemoryFileSystem
MemoryExtractor: requires LLMService (from L1.5)
MemoryConsolidator: requires LLMService, MemoryFileSystem
CompactionService: requires LLMService, MemoryExtractor
MemoryIndexer: requires MemoryFileSystem, EmbeddingProvider (optional)
ZettelkastenService: requires MemoryFileSystem, MemoryIndexer (optional)
MemoryService: requires all of the above
```

### Key Design: LLMService is Optional for Basic Operation

```
Tier 1 (no LLM for memory ops):
  - Manual memory writes (user-initiated "remember this")
  - Simple keyword extraction (regex, not LLM)
  - No auto-extraction, no consolidation, no semantic compaction
  - Still fully functional for read/write/bootstrap/snapshot

Tier 2 (LLM-enhanced memory ops):
  - Auto-extraction after significant turns
  - LLM-driven consolidation cycles
  - Semantic compaction (topic detection)
  - Intelligent categorization
```

This means `@reactive-agents/memory` can work WITHOUT `@reactive-agents/llm-provider` — LLM features are injected as optional services.

---

## 10. Markdown Format Conventions

### Semantic Memory Format

```markdown
# Agent Memory: {agentId}

## Section: {category_name}
- {fact or preference}
- {fact or preference}
*Last updated: {ISO date}*

## Section: {category_name}
- {fact or preference}
*Last updated: {ISO date}*
```

Rules:
- Sections are markdown H2 headers
- Items are markdown list items
- Each section has a "Last updated" footer
- Total file capped at 200 lines (configurable)
- Agent decides section names organically

### Daily Log Format

```markdown
# Daily Log: {YYYY-MM-DD}

## {HH:MM} - {brief title}
- {detail}
- {detail}
- Decision: {if applicable}
- Outcome: {if applicable}
```

Rules:
- One file per day
- Entries are H2 headers with timestamp
- Append-only during the day
- Details as markdown list items

### Session Snapshot Format

```markdown
# Session: {sessionId}
- **Started**: {ISO datetime}
- **Duration**: {human-readable}
- **Summary**: {1-2 sentence LLM summary}

## Key Points
- {point}
- {point}

## Decisions Made
- {decision}

## Unresolved Items
- {item}
```

### Procedural Memory Format

```markdown
# Procedures

## How to: {procedure_name}
1. {step}
2. {step}
3. {step}
*Learned from: {session references}*
*Success rate: {X/Y}*
*Last used: {ISO date}*

## Pattern: {pattern_name}
- {observation}
- {observation}
*Observed: {N} times*
*Confidence: {high/medium/low}*
```

---

## 11. Comparison to Other Frameworks

| Feature | OpenClaw | Mem0 | LangChain Memory | CrewAI | **Reactive Agents (Proposed)** |
|---|---|---|---|---|---|
| Storage format | Markdown | Vector DB | Various backends | Vector DB | **Markdown-first + optional vector** |
| Persistence mechanisms | 4 | Auto | Manual | Auto | **6 (most comprehensive)** |
| Memory types | 2 (semantic + episodic) | 1 (facts) | N/A (buffer-based) | 2 (short + long) | **4 (semantic + episodic + procedural + working)** |
| Procedural memory | No | No | No | No | **Yes** |
| Consolidation | No | Auto-merge | No | No | **LLM-driven cycles** |
| Zero-dep mode | Yes | No | No | No | **Yes (Tier 1)** |
| Human-auditable | Yes | No | No | No | **Yes** |
| Git-friendly | Yes | No | No | No | **Yes** |
| Compaction strategies | Count | N/A | Buffer/summary | N/A | **4 strategies** |
| Agent-authored | Partially | No | No | No | **Fully** |
| Multi-agent sharing | No | No | N/A | Yes | **Yes (shared/ dir)** |
| Zettelkasten linking | No | No | No | No | **Yes** |
| Memory promotion/decay | No | No | No | No | **Yes** |

---

## 12. Open Questions & Trade-Offs

### Q1: How to handle large memory corpora efficiently?

**Problem**: If an agent accumulates 500+ daily logs, loading "last 3 days" + full semantic memory is fine, but searching old logs requires either reading all files or having an index.

**Options**:
- **(A)** Always require Tier 2 (vector index) for search across history → simpler but adds dependency
- **(B)** Tier 1 uses grep-like file scanning → works but slow for large corpora
- **(C)** Tier 1 maintains a simple JSON index of titles/dates/keywords → lightweight middle ground

**Recommended**: (C) for Tier 1 with (A) available in Tier 2.

### Q2: How much LLM cost does auto-extraction add?

**Problem**: Running an extraction evaluation after every turn adds LLM calls.

**Options**:
- **(A)** Extract every turn → most complete but expensive
- **(B)** Extract every N turns → configurable cost/coverage trade-off
- **(C)** Extract only on significant turns (heuristic: turn length > threshold, tool calls made, decisions referenced) → smart but imperfect
- **(D)** Make it fully configurable with (C) as default

**Recommended**: (D) with (C) as default. The heuristic filters out "ok", "thanks", and other low-signal turns.

### Q3: Should the agent's own LLM (from L1.5) do memory operations, or a dedicated smaller model?

**Problem**: Memory extraction/consolidation could use a cheaper model (e.g., Haiku) instead of the agent's main model (e.g., Opus).

**Options**:
- **(A)** Use the agent's configured LLMService → simplest, one model to manage
- **(B)** Separate "memory model" config → cheaper but adds complexity
- **(C)** Use L5 (Cost) routing → let the cost layer decide which model handles memory ops

**Recommended**: (A) initially, with (C) as a future optimization in Phase 2.

### Q4: How does procedural memory interact with L3 (Reasoning)?

**Problem**: When the reasoning engine selects a strategy, should it consult procedural memory?

**Proposed**: Yes. The `StrategySelector` in L3 should receive relevant procedural memories as part of its context. If the agent has learned "How to: Review a Spec Document", the selector should bias toward strategies that follow that procedure.

This creates a virtuous cycle:
```
Agent executes task → Learns procedure → Next similar task → Uses learned procedure → Better outcome → Procedure confidence increases
```

### Q5: Multi-agent memory sharing model?

**Problem**: When agents collaborate (L7 Orchestration), how do they share memories?

**Options**:
- **(A)** Shared directory in filesystem → simple, agents read each other's files
- **(B)** Memory service API → agents request memories from each other
- **(C)** Event-based → agents publish memory events, others subscribe

**Recommended**: (A) for Tier 1 (shared/ directory), (B) for orchestrated multi-agent scenarios.

### Q6: What about the Zettelkasten concept from the current spec?

**Analysis**: Zettelkasten auto-linking is still valuable, but in the new paradigm it works differently:

**Current**: Links between vector DB entries based on embedding similarity
**Proposed**: Links between markdown sections/entries based on:
- Embedding similarity (Tier 2)
- Keyword co-occurrence (Tier 1)
- Explicit agent-created links ("this relates to...")
- Temporal proximity (events near in time)
- Causal chains (decision → outcome)

The link graph is stored in `.index/links.json` and is derived/rebuildable. Links enhance retrieval: when loading a memory, also load its strongest links.

---

## 13. Migration Path from Current Spec

If we adopt this paradigm, here's what changes:

### Kept (Adapted)
- `WorkingMemoryService` — stays in-memory with Ref, capacity 7
- `ZettelkastenService` — adapted to work with markdown files instead of vector entries
- `EmbeddingProvider` — moved to optional Tier 2
- `cosineSimilarity` utility — still used in Tier 2 indexing
- `MemoryService` as top-level orchestrator

### Removed
- `LanceDBProvider` as primary storage (→ optional index)
- `FactualMemoryService` (→ replaced by `SemanticMemoryService`)
- Factual memory type with embedding field (→ semantic memory in markdown)
- LanceDB as required dependency

### Added
- `MemoryFileSystem` (new: fs abstraction)
- `SemanticMemoryService` (new: memory.md management)
- `ProceduralMemoryService` (new: workflows and patterns)
- `CompactionService` (new: 4 strategies)
- `MemoryExtractor` (new: LLM-driven extraction)
- `MemoryConsolidator` (new: merge/dedup/update/decay)
- `MemoryIndexer` (new: optional Tier 2 vector index)
- Episodic memory rewritten with daily logs + session snapshots (persistent)
- Memory lifecycle operations (extract, categorize, consolidate, overwrite, decay, promote, link)

### Dependency Changes
- `@lancedb/lancedb` → optional dependency (Tier 2)
- `node:fs` → required (but it's built-in, so zero added deps)
- `@reactive-agents/llm-provider` → optional dependency (LLM-enhanced features)

---

## 14. Proposed Build Order (Preview)

If this paradigm is accepted, the L2 spec Build Order would be approximately:

1. `src/types.ts` — All Schema types (MemoryItem, SemanticEntry, DailyLogEntry, SessionSnapshot, ProceduralEntry, CompactionConfig, etc.)
2. `src/errors.ts` — All TaggedErrors
3. `src/fs/memory-file-system.ts` — MemoryFileSystem service (node:fs abstraction)
4. `src/services/working-memory.ts` — WorkingMemoryService (in-memory Ref, capacity-limited)
5. `src/services/semantic-memory.ts` — SemanticMemoryService (read/write/consolidate memory.md)
6. `src/services/episodic-memory.ts` — EpisodicMemoryService (daily logs + session snapshots)
7. `src/services/procedural-memory.ts` — ProceduralMemoryService (workflows + patterns)
8. `src/compaction/compaction-service.ts` — CompactionService (4 strategies)
9. `src/extraction/memory-extractor.ts` — MemoryExtractor (LLM-driven, optional)
10. `src/extraction/memory-consolidator.ts` — MemoryConsolidator (LLM-driven, optional)
11. `src/indexing/memory-indexer.ts` — MemoryIndexer (vector index, Tier 2 optional)
12. `src/indexing/zettelkasten.ts` — ZettelkastenService (cross-memory linking)
13. `src/services/memory-service.ts` — MemoryService orchestrator (bootstrap, flush, snapshot)
14. `src/runtime.ts` — createMemoryLayer factory (Tier 1 and Tier 2 variants)
15. `src/index.ts` — Public re-exports
16. Tests for each module

---

## 15. Summary

### The Paradigm in One Sentence

> Agents write their own memories as structured markdown (semantic facts, daily episodes, learned procedures), persisted through six well-timed mechanisms, with optional vector indexing as a performance layer — not the source of truth.

### The Three Big Innovations Beyond OpenClaw

1. **Procedural Memory** — Agents don't just remember what happened; they learn how to do things and get better over time
2. **LLM-Driven Memory Lifecycle** — Active curation (extract, consolidate, overwrite, decay, promote) instead of passive accumulation
3. **Two-Tier Zero-Dep Architecture** — Works with just `node:fs`, progressively enhanced with embeddings/vector search

### Why This Wins

For **developers**: Human-readable, git-friendly, zero-config to start, debuggable
For **agents**: Native text format, always-loaded context, learns from experience
For **production**: Scales with vector indexing, multi-agent sharing, backup is just `cp -r`

---

*This document is a design exploration. Once reviewed and agreed upon, it will be used to rewrite `02-layer-memory.md` as a full implementation spec.*
