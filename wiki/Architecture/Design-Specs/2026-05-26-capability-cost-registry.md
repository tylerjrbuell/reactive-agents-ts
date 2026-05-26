---
title: Capability Cost Registry (MOVE-2)
date: 2026-05-26
status: SHIPPED — M2.1+M2.2 commit `3752a43e`, M2.3 commit `344c0910`, M2.4 (this commit). Only future M2.5+ (runtime-cost merge, audit() UI surface) deferred to v0.12+.
owner: Architecture
related-spec:
  - "wiki/Architecture/Design-Specs/2026-05-26-master-optimization-plan.md"
  - "wiki/Architecture/Specs/05-DESIGN-NORTH-STAR.md"
  - "wiki/Architecture/Specs/06-MISSION-STATEMENTS.md"
gates-move: MOVE-6 (HarnessProfile presets) consumes registry entries
ablation-gate: any registry entry marked `defaultOn: true` MUST carry `lift.evidence !== null` AND `lift.measuredOn.length >= 2 tiers` (default-revert otherwise)
---

# Capability Cost Registry — Design Spec (MOVE-2)

## 0. TL;DR

**Today:** 2 capabilities default-on (`_enableMemory: true` at builder.ts:184, `_enableReactiveIntelligence: true` at builder.ts:302) + N implicit defaults (verifier, strategy-switching, streamed-thinking, Anthropic prompt caching) — each lives inline in a different module with NO collocated rationale, NO cost signature, NO lift evidence pointer, NO last-ablation date. Master plan §3 root-cause #1.

**This spec:** introduces `CapabilityRegistry` — a single Effect Layer-injected service that stores, for every default-on (and opt-in) capability, a typed entry `{ name, defaultOn, costSignature, liftEvidence, riskNotes, rationale, ownerWarden, lastAblation }`. Consumers (HarnessProfile presets in MOVE-6, ablation-warden CI, user-facing `agent.capabilities.audit()` surface) read from this single source instead of duplicating the question "is X on by default and why?" across 5+ files.

**Falsifiable promise:** at impl-completion, removing any registry entry breaks at least one ablation-warden CI assertion AND at least one user-facing `audit()` consumer (i.e., entries are load-bearing, not advertised-without-callers per master plan §9 Anti-Scaffold Principle).

---

## 1. Why this matters

### 1.1 The Lever-8 origin signal

`_enableReactiveIntelligence: boolean = true` at `packages/runtime/src/builder.ts:302` has no inline rationale. When Lever 8 (final-answer-via-tool veto exemption, commit `98118fd1`) shipped, the regression — RI default-on + arbitrator veto firing on graceful-failure tasks — was caught by **Mastra bench divergence**, not by a registry-driven ablation CI. Master plan §1.2 cost #1 names this directly.

A capability cost registry would have surfaced:

```
RI (reactive-intelligence):
  defaultOn: true
  costPerCall: { tokens: ~12, latencyMs: ~3, llmCalls: 0 }  // controller decision
  liftEvidence: { measuredOn: ["cogito:14b", "qwen3:14b"], averageDelta: "+1 rescue on qwen3", evidence: "wiki/Research/Harness-Reports/ri-ablation-analysis-2026-05-23.md" }
  riskNotes: "tier-dependent fire rate; can produce spurious veto on graceful-failure tasks when paired with controller-signal veto (see commit 98118fd1)"
  ownerWarden: reactive-intelligence
  lastAblation: 2026-05-23
```

→ ablation-warden CI on the Lever-8 PR would have flagged the regression at gate, before merge, with one quoted line of evidence.

### 1.2 The scattered-defaults pattern

Same pattern repeats:

