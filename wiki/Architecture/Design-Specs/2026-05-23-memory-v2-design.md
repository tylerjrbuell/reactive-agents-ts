---
title: Memory v2 — Unified Memory Primitives Design
date: 2026-05-23
status: draft
owner: Memory Team
related:
  - "[[05-DESIGN-NORTH-STAR]]"
  - "[[M10 Memory System]]"
  - "[[2026-05-23-harness-convergence]]"
  - "[[FM-F Context and Memory]]"
target_releases: [v0.12, v0.13, v0.14]
audit_source: 2026-05-23 M10 audit + Anthropic "Memory as Primitive" thesis
---

# Memory v2 — Unified Memory Primitives Design

## Executive Summary

Memory v2 is a unified redesign of the M10 memory subsystem to close ten Critical/Major gaps identified in the 2026-05-23 audit and to align the framework with the "memory as a first-class primitive" thesis. The design is additive (zero breaking changes to v0.11 API), phased across three releases (v0.12 → v0.14), and gated per-phase by the project lift rule (≥3pp accuracy lift, ≤15% token overhead).

The headline architectural shift is a **2-axis model**: every memory entry has a **tier** (working/episodic/semantic/procedural/anti-pattern) AND a **scope** (private/team/global). Today only the tier axis exists. Adding the scope axis enables multi-agent sharing without disturbing the existing 4-layer mental model. A pluggable `MemoryStore` interface lets the framework run on SQLite (default, fast, local-model-friendly) or filesystem (optional, agent-introspectable) without consumer changes.

A new **dreaming pipeline** (light per-session + heavy scheduled cross-agent) closes the cross-session learning loop. Anti-patterns become a first-class tier. Checkpoint-based long-task resumability fills the third Major gap. The combined result: Day N+1 agents start materially smarter than Day N, multi-agent fleets can share knowledge safely, long-running tasks survive crashes.

## Audit Findings Recap

The May 23 M10 audit (verified by advisor) confirmed:

| Gap | Severity | v2 resolution |
|-----|----------|---------------|
| No file-system abstraction (SQLite binary; agents see typed API) | Critical | `FilesystemStore` opt-in backend + `ProjectionLayer` always-on |
| No optimistic concurrency / content hashes (multi-agent unsafe) | Major | `MemoryStore.cas()` content-hash compare-and-set |
| No permission scopes (any agent can read any other's data) | Major | `ScopeRegistry` + `private`/`team`/`global` scopes |
| No version history (in-place overwrites) | Major | `memory_versions` table + monotonic version per id |
| No PII filtering on LLM calls | Major | Out of scope for v2.0 — separate v2.5 design |
| Working memory discarded at session end | Major | Importance-threshold promotion to episodic |
| No async/out-of-band dreaming (Day N+1 ≠ smarter) | Critical | LightDream (per-session) + HeavyDream (scheduled) |
| Moderate-flush daemon fork race condition | Major | Always-blocking flush; CheckpointService for resumability |
| Cross-session learning is counter-based only (ExperienceStore) | Major | HeavyDream LLM-driven semantic pattern detection |
| Skill portability code dormant (no orchestrator) | Major | Activated by HeavyDream PUBLISH step |

Counter-evidence preserved: the audit's first-pass "no cross-session pattern detection" was softened — `experience-store.ts` does maintain cross-session occurrence counters for tool patterns and error recoveries. v2 builds on this rather than replacing it.

## Section 1 — Architecture Overview

### Two-Axis Model

```
            tier
              │
   working ───┤
  episodic ───┤
  semantic ───┤        ┌─ private (default; per-agent)
procedural ───┤───┬──── team (explicit publish)
anti-pattern ─┤   └──── global (auto-published via dream confidence)
              │
            scope
```

Every entry has a tier (what kind of knowledge) AND a scope (who can see it). Tier determines retrieval semantics and lifecycle; scope determines visibility. The two axes are independent.

### High-Level Diagram

```
┌───────────────────────────────────────────────────────────────────┐
│                          Memory v2                                │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  Consumer Layer                                             │  │
│  │  MemoryService.bootstrap()/flush()/publish()/republish()    │  │
│  └──────────────────────────┬──────────────────────────────────┘  │
│                             │                                     │
│  ┌──────────────────────────┴──────────────────────────────────┐  │
│  │  Service Layer (existing + extended)                        │  │
│  │  Working | Episodic | Semantic | Procedural | AntiPatterns  │  │
│  │  All gain scope-aware queries; old signatures preserved.    │  │
│  └──────────────────────────┬──────────────────────────────────┘  │
│                             │                                     │
│  ┌──────────────────────────┴──────────────────────────────────┐  │
│  │  Pluggable MemoryStore Backend                              │  │
│  │  ─────────────────────────────                              │  │
│  │  • SQLiteStore (default)                                    │  │
│  │  • FilesystemStore (opt-in, v0.14)                          │  │
│  │  • [future: TursoStore, PostgresStore for multi-host]       │  │
│  │  Interface: get/put/cas/query/versions/delete               │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  Projection Layer (always-on, lazy-regen)                   │  │
│  │  Generates per-tier .md/.json files from any store backend  │  │
│  │  Frontier models read via bash/grep; local models ignore    │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  Dreaming Pipeline                                          │  │
│  │  ─────────────────                                          │  │
│  │  • LightDream — session-end hook, single-agent              │  │
│  │  • HeavyDream — scheduled (CLI/cron), cross-agent           │  │
│  │  • Outputs: pattern entries, skill refinements,             │  │
│  │             confidence updates, anti-pattern warnings       │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  Lifecycle Subsystems                                       │  │
│  │  ─────────────────────                                      │  │
│  │  • Promote: working → episodic at session-end (importance)  │  │
│  │  • Entropy flush: trajectory-driven complexity upgrade      │  │
│  │  • CheckpointService: every N iter or M tokens (resumable)  │  │
│  │  • ScopeRegistry: scope visibility + write enforcement      │  │
│  └─────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────┘
```

### Net-New Components

Five new components, each mapped 1:1 to an audit gap:

1. **`MemoryStore` interface** — extracted from `database.ts`; foundational abstraction for backend swap; `cas()` method enforces `content_hash` compare-and-set on writes
2. **`ScopeRegistry`** — resolves visible scopes for each agent; enforces write access; team membership lookup
3. **`HeavyDream`** — scheduled cross-agent aggregation + pattern synthesis + auto-publish
4. **`AntiPatternsTier`** — formal failure knowledge tier (today implicit in `experience_store.error_recoveries`)
5. **`CheckpointService`** — periodic kernel state snapshots; resumable across process boundaries

No speculative additions. Every component closes a Critical or Major audit gap.

## Section 2 — Existing Systems Mapping

### Reused As-Is

| Existing | Why it survives |
|---|---|
| `database.ts` (SQLite + FTS5 + WAL) | Becomes `SQLiteStore` impl behind `MemoryStore`. Schema gains `scope`, `version`, `content_hash`, `provenance` via additive migration. |
| `search.ts` | Query layer; unchanged. |
| `zettelkasten.ts` | Semantic linking; unchanged. |
| `memory-file-system.ts` | Seeds `ProjectionLayer`; extended to write per-tier files. |
| `debrief-store.ts`, `plan-store.ts` | Specialized stores; unchanged. |
| `extraction/memory-extractor.ts` | LLM-based extraction; reused by LightDream. |
| `extraction/memory-consolidator.ts` | Unchanged — distinct from `services/memory-consolidator.ts`; handles extraction-stage consolidation, not session-end consolidation. |
| `compaction-service.ts` | Reused by HeavyDream COMPRESS; gains cross-agent dedup. |

### Wrapped Behind New Abstractions (additive)

| Existing | v2 wrapper | Change |
|---|---|---|
| `working-memory.ts` (Ref-based) | `WorkingMemoryService` keeps hot path; adds `importance` field to WorkingMemoryItem schema + `promoteOnSessionEnd(threshold=0.7)` | Items ≥ threshold flushed to episodic. Schema migration: extend WorkingMemoryItem with importance (0-1, default 0.5). |
| `episodic-memory.ts` | Same + scope column | Defaults `scope=private`; no consumer changes |
| `semantic-memory.ts` | Same + scope column | Dreaming writes `team`/`global` based on confidence |
| `procedural-memory.ts` + `skill-*.ts` | Same + scope column | SkillEvolution becomes HeavyDream consumer |
| `session-store.ts` (chat_sessions) | Canonical dreaming input substrate | No schema change initially |
| `experience-store.ts` (occurrences counters) | Seeds `AntiPatternsTier`; counters preserved | High-occurrence error_recoveries migrate to formal anti_patterns table |
| `services/memory-consolidator.ts` (REPLAY→CONNECT→COMPRESS) | Renamed `LightDream` | Single-agent session-end hook. Backwards compat: keep `MemoryConsolidatorService` Effect tag as deprecated alias to `LightDreamService` for ≥1 release; emit deprecation warning on resolve. |
| `engine/phases/memory-flush-dispatch.ts` | Same dispatcher + entropy input | "diverging/oscillating" upgrades to complex; daemon-fork race removed |

### Activated Dormant Code

`skill-portability.ts` (`exportSkillToMarkdown` / `importSkillFromMarkdown`) — currently has no orchestrator. Becomes the cross-agent skill transfer mechanism inside HeavyDream PUBLISH.

### Deprecated

| Removed | Replacement |
|---|---|
| Moderate-flush daemon fork | Always blocking flush + CheckpointService for resumability |
| Implicit error-recovery rows as anti-patterns | Formal `AntiPatternsTier` with severity, condition, occurrences |

## Section 3 — Data Flow

Five canonical flows.

### Flow 1 — Normal Task Execution

```
runtime.start(task)
    ↓
ScopeRegistry.resolveVisibleScopes(agentId) → [private:A1, team:T1, global]
    ↓
MemoryStore.query WHERE scope IN (...) → semantic + procedural + anti-patterns
    ↓
ProjectionLayer.read (if opted-in) → memory.md content
    ↓
ctx.memoryContext injected into prompt
    ↓
─── kernel iterations ───
    ↓
inline-observe: tool result → episodic write (scope=private, provenance=agent)
WorkingMemoryService: Ref updated (in-process, zero DB cost)
CheckpointService: every N iter → snapshot
    ↓
task complete
    ↓
memory-flush.dispatchByComplexity(iter, entropyTrajectory, toolCount)
    ↓
session_store.save(transcript)
```

### Flow 2 — Session End (LightDream + Promotion)

```
memory-flush completion
    ↓
WorkingMemoryService.promoteOnSessionEnd:
    ├─ scan Ref for items where importance ≥ 0.7
    ├─ for each: episodic.log({...item, scope=private, provenance=promoted})
    └─ Ref cleared
    ↓
LightDream.run(agentId, sinceLastRun):
    ├─ REPLAY: count episodic since last run
    ├─ CONNECT: SkillDistiller.refine() for skills with enough evidence
    ├─ COMPRESS: importance decay + near-dup merge (within agent)
    └─ EXTRACT: MemoryExtractor on transcript → semantic entries (private)
    ↓
CheckpointService.finalize: mark session checkpoint as complete-state
```

### Flow 3 — Scheduled HeavyDream

```
CLI: reactive-agents dream  (hourly or daily, cron)
    ↓
HeavyDream.run(scope=team|global, since=lastRun)
    │
    ├─ AGGREGATE
    │   ├─ session_store.listSessions(since, allAgents)
    │   ├─ experience_store.queryHighOccurrence(threshold=3)
    │   └─ episodic.queryByEventType("error", since, allAgents)
    │
    ├─ DETECT (LLM-driven)
    │   ├─ failure patterns: group errors by signature
    │   │   → if ≥3 across ≥2 agents → anti-pattern candidate
    │   ├─ success patterns: high-success tool-sequences → pattern candidate
    │   └─ skill candidates: repeated procedural sequences → refinement
    │
    ├─ SYNTHESIZE
    │   ├─ for each candidate: LLM call → structured entry
    │   ├─ confidence = occurrence_count × agent_diversity
    │   └─ scope inference: ≥3 agents → global; team-tagged → team
    │
    ├─ PUBLISH (with CAS)
    │   ├─ semantic.put(entry, scope, provenance=dream)
    │   ├─ anti-patterns.put(entry, scope, provenance=dream)
    │   └─ procedural.put(refinement, expectedHash=current)
    │
    └─ DEDUP (cross-agent compaction)
        ├─ semantic_memory: merge identical facts (keep highest confidence)
        └─ vote: max(confidence_sum) wins
```

### Flow 4 — Multi-Agent Publish

```
Agent A discovers useful fact
    ↓
memoryService.publish({ entry, scope: "team", teamId: "T1" })
    ↓
ScopeRegistry.verifyWriteAccess(A, "team", "T1") → ok / PermissionDenied
    ↓
MemoryStore.put with scope=team, teamId=T1
    ↓
ProjectionLayer.invalidate team:T1 (lazy regen)
    ↓
─── later: Agent B (member of T1) starts task ───
    ↓
bootstrap.resolveVisibleScopes(B) includes team:T1
    ↓
MemoryStore.query returns A's published entry alongside B's own private entries
```

### Flow 5 — Resume from Checkpoint

```
runtime crash | user pause
    ↓
─── later: runtime.resume(checkpointId) ───
    ↓
CheckpointService.load(id):
    ├─ session_store.findById(sessionId) → messages
    ├─ working_memory snapshot from checkpoint blob
    └─ entropy log + step count
    ↓
runtime restores KernelState, continues loop from last iter+1
    ↓
memory-flush honors original task completion path (idempotent via task_id)
```

### Performance Budget

| Operation | Frequency | Target latency |
|---|---|---|
| Working memory read/write | Per LLM turn | <0.1ms |
| Episodic write (inline) | Per tool call | <5ms |
| Scope-aware query (bootstrap) | Once per task | <50ms |
| Projection regen | On publish (lazy) | <200ms |
| LightDream | Per session end | <2s |
| HeavyDream | Per cron tick | bounded by `llmBudgetTokens` |
| Checkpoint snapshot | Every N iter | <100ms |

## Section 4 — Interfaces & Contracts

### `MemoryStore` (foundational)

**Type definitions** (defined in `packages/memory/src/store/types.ts`):
- `Scope = "private" | "team" | "global"`
- `MemoryTier = "working" | "episodic" | "semantic" | "procedural" | "anti-pattern"`
- `Provenance = "agent" | "user" | "tool" | "system" | "llm-extraction" | "promoted" | "dream"`
- `CheckpointId` — branded string
- `Checkpoint = { id: CheckpointId, sessionId: string, iteration: number, createdAt: Date }`
- `MemoryVersion = { version: number, contentHash: string, content: string, createdAt: Date, changeReason?: string }`
- `AntiPatternEntry` — extends MemoryEntry with `failureSignature: string, condition: Record<string, unknown>, severity: "info"|"warn"|"critical"`
- `SkillRefinement = { skillId: string, oldVersion: number, newVersion: number, instructions: string, evidenceCount: number }`
- `LightDreamResult = { replayCount: number, refinedSkills: number, compressedEntries: number, extractedEntries: number, durationMs: number }`

```typescript
// packages/memory/src/store/memory-store.ts
export interface MemoryStore {
  get(id: MemoryId): Effect<MemoryEntry | null, StoreError>;

  put(entry: MemoryEntry): Effect<PutResult, StoreError>;

  /** Compare-and-set. Rejects if expectedHash != stored hash. */
  cas(entry: MemoryEntry, expectedHash: string): Effect<PutResult, StoreError | CASConflict>;

  query(filter: QueryFilter): Effect<MemoryEntry[], StoreError>;

  versions(id: MemoryId): Effect<MemoryVersion[], StoreError>;

  delete(id: MemoryId, expectedHash: string): Effect<void, StoreError | CASConflict>;
}

export interface PutResult {
  id: MemoryId;
  tier: MemoryTier;
  scope: Scope;
  version: number;
  contentHash: string;
}

export interface QueryFilter {
  tier?: MemoryTier;
  scopes: Scope[];
  agentId?: string;
  teamId?: string;
  tags?: string[];
  textSearch?: string;
  since?: Date;
  provenance?: Provenance[];
  minImportance?: number;
  limit?: number;
}
```

### `MemoryEntry` (extended schema)

```typescript
export const MemoryEntrySchema = Schema.Struct({
  // existing
  id: MemoryId,
  agentId: Schema.String,
  type: MemoryType,           // working|episodic|semantic|procedural|anti-pattern
  content: Schema.String,
  importance: Schema.Number.pipe(Schema.between(0, 1)),
  createdAt: Schema.DateFromSelf,
  updatedAt: Schema.DateFromSelf,
  source: MemorySourceSchema,
  tags: Schema.Array(Schema.String),
  metadata: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),

  // new in v2
  scope: Schema.Literal("private", "team", "global"),
  teamId: Schema.optional(Schema.String),
  version: Schema.Number,
  contentHash: Schema.String,                 // blake3
  provenance: Schema.Literal("agent", "user", "tool", "system", "llm-extraction", "promoted", "dream"),
  confidence: Schema.optional(Schema.Number.pipe(Schema.between(0, 1))),
});
```

### `ScopeRegistry`

```typescript
export interface ScopeRegistry {
  resolveVisibleScopes(agentId: string): Effect<{
    scopes: Scope[];
    teamIds: string[];
  }, ScopeError>;

  verifyWriteAccess(
    agentId: string,
    scope: Scope,
    teamId?: string
  ): Effect<void, PermissionDenied>;

  getTeamMembers(teamId: string): Effect<string[], ScopeError>;
}
```

### `LightDream` / `HeavyDream`

```typescript
export interface LightDream {
  run(agentId: string, sessionId: string): Effect<LightDreamResult, DreamError>;
}

export interface HeavyDream {
  run(opts: {
    since: Date;
    scope: "team" | "global";
    teamId?: string;
    llmBudgetTokens: number;
    maxCandidates?: number;
  }): Effect<HeavyDreamResult, DreamError>;
}

export interface HeavyDreamResult {
  candidatesEvaluated: number;
  entriesPublished: number;
  conflictsResolved: number;
  llmTokensUsed: number;
  durationMs: number;
  newAntiPatterns: AntiPatternEntry[];
  newSkillRefinements: SkillRefinement[];
}
```

### `CheckpointService`

```typescript
export interface CheckpointService {
  snapshot(sessionId: string, state: KernelState): Effect<CheckpointId, CheckpointError>;
  list(sessionId: string): Effect<Checkpoint[], CheckpointError>;
  load(checkpointId: CheckpointId): Effect<KernelState, CheckpointError>;
  prune(olderThan: Date): Effect<number, CheckpointError>;
}
```

### Consumer API Additions

```typescript
// MemoryService gains:
publish(id: MemoryId, scope: Scope, teamId?: string): Effect<PutResult, PublishError>;
republish(id: MemoryId, newScope: Scope): Effect<PutResult, PublishError>;
queryShared(filter: QueryFilter & { includeScopes: Scope[] }): Effect<MemoryEntry[], StoreError>;
```

### Backwards Compatibility

- All existing `MemoryService` methods unchanged in signature
- Legacy reads default missing fields: `scope=private`, `version=1`, `provenance=agent`
- Legacy writes default `scope=private`
- `content_hash` nullable on legacy rows; computed on first read

### Lean Mode Interaction

`withLeanHarness()` opts out of expensive v2 features. Lean-mode behavior:

| Feature | Default (full) | Lean mode |
|---|---|---|
| MemoryStore + CAS | On | On |
| ScopeRegistry (private only) | On | On |
| Working-memory promotion | On | On |
| CheckpointService | On | Off |
| LightDream | On | Off |
| HeavyDream | Off (opt-in) | Off (cannot enable) |
| FilesystemStore | Off (opt-in) | Off (cannot enable) |
| Projection regen on publish | On | Off |

Rationale: lean targets local-model users (cogito:14b on consumer hardware). LLM-driven dreaming + filesystem introspection would degrade their latency/cost without benefit.

### `withMemoryV2()` Configuration

```typescript
export interface MemoryV2Config {
  // Storage
  store?: "sqlite" | "filesystem" | MemoryStore;  // default "sqlite"

  // Promotion
  workingMemoryPromotionThreshold?: number;  // default 0.7

  // Dreaming
  dreaming?: {
    light?: boolean;  // default true
    heavy?: { enabled: boolean; llmBudgetTokens?: number; maxCandidates?: number };  // default { enabled: false }
  };

  // Scoping
  scope?: {
    defaultScope?: Scope;  // default "private"
    teamId?: string;
    autoPublishConfidenceThreshold?: number;  // default 0.85
  };

  // Lifecycle
  checkpoint?: {
    enabled?: boolean;  // default true
    everyNIterations?: number;  // default 10
    everyMTokens?: number;  // default 50000
  };

  // Anti-patterns
  antiPatterns?: {
    minOccurrences?: number;  // default 3
    minAgentDiversity?: number;  // default 2
  };
}
```

## Section 5 — Error Handling & Testing

### Error Taxonomy

| Error | Trigger | Recovery |
|---|---|---|
| `CASConflict` | Concurrent write, hash mismatch | Retry 3x exponential backoff; on final fail, write to private fork + emit `MemoryConflictDetected` |
| `PermissionDenied` | Agent writes to scope it doesn't own | Reject at API boundary; emit telemetry; no partial write |
| `StoreError` | Backend I/O failure | Surface to caller; runtime falls back to `WorkingMemoryService` only |
| `DreamError` (partial) | HeavyDream mid-batch failure | Commit processed candidates; persist resume cursor |
| `DreamError` (budget exceeded) | LLM token cap hit | Stop after current candidate; emit `DreamBudgetExhausted` |
| `CheckpointError` (corrupted) | Blob fails schema validation | Fall back to `session_store` transcript replay |
| `ScopeError` (unknown team) | `teamId` not in registry | Reject write; filter team scope out of reads |
| `ProjectionError` (disk full) | FilesystemStore write fails | Switch to SQLite-only for session; warning surfaced |

### Idempotency

| Operation | Key | Guard |
|---|---|---|
| `MemoryStore.put` | `(agentId, contentHash)` | Duplicate returns existing id |
| `LightDream.run` | `(agentId, sessionId)` | Re-run no-op via cursor |
| `HeavyDream.run` | `(scope, teamId?, since)` | Cursor advances only on full success |
| `CheckpointService.snapshot` | `(sessionId, iteration)` | Same-iter overwrite is idempotent |
| `MemoryService.publish` | `(id, expectedHash)` | CAS-guarded |

### Concurrency Model

- Single-agent intra-session: single-threaded loop; no locking
- Single-agent cross-session: SQLite WAL + CAS
- Multi-agent shared: CAS with content_hash; conflict = last-writer-loses-fork
- HeavyDream: single-writer via `dream_runs` table lock + 1hr stale-breaker

### Observability (trace events)

```
memory.read         { tier, scope, agentId, resultCount, latencyMs }
memory.write        { tier, scope, agentId, provenance, version, contentHash }
memory.cas_conflict { tier, agentId, retryAttempt }
memory.publish      { from_scope, to_scope, teamId }
dream.light_complete { agentId, sessionId, replayCount, refinedSkills, durationMs }
dream.heavy_complete { scope, candidatesEvaluated, entriesPublished, llmTokensUsed }
checkpoint.snapshot  { sessionId, iter, sizeBytes }
checkpoint.resume    { sessionId, fromIter, toIter }
```

All routed through `packages/trace/`.

### Testing Strategy

| Layer | Test type | Coverage |
|---|---|---|
| `MemoryStore` (both impls) | Contract tests | 100% interface methods, CAS edge cases, scope filters |
| `ScopeRegistry` | Unit + integration with identity package | Team membership, write enforcement |
| `LightDream` | Integration with deterministic session fixtures | REPLAY accuracy, refinement trigger, idempotent re-run |
| `HeavyDream` | Integration with mocked LLM + fixture sessions | Pattern detection, dedup, CAS conflicts, budget enforcement |
| `AntiPatternsTier` | Unit | Severity scoring, condition matching, migration from experience_store |
| `CheckpointService` | Property tests | Snapshot → resume yields identical KernelState; corrupted-blob recovery |
| `CASEnvelope` | Stress test (N agents × M writes) | No data loss, all conflicts logged, deterministic resolution |
| Runtime integration | End-to-end: A publishes team, B reads next session | Cross-agent visibility, scope filtering |
| Migration | v1 DB → v2 code | Defaults correct, no data loss, idempotent |

### Regression Gates

1. All existing memory tests (38 from M10 Phase 1) pass unchanged
2. Performance: bootstrap query <50ms p99, inline observe <5ms p99
3. v1 DB opened by v2 code returns same entries
4. CAS contention: 10 agents × 100 writes/sec, zero data loss, ≤5% conflict rate

### Multi-Model Validation (per North Star §6 lift rule)

- `local` (cogito:14b): verify scope filtering doesn't degrade context quality
- `cloud-budget` (gpt-4o-mini): verify HeavyDream pattern detection accuracy
- `cloud-frontier` (claude-sonnet-4-6): verify FilesystemStore introspection useful

Lift threshold: ≥3pp first-attempt accuracy improvement on multi-session bench vs v1.

## Section 6 — Rollout, Migration & Open Questions

### Phased Rollout

| Phase | Scope | Audit gaps closed | Effort | Release |
|---|---|---|---|---|
| **v2.0** Foundation | `MemoryStore` interface + SQLite extraction + schema migration + version log + CAS | Concurrency, version history | 1 wk | v0.12 |
| **v2.1** Long-task durability | `CheckpointService` + working-memory promotion + entropy-driven flush dispatch + remove daemon-fork race | Working memory discard, flush race, resumability | 1 wk | v0.12 |
| **v2.2** Multi-agent sharing | `ScopeRegistry` + scopes + `MemoryService.publish` + team registry wired through `identity` | Cross-agent permission model | 1.5 wk | v0.13 |
| **v2.3** Dreaming + anti-patterns | `LightDream` rename + `HeavyDream` scheduler + `AntiPatternsTier` + `skill-portability.ts` activation + CLI | Cross-session learning, Day N+1 smarter, failure knowledge | 2 wk | v0.13 |
| **v2.4** Projection + filesystem | `ProjectionLayer` extension + `FilesystemStore` opt-in | Agent introspection, thesis property set | 1 wk | v0.14 |

Total: ~6.5 weeks across 3 releases. Each phase independently shippable. Default-on per phase gated by ablation-warden + lift rule; otherwise opt-in via `withMemoryV2({...})`; otherwise remove.

### Schema Migration (one-time, idempotent)

```sql
ALTER TABLE semantic_memory ADD COLUMN scope TEXT NOT NULL DEFAULT 'private';
ALTER TABLE semantic_memory ADD COLUMN team_id TEXT;
ALTER TABLE semantic_memory ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE semantic_memory ADD COLUMN content_hash TEXT;
ALTER TABLE semantic_memory ADD COLUMN provenance TEXT NOT NULL DEFAULT 'agent';
ALTER TABLE semantic_memory ADD COLUMN confidence REAL;
-- same for episodic_log, procedural_memory

CREATE TABLE memory_versions (
  id TEXT, version INTEGER, content TEXT, content_hash TEXT,
  agent_id TEXT, created_at INTEGER, change_reason TEXT,
  PRIMARY KEY (id, version)
);

CREATE TABLE anti_patterns (
  id TEXT PRIMARY KEY, failure_signature TEXT NOT NULL,
  condition_json TEXT NOT NULL, severity TEXT NOT NULL,
  occurrences INTEGER, scope TEXT, team_id TEXT,
  agent_id TEXT, created_at INTEGER, updated_at INTEGER
);

CREATE TABLE dream_runs (
  id TEXT PRIMARY KEY, kind TEXT, scope TEXT, team_id TEXT,
  started_at INTEGER, completed_at INTEGER, cursor TEXT,
  candidates_evaluated INTEGER, entries_published INTEGER
);

CREATE TABLE checkpoints (
  id TEXT PRIMARY KEY, session_id TEXT, iteration INTEGER,
  state_blob BLOB, created_at INTEGER
);

CREATE INDEX idx_semantic_scope_agent ON semantic_memory(scope, agent_id);
CREATE INDEX idx_episodic_scope_agent ON episodic_log(scope, agent_id);
CREATE INDEX idx_procedural_scope_agent ON procedural_memory(scope, agent_id);
```

`content_hash` computed on write only; column nullable initially. Legacy entries tolerate null hash on reads; CAS operations require non-null hash (first write computes and stores).

### North Star Integration

Insert new chapter under `wiki/Architecture/Specs/05-DESIGN-NORTH-STAR.md`:

- **§4.5 Memory Primitives (NEW)** — between §4 Capabilities and §5 Trust Labels
  - Defines 2-axis model (5 tiers × 3 scopes)
  - Defines dreaming as first-class cognitive primitive
  - Defines `MemoryStore` as foundational interface
  - Defines anti-patterns as a tier
- **§3 Cognitive Loop diagram** — `LearningPipeline` placeholder resolves to LightDream + HeavyDream
- **§6 Phase plan** — M10 row updates to "v2 unified rewrite, Phases v2.0–v2.4"
- **§G-3 "Memory not async"** — mark RESOLVED in v2.3
- **§9 anti-pattern catalog** — add "Scaffold dream consumer without active reader"

### Open Questions

| # | Question | Resolution path |
|---|---|---|
| 1 | Team registry source: explicit `teamId` at construction vs derived from `identity`? | Spike at v2.2 kickoff |
| 2 | HeavyDream LLM cost: default budget cap? | 100k tokens/run default; tune from prod data |
| 3 | CAS contention frequency | Telemetry-only in v2.0; revisit if `memory.cas_conflict` > 1% writes |
| 4 | FilesystemStore consistency under external edits | Detect via mtime + content_hash drift; re-import on next read |
| 5 | Anti-pattern false positives | Min diversity threshold + manual review CLI |
| 6 | Working memory promotion threshold (0.7) | Configurable; instrument distribution |
| 7 | HeavyDream scheduler: cron / daemon / k8s / GH Action? | Ship CLI first; let users pick |
| 8 | Scope upgrade path | `republish()` rewrites scope, bumps version, preserves history |
| 9 | Performance regression risk from scope joins | Bench against v1; index `(scope, agent_id, tier)` |
| 10 | Local model context burden from scope joins | Cap by importance + recency; per-tier limits |

## Section 7 — Impact Analysis

### What Changes For Agents

| Capability | Before | After |
|---|---|---|
| Knowledge persists across sessions | Partial (raw episodic logs only) | Distilled patterns + skills + anti-patterns auto-applied |
| Working insights survive session | No (Ref discarded) | Importance ≥0.7 promoted to episodic |
| Agent A learns → Agent B benefits | Impossible | Explicit publish OR HeavyDream auto-aggregation |
| Long task survives crash | No | Checkpoint-resumable |
| Agent introspects own knowledge | Tool call only | bash/grep on `memory.md` (frontier models) |
| Failure patterns prevent repeat | Implicit counter | Explicit anti-patterns tier in context |

### What Changes For Framework

- `packages/memory/` LOC grows ~40% (6 new modules + schema extensions)
- Runtime gains entropy → flush dispatch signal and optional checkpoint phase
- Identity package gains team registry consumer
- Eval harness gains multi-session bench fixtures
- Observability gains 8 new trace events
- Public API additive only — zero breaking changes
- New CLI commands: `reactive-agents dream`, `reactive-agents anti-patterns review`, `reactive-agents resume <checkpoint-id>`

### What Changes For Architecture

- `LearningPipeline` placeholder resolves to LightDream + HeavyDream
- G-3 "Memory not async" resolved
- New North Star §4.5 chapter elevates Memory to first-class cognitive primitive
- 2-axis model (tier × scope) is conceptually new
- M10 verdict: IMPROVE → KEEP (gaps closed)
- New mechanism candidate: M14 Dreaming

### Strategic Effects

- **Differentiation:** dreaming has no equivalent in LangGraph / Swarm / Mastra
- **Enterprise unlock:** permission model + version log + content-hash CAS
- **Show-HN positioning:** v0.11 "composable reasoning" → v0.13 "self-improving fleets"
- **Local model parity:** pluggable backend keeps cogito:14b correctness; frontier users get filesystem introspection bonus

### Costs / New Burdens

| Burden | Severity |
|---|---|
| HeavyDream LLM cost per tick | Medium — bounded by cap |
| Schema migration risk | Low — additive, idempotent |
| CAS contention multi-agent | Low — telemetry-gated |
| 5 new components to maintain | Medium — each ≤1 file, each maps to 1 gap |
| Cron/scheduler setup | Medium — initially user-driven |
| Local model context bloat from scope joins | Medium — mitigated by caps |
| Dream false-positive anti-patterns | Medium — confidence + review |
| Documentation burden | Medium — chapter + 3 user guides |

### Failure Modes If Implemented Poorly

1. Dream output crowds out agent knowledge → confidence threshold + max-dream-entries cap
2. CAS deadlocks under high write → exponential backoff + private-fork fallback
3. Schema migration silent corruption from race → compute hash on write only; nullable legacy reads
4. HeavyDream cost runaway → hard cap + circuit breaker
5. Anti-pattern poisoning from fluke errors → minimum agent diversity + manual review
6. Filesystem store divergence from user edits → mtime + content_hash detection; surface conflict not overwrite

### Net Verdict

High-leverage move. Closes every Critical and Major audit gap in one cohesive design while adding three strategic capabilities (dreaming, multi-agent sharing, checkpoint resume) absent from competing frameworks. Cost ~6.5 weeks across three releases. Each phase independently shippable and gated by the lift rule — no big-bang risk.

**Caveat:** Success depends on HeavyDream producing useful patterns. If LLM-driven pattern detection yields garbage, the "Day N+1 starts smarter" claim collapses. Recommend ship v2.0–v2.2 first (foundation + long-task + sharing), then validate HeavyDream on real session data before committing to v2.3 scope.

## Section 8 — Success Metrics

| Metric | Baseline | v2 target |
|---|---|---|
| Multi-session recall (verbose query) | 66.7% | ≥80% (M10 P1.5 target met) |
| Cross-agent knowledge utility | 0 | ≥1 published team entry consumed per session in team scenarios |
| Repeated mistakes after 5+ sessions | unmeasured | ≤10% (per thesis ~90% reduction claim) |
| Day N+1 first-attempt task success | unmeasured | +5pp over Day N first session |
| Working memory loss rate | 100% | ≤10% (only items <0.7 importance lost) |
| Long-task crash recovery | impossible | resumable from last checkpoint |
| Concurrent multi-agent writes | unsafe | safe; conflicts logged |

## Appendix A — File Manifest (Net-New)

```
packages/memory/src/
  store/
    memory-store.ts                 # interface
    sqlite-store.ts                 # extracted from database.ts
    filesystem-store.ts             # v0.14 opt-in
  scope/
    scope-registry.ts
  dreaming/
    light-dream.ts                  # renamed from services/memory-consolidator.ts
    heavy-dream.ts                  # NEW scheduler
    pattern-detector.ts             # LLM-driven detection
    cli.ts                          # reactive-agents dream
  checkpoint/
    checkpoint-service.ts
  services/
    anti-patterns.ts                # NEW tier
    memory-consolidator.ts          # deprecated re-export → LightDreamService (1 release)
  projection/
    projection-layer.ts             # extends memory-file-system.ts
```

## Appendix B — Trace Event Reference

| Event | Required fields | Purpose |
|---|---|---|
| `memory.read` | tier, scope, agentId, resultCount, latencyMs | Read perf monitoring |
| `memory.write` | tier, scope, agentId, provenance, version, contentHash | Audit log substrate |
| `memory.cas_conflict` | tier, agentId, retryAttempt | Concurrency monitoring |
| `memory.publish` | from_scope, to_scope, teamId | Cross-agent sharing visibility |
| `dream.light_complete` | agentId, sessionId, replayCount, refinedSkills, durationMs | Per-session learning |
| `dream.heavy_complete` | scope, candidatesEvaluated, entriesPublished, llmTokensUsed | Cross-agent learning |
| `checkpoint.snapshot` | sessionId, iter, sizeBytes | Long-task durability |
| `checkpoint.resume` | sessionId, fromIter, toIter | Recovery monitoring |

## Appendix C — Related Documents

- [[05-DESIGN-NORTH-STAR]] — current North Star (will gain §4.5)
- [[M10 Memory System]] — original spike + verdict
- [[2026-05-23-harness-convergence]] — sibling convergence morph spec
- [[FM-F Context and Memory]] — failure modes mitigated
- Audit transcript: this session, 2026-05-23 (3-agent parallel + advisor-verified)
- Source thesis: "Memory is the next critical primitive for AI agents" (Anthropic-style)