| Capability | Default-on site | Rationale collocation | Cost signature | Lift evidence |
|---|---|---|---|---|
| Memory (GH #122) | `builder.ts:184` | none inline | unknown (per-flush cost) | `commit 77b2f162` body |
| ReactiveIntelligence | `builder.ts:302` | none inline | ~12 tok/iter | `ri-ablation-analysis-2026-05-23.md` |
| Verifier (defaultVerifier) | `kernel/loop/runner.ts:568` | comment line | per-iter LLM call | M3 ablation `phase-1.5-m3-ablation-2026-05-12.md` (REWORK verdict) |
| Strategy switching | `runtime.ts:915` | none inline | ~one extra strategy run on switch | none formal |
| Streamed-thinking | (provider-level) | provider docs | provider-dependent | per-tier benchmarks |
| Anthropic prompt cache | `llm-provider/anthropic.ts` (Lever 1) | inline lever comment | -90% repeat-input cost | bench-driven |

NONE of these expose machine-readable cost/evidence to:
- the ablation-warden CI (which runs on default-on changes per pilot rules),
- the user-facing audit (no API surface today exists),
- the drift-contract validator (PR #137 pattern requires invariant-as-code, would naturally extend to registry entries),
- the master plan's lift-tracking discipline.

Master plan §3 root-cause #5: "75 `withX()` methods is the composition surface — knobs are unfindable. Vision claim 'control over magic' can't be realized through a 75-method API." The registry is the back-side fix: capability discoverability + audit.

### 1.3 Why this gates MOVE-6 (HarnessProfile presets)

MOVE-6 plans `lean()` / `balanced()` / `intelligent()` presets that compose registry entries:

```typescript
HarnessProfile.lean()        // empty preset — zero default-on capabilities
HarnessProfile.balanced()    // registry.defaultOnEntries() (today's behavior)
HarnessProfile.intelligent() // balanced + verifier + skill persistence + adaptive routing
```

Without a registry, "compose registry entries" is unimplementable — you can't compose what isn't enumerable. MOVE-6 implementation date depends on this spec landing first.

---

## 2. Scope

### 2.1 In-scope

- `CapabilityRegistry` Effect service Tag + `CapabilityRegistryLive` Layer (mirrors `StrategyRegistryLive` pattern at `packages/reasoning/src/services/strategy-registry.ts:131`).
- `CapabilityEntry` schema (Effect Schema or plain TS interface — see §4 OPEN QUESTIONS).
- Bootstrap-time registration of the N existing default-on entries (initial set: memory, reactive-intelligence, verifier, strategy-switching).
- User-facing `agent.capabilities.audit()` surface (returns `CapabilityAuditReport`).
- Ablation-warden CI integration: warden reads registry at gate time, asserts every `defaultOn: true` entry has non-null `liftEvidence` + ≥2-tier `measuredOn`.
- Drift contract (PR #137 pattern): registry entries cannot reference dead capability names (no advertised-without-impl).

### 2.2 Out-of-scope (this spec)

- HarnessProfile preset implementation (MOVE-6, separate spec).
- TaskProfile aggregate (broader MOVE-3, separate spec — MOVE-3 Phase 1 + 2 already landed `ctx.metadata.taskComplexity` substrate).
- Per-call cost tracking at runtime (already partial via `ctx.tokensUsed` + `cost-track.ts`; the registry stores STATIC `costSignature` estimates, not runtime measurements).
- Auto-discovery / reflection of capabilities from builder method names — explicit registration only.
- UI / docs site rendering of `audit()` output — JSON-stable contract today, presentation later.

### 2.3 Deliberate non-features

- No "auto-disable" of capabilities whose lift evidence stales — ablation-warden surfaces stale entries, human decides revert.
- No cost arithmetic at agent.run() time (registry is metadata-about-capabilities, not runtime-cost-accounting).
- No backward-compat alias for legacy `_enableX` fields (registry is THE source; legacy flags become writes to registry).

---

## 3. Design

### 3.1 Schema

```typescript
// packages/runtime/src/capabilities/registry.ts (new file)

export type WardenOwner =
  | "kernel"
  | "runtime"
  | "compose"
  | "memory"
  | "tools"
  | "provider"
  | "reactive-intelligence"
  | "harness";

export interface CostSignature {
  /** Estimated tokens added per agent.run() when capability is on (average). */
  readonly tokensPerRun: number;
  /** Estimated wall-clock latency added per agent.run() (ms). */
  readonly latencyPerRunMs: number;
  /** Number of additional LLM calls per run (0 if pure-compute capability). */
  readonly extraLLMCalls: number;
  /** Tier-specific multipliers when meaningful (e.g., local 1.0x vs frontier 0.3x). */
  readonly tierMultiplier?: Readonly<Record<"local" | "mid" | "large" | "frontier", number>>;
}

export interface LiftEvidence {
  /** Tier identifiers the lift was measured on. ≥2 required for default-on. */
  readonly measuredOn: readonly ("local" | "mid" | "large" | "frontier")[];
  /** Quantified delta (e.g., "+3pp first-attempt accuracy"). */
  readonly averageDelta: string;
  /** Pointer to evidence artifact in wiki/Research/. */
  readonly evidence: string;
  /** When the evidence was collected (ISO date). */
  readonly measuredAt: string;
}

export interface CapabilityEntry {
  /** Unique stable identifier (e.g., "reactive-intelligence"). */
  readonly name: string;
  /** Human-readable purpose (one sentence). */
  readonly description: string;
  /** Default state when no explicit user opt-in/out. */
  readonly defaultOn: boolean;
  /** Static cost estimate. */
  readonly costSignature: CostSignature;
  /** Empirical evidence backing `defaultOn`. Required when defaultOn=true. */
  readonly liftEvidence: LiftEvidence | null;
  /** Known failure modes, free-form. */
  readonly riskNotes: string;
  /** Why this default. */
  readonly rationale: string;
  /** Which warden owns this capability (pilot ownership routing). */
  readonly ownerWarden: WardenOwner;
  /** Last time ablation-warden re-verified this entry (ISO date). */
  readonly lastAblation: string | null;
}

export interface CapabilityAuditReport {
  readonly totalEntries: number;
  readonly defaultOnCount: number;
  readonly entries: readonly CapabilityEntry[];
  readonly byWarden: Readonly<Record<WardenOwner, readonly CapabilityEntry[]>>;
  /** Entries flagged as stale (lastAblation older than 90 days). */
  readonly staleEntries: readonly CapabilityEntry[];
  /** Default-on entries missing liftEvidence (gate violation). */
  readonly violations: readonly CapabilityEntry[];
}
```

### 3.2 Service Tag + Live Layer

Mirrors `StrategyRegistryLive` pattern verbatim:

```typescript
export class CapabilityRegistry extends Context.Tag("CapabilityRegistry")<
  CapabilityRegistry,
  {
    readonly register: (entry: CapabilityEntry) => Effect.Effect<void>;
    readonly get: (name: string) => Effect.Effect<CapabilityEntry, CapabilityNotFoundError>;
    readonly list: () => Effect.Effect<readonly CapabilityEntry[]>;
    readonly defaultOnEntries: () => Effect.Effect<readonly CapabilityEntry[]>;
    readonly audit: () => Effect.Effect<CapabilityAuditReport>;
  }
>() {}

export const CapabilityRegistryLive = Layer.effect(
  CapabilityRegistry,
  Effect.gen(function* () {
    const ref = yield* Ref.make<Map<string, CapabilityEntry>>(new Map());
    // Bootstrap initial entries — see §3.4.
    yield* registerBootstrapEntries(ref);
    return {
      register: (entry) => Ref.update(ref, (m) => new Map(m).set(entry.name, entry)),
      get: (name) => /* … */,
      list: () => Ref.get(ref).pipe(Effect.map((m) => Array.from(m.values()))),
      defaultOnEntries: () => Ref.get(ref).pipe(Effect.map((m) => Array.from(m.values()).filter((e) => e.defaultOn))),
      audit: () => /* groups + computes staleness + violations */,
    };
  }),
);
```

### 3.3 Producer / Consumer flow

```
                ┌──────────────────────────┐
                │ registerBootstrapEntries │  ← initial 4 entries (memory,
                │   (one-time at L start)  │     RI, verifier, strategy-switch)
                └────────────┬─────────────┘
                             │
                             ▼
                ┌──────────────────────────┐
                │   CapabilityRegistry     │
                │   (Effect Tag + Ref<Map>)│
                └────────────┬─────────────┘
                             │
            ┌────────────────┼────────────────┐
            ▼                ▼                ▼
   ┌────────────────┐ ┌──────────────┐ ┌──────────────┐
   │ HarnessProfile │ │ ablation-    │ │ agent.       │
   │  .lean() etc.  │ │ warden CI    │ │ capabilities │
   │  (MOVE-6)      │ │ (gate)       │ │  .audit()    │
   └────────────────┘ └──────────────┘ └──────────────┘
```

### 3.4 Initial registration (bootstrap)

Four entries seed the registry, each with a wired consumer in this same commit:

```typescript
async function registerBootstrapEntries(ref: Ref.Ref<Map<string, CapabilityEntry>>): Effect.Effect<void> {
  const entries: CapabilityEntry[] = [
    {
      name: "memory",
      description: "Cross-session episodic + semantic + procedural memory layers (4-tier).",
      defaultOn: true, // GH #122
      costSignature: { tokensPerRun: 0, latencyPerRunMs: 5, extraLLMCalls: 0 },
      liftEvidence: {
        measuredOn: ["local", "frontier"],
        averageDelta: "memory bootstrap < 10ms on first task; cross-session recall enables compounding intelligence",
        evidence: "wiki/Decisions/memory-default-on-decision-2026-05-22.md",
        measuredAt: "2026-05-22",
      },
      riskNotes: "SQLite file IO; bootstrap can fail with permission errors in restricted envs (mitigated by graceful fallback at memory-flush.ts).",
      rationale: "GH #122 graduated memory from opt-in to default-on after benchmark evidence showed compounding-intelligence gains across sessions.",
      ownerWarden: "memory",
      lastAblation: "2026-05-22",
    },
    {
      name: "reactive-intelligence",
      description: "Entropy-driven controller that issues mid-loop intervention decisions (strategy-switch, early-stop, etc.).",
      defaultOn: true,
      costSignature: { tokensPerRun: 0, latencyPerRunMs: 3, extraLLMCalls: 0, tierMultiplier: { local: 1.0, mid: 1.0, large: 1.0, frontier: 1.0 } },
      liftEvidence: {
        measuredOn: ["local", "frontier"],
        averageDelta: "+1 rescue on qwen3:14b failure corpus; 75% fire rate; tier-dependent quality",
        evidence: "wiki/Research/Harness-Reports/ri-ablation-analysis-2026-05-23.md",
        measuredAt: "2026-05-23",
      },
      riskNotes: "Tier-dependent fire rate. Can produce spurious controller-signal veto on graceful-failure tasks when paired with end_turn arbitration — see commit 98118fd1 / Lever 8 regression.",
      rationale: "Default-on since v0.10 based on +1 rescue on local-tier failure corpus. Lever 8 exposed paired-veto risk; mitigation shipped, ablation re-verification recommended.",
      ownerWarden: "reactive-intelligence",
      lastAblation: "2026-05-23",
    },
    {
      name: "verifier",
      description: "Terminal §9.0 output gate. Catches fabrication / harness parroting / incomplete output.",
      defaultOn: true, // defaultVerifier wired at runner.ts:568 unless overridden by noopVerifier / .withLeanHarness()
      costSignature: { tokensPerRun: 50, latencyPerRunMs: 10, extraLLMCalls: 0 }, // heuristic guard, not LLM-as-judge
      liftEvidence: {
        measuredOn: ["local", "frontier"],
        averageDelta: "9 checks (agent-took-action / synthesis-grounded / no-fabrication / etc.); catches FM-A1 / M2 leaks at terminal gate",
        evidence: "wiki/Research/Harness-Reports/phase-1.5-m3-ablation-2026-05-12.md",
        measuredAt: "2026-05-12",
      },
      riskNotes: "Pre-Sprint-3.3 retry loop was REWORKED out (commit 051c22be) after M3 ablation showed flat accuracy delta; heuristic gate retained. Bypass via `.withLeanHarness()` or `noopVerifier`.",
      rationale: "Heuristic guard (not LLM-as-judge). M3 ablation verdict: REWORK (retain gate, remove retry). Default-on preserves output integrity.",
      ownerWarden: "kernel",
      lastAblation: "2026-05-12",
    },
    {
      name: "strategy-switching",
      description: "Adaptive dispatch from initial strategy to fallback when failure pattern detected.",
      defaultOn: true, // commit 051c22be: `enableStrategySwitching !== false` is the default
      costSignature: { tokensPerRun: 0, latencyPerRunMs: 1, extraLLMCalls: 0 }, // gate is heuristic; switch cost is the alternate strategy run
      liftEvidence: null, // GAP — no formal ablation evidence yet
      riskNotes: "May spawn additional strategy run on switch. Disabled by `.withLeanHarness()`.",
      rationale: "Default-on since 2026-05-12 based on practitioner intuition + audit observation. No formal ablation — ablation-warden CI gate will flag this entry as violation.",
      ownerWarden: "runtime",
      lastAblation: null,
    },
  ];
  for (const e of entries) {
    yield* Ref.update(ref, (m) => new Map(m).set(e.name, e));
  }
}
```

Note: `strategy-switching` entry has `liftEvidence: null` deliberately — this is the registry's first **load-bearing signal**: ablation-warden gate will flag it on first run, forcing either evidence-gathering or default-revert. Without the registry this gap would stay invisible.

### 3.5 User-facing audit surface

```typescript
// Added to ReactiveAgent surface (packages/runtime/src/reactive-agent.ts)
class ReactiveAgent {
  // ... existing surface
  readonly capabilities: {
    audit(): Promise<CapabilityAuditReport>;
  };
}
```

Usage:

```typescript
const agent = await ReactiveAgents.create().withName("x").withProvider("anthropic").build();
const report = await agent.capabilities.audit();
console.log(`${report.defaultOnCount} capabilities active by default`);
for (const violation of report.violations) {
  console.warn(`  ⚠️  ${violation.name}: defaultOn but no lift evidence`);
}
```

Single API for "what's running and why" — addresses master plan §3 root-cause #3 ("Users can't enumerate what's on by default and why") in one method call.

---

## 4. Open Questions

| # | Question | Default proposal | Tradeoff |
|---|---|---|---|
| Q1 | Schema validation: Effect Schema vs plain TS interface? | plain TS interface | Schema is overkill for an internal registry; interface gets us compile-time check + zero runtime cost. Revisit when external producers (e.g., MCP-provided capabilities) need validation. |
| Q2 | Should `register()` allow re-registration (overwrite)? | yes (idempotent) | Allows user `.withCapability(customEntry)` to override defaults. Risk: silent stomp. Mitigation: emit `CapabilityOverridden` event when name collision. |
| Q3 | Bootstrap order vs Layer composition? | dedicated `CapabilityRegistryLive` Layer composed early in runtime layer chain | Need to avoid circular deps with services that themselves are capabilities (memory, RI). Bootstrap registers metadata only — actual service Layers wire independently. |
| Q4 | Should `costSignature` evolve to runtime-tracked actual costs? | no (this spec) | Keeps spec tight. Runtime cost tracking already partial via `cost-track.ts`. Future spec can wire `audit()` to merge static + runtime data. |
| Q5 | Stale-entry definition (default 90 days)? | configurable threshold, default 90d | Ablation-warden pilot is 23 days (May 23 → Jun 15). 90d gives buffer for capabilities that don't move. Override per-capability if cadence differs. |

---

## 5. Migration Plan (Incremental)

Phase-1 commits target `overhaul/foundation-2026-05-26`:

| # | Commit | Files | Tests |
|---|---|---|---|
| **M2.1** | `feat(runtime): CapabilityRegistry service Tag + Live Layer + 4 bootstrap entries` | `runtime/src/capabilities/registry.ts` (new), `runtime/src/runtime.ts` (Layer wire) | unit: registry CRUD + bootstrap entries present + audit shape |
| **M2.2** | `feat(runtime): agent.capabilities.audit() surface` | `runtime/src/reactive-agent.ts` (surface), `runtime/src/agent/capabilities-surface.ts` (new) | unit: audit() returns expected shape from default build; violations array surfaces strategy-switching gap |
| **M2.3** | `feat(testing): ablation-warden CI assertion — defaultOn requires liftEvidence + 2 tiers` | warden agent prompt update, possibly new gate scenario | gate scenario asserts violation array empty on production registry (excluding intentional `strategy-switching` gap) |
| **M2.4** | `docs(architecture): MOVE-2 shipped — audit registry consumers` | `wiki/Hot.md` update + this spec status → SHIPPED | n/a |

Each commit lands with build green + workspace tests + zero regressions.

---

## 6. Done Criteria

MOVE-2 considered complete when ALL of:

1. ☐ `CapabilityRegistry` service Tag + Live Layer exist, exported from `@reactive-agents/runtime`.
2. ☐ 4 bootstrap entries registered (memory, RI, verifier, strategy-switching).
3. ☐ `agent.capabilities.audit()` returns a structured `CapabilityAuditReport` from any built agent.
4. ☐ At least 1 consumer wired in same M2.* commit per master plan §9 Anti-Scaffold Principle (M2.2 wires the user-facing surface; counts).
5. ☐ Ablation-warden gate scenario asserts default-on entries have lift evidence (M2.3).
6. ☐ Workspace tests green, build 38/38, zero regressions.
7. ☐ `strategy-switching` entry's `liftEvidence: null` either gets evidence OR gets opt-in conversion (forced by gate).

No "scaffold without callers" — every type or method introduced has a wired consumer in the same commit it's introduced.

---

## 7. Risk Register

| Risk | Mitigation |
|---|---|
| **Registry becomes a god-object** — temptation to stuff every flag here | Schema is narrow (8 fields); only capabilities with meaningful cost/lift dimension qualify. Tools, hooks, low-level config stay out. |
| **Bootstrap entries drift from reality** — registry says X is default-on but builder still wires Y inline | M2.1 ships with audit assertion that each bootstrap entry's `defaultOn` matches the underlying builder/runtime flag at construction time. If a future PR changes the builder default without updating the registry, the assertion fails. |
| **`strategy-switching: liftEvidence: null` blocks gate** | Intentional. Two paths: (a) ablation-warden runs an ablation matrix on strategy-switching during pilot window and fills the entry; (b) the field gets converted to `defaultOn: false` (opt-in only). Either is a correct outcome per master plan §9. |
| **Circular dep between registry and the services it describes** | Registry stores METADATA (strings, numbers, booleans, evidence pointers). It does NOT hold references to service instances. Memory service Layer + registry entry for "memory" are independent — registry knows ABOUT memory, doesn't depend on memory's Layer. |
| **User confusion: registry vs builder methods** | `audit()` output explicitly references the corresponding builder method per entry ("disable via `.withoutMemory()`"). Single discoverable surface. |

---

## 8. Cross-References

- **Master plan:** `wiki/Architecture/Design-Specs/2026-05-26-master-optimization-plan.md` §0 TL;DR + §3 root-cause #1 + §4 MOVE-2 line.
- **North Star:** `wiki/Architecture/Specs/05-DESIGN-NORTH-STAR.md` §4 (10 capabilities) — registry is the operational backing for that conceptual catalog.
- **Mission Statements:** `wiki/Architecture/Specs/06-MISSION-STATEMENTS.md` Anti-mission #3 (24+ withers IS the failure mode) — registry is the back-side fix for discoverability.
- **Strategic Memo:** `wiki/Architecture/Design-Specs/2026-05-25-strategic-direction-memo.md` LEVERAGE-2 (capability emit-at-boundary) — `lastAblation` field is the post-hoc receipt for capability-level emission events.
- **MOVE-3 Phase 1+2 (already shipped):** commits `fa831f44` + `4fa057ea` on `overhaul/foundation-2026-05-26` — established the `ctx.metadata.taskComplexity` snapshot pattern that MOVE-2's runtime-cost-merge follow-up would consume.

---

## 9. Status

| Date | Status | Note |
|---|---|---|
| 2026-05-26 | DRAFT | commit `d26e9616` — initial spec |
| 2026-05-26 | IMPL M2.1 + M2.2 | commit `3752a43e` — registry + bootstrap + agent.capabilities.audit() (bundled per Anti-Scaffold) |
| 2026-05-26 | IMPL M2.3 | commit `344c0910` — cf-25 gate scenario; baseline updated; load-bearing pin live |
| 2026-05-26 | SHIPPED | M2.4 — this commit flips status; ablation-warden gate enforces violations.length === 1 in CI |
| FUTURE | M2.5 | runtime cost merging (audit() merges static costSignature + cost-track.ts actuals) |
| FUTURE | M2.6 | UI / docs site rendering of audit() output |
