---
title: ADR — `act/tool-gating.ts` Disposition (WS-3 Phase 2)
date: 2026-05-28
status: PROPOSED (awaiting user/architecture-warden adjudication)
decision-driver: WS-3 Phase 2 thin spec — `wiki/Planning/Implementation-Plans/2026-05-28-ws-3-kernel-capability-dag.md` §Phase 2
related-anchor: architecture-model §2.3 (leaf principle) + §6 capability boundary contracts
prerequisite: WS-3 Phase 1 shipped (PR #175 — `tool-parsing.ts` extracted to `kernel/utils/`)
---

# ADR — `act/tool-gating.ts` Disposition

## Context

`packages/reasoning/src/kernel/capabilities/act/tool-gating.ts` (270 LOC) currently lives inside the Act capability directory but exports tool-selection primitives consumed primarily by the Reason capability:

| Export | Purpose | Inbound consumers |
|---|---|---|
| `planNextMoveBatches(calls, config)` | Batch the next set of tool calls per parallelism config | `reason/think.ts`, `act/act.ts` (same-dir) |
| `gateNativeToolCallsForRequiredTools(...)` | Filter native tool calls against the required-tools quota | `reason/think-guards.ts` |
| `isParallelBatchSafeTool(name, schemas)` | Boolean: can this tool run in parallel batch? | `reason/think-guards.ts` |
| Plus internal: `ToolElaborationInjectionConfig`, `NextMovesPlanningConfig` types | Configuration | (configuration types; consumed by callers above) |

**4 cross-capability inbound edges from `reason/` into `act/tool-gating.ts`.** This is the largest single contributor to the `act ↔ reason` cycle (Cycle 2).

## Decision Required

Where should `tool-gating.ts` live structurally? Three options enumerated by the WS-3 spec:

---

### Option (a) — Move to `kernel/capabilities/decide/tool-gating.ts`

**Semantic argument:** Tool gating answers "which subset of permitted tools is the agent allowed to fire on this iter?" That's a **Decide** concern (pre-Act filtering). Mission Pillar 5 (Reliability): *"Single Arbitrator integrates all signals into one Verdict per iter. Strategy switching, early stop, retry, escalate are Verdict shapes."* Tool gating IS a Verdict prerequisite — the Arbitrator can't decide what to fire if the gating hasn't determined what's allowed.

**Mechanism:**
- Move `act/tool-gating.ts` → `decide/tool-gating.ts`
- Update 4 inbound import sites in `reason/` to `from "../decide/tool-gating.js"`
- Update 2 same-dir import sites in `act/{act,guard}.ts` to `from "../decide/tool-gating.js"`

**Pros:**
- ✅ Semantic clarity — gating logically belongs to Decide (pre-Act selection)
- ✅ Architecture model §6.2 capability ownership table aligns: Decide owns "select exactly ONE action"; gating is the pre-step that narrows the candidate set
- ✅ Cycle 2 (act ↔ reason) reduces: 4 inbound edges to act/ drop; replaced by reason → decide edges (which don't form a cycle because decide doesn't import from reason)
- ✅ Tool-specific config types travel with the logic — no type-graph fragmentation
- ✅ Sets up clean future: when WS-3 Phase 3 ships `ToolExecutionService` Tag, the Decide capability hands the gated tool-list to the Act capability via the Verdict, not via direct imports

**Cons:**
- ⚠️ Adds 1 file to `decide/` (currently 1247 LOC across 2 files; would become 3 files ~1517 LOC). Decide capability dir grows by 22%.
- ⚠️ Decide/ now contains a tool-specific module — mild leakage of tool semantics into the decision layer
- ⚠️ Naming: `decide/tool-gating.ts` reads as "deciding about tools" which IS the intent but may surprise readers expecting decide/ to hold only arbitrator + oracle-nudge

**Edge count after option (a):**
- act → decide: 1 (existing act/act.ts → arbitrator.ts) — unchanged
- decide → act: 0 (act/tool-parsing.ts already gone; no other decide→act edges remain) — **Cycle 2 reduction: act↔reason 4 fewer files, but the cycle pair only requires ≥1 file each direction, so cycle structurally persists IF any act→reason edge remains**

Wait — let me recheck the cycle math:

**Pre-Phase-2 cycle 2:** `act ↔ reason` because:
- `act/tool-execution.ts` → `reason/stream-parser.ts` (act → reason direction)
- `reason/think.ts` → `act/tool-gating.ts`, `act/tool-parsing.ts` (reason → act direction; tool-parsing was moved Phase 1)
- `reason/think-guards.ts` → `act/tool-execution.ts`, `act/tool-gating.ts`

**Post-Phase-2 option (a):** `reason → act/tool-gating` edges DISAPPEAR (becomes `reason → decide/tool-gating`). But `reason/think-guards.ts → act/tool-execution.ts` REMAINS (3 cross-cap inbound — separate concern, Phase 3 ToolExecutionService Tag closes this).

**So option (a) reduces cycle 2 from "4-edge-coupled" to "1-edge-coupled" — but the cycle is NOT closed until Phase 3.**

---

### Option (b) — Move to `kernel/capabilities/comprehend/tool-gating.ts`

**Semantic argument:** Tool gating reads `required-tools` (a Comprehend-extracted signal — Comprehend identifies which tools the task requires; gating enforces the required-tool floor). Could co-locate gating with the signal source.

**Mechanism:** Same structural move; rename target to `comprehend/`.

**Pros:**
- ✅ Co-locates required-tool extraction (already in `comprehend/task-intent.ts`) with required-tool enforcement
- ✅ Comprehend ownership is "parse meaning from task + observations" — gating IS a meaning-driven filter

**Cons:**
- ⚠️ Stretches Comprehend's remit from "parse meaning" to "act on meaning" (filtering tools is action, not parsing)
- ⚠️ Mission Pillar 5 says Decide owns "select exactly ONE action" — gating is closer to selection than to comprehension
- ⚠️ Smaller cycle-2 impact (same as option a) but with worse semantic alignment

**Recommendation: REJECT** — semantic mismatch outweighs the co-location convenience.

---

### Option (c) — Keep in `act/`; expose via `ToolGatingService` Tag

**Mechanism:**
- File stays at `act/tool-gating.ts`
- New Tag `ToolGatingService` defined in `core/services/` (or `kernel/services/`)
- Live layer at `act/tool-gating-service-live.ts` wraps the existing exports
- 4 `reason/` consumer sites refactored to `yield* ToolGatingService`
- Same-dir `act/` consumers continue to import directly

**Pros:**
- ✅ Zero file relocation
- ✅ Tag-based contract enforces leaf principle without moving substrate
- ✅ Pattern matches Phase 3 (`ToolExecutionService` Tag) — consistent architectural shape

**Cons:**
- ⚠️ Substrate-inside-capability conflation persists — `act/` continues to hold non-Act concerns
- ⚠️ Adds Tag overhead (Layer wiring) for what is mostly pure-function helpers — option (a) just imports them directly
- ⚠️ 4 consumer sites must be refactored to be Effect.gen-aware to consume the Tag (gating is currently called from non-Effect code paths)
- ⚠️ Doesn't solve `act/` over-broad LOC concern (270 LOC stays in act/, which is already over-budget at 2798 LOC post-Phase-1)

---

## Recommendation

**Option (a) — move to `decide/tool-gating.ts`.**

Reasoning chain:

1. **Mission Pillar 5 puts gating in Decide.** Tool gating is pre-Act selection; Decide owns selection. The semantic fit beats option (b)'s co-location convenience.

2. **`act/` is over-broad already.** Post-Phase-1 it's 2798 LOC across 5 files. Option (a) drops it further to 2528 LOC across 4 files — closer to a leaf-capability size budget.

3. **Tag-based contract (option c) is the right pattern for `tool-execution.ts` (Phase 3) but NOT for `tool-gating.ts`.** The execution-side IS kernel-state coupled (writes observations, depends on services); gating is mostly pure function over schemas + state-read. Pure-function relocation is cheaper than Tag wrapping.

4. **Cycle 2 reduction is partial regardless** — Phase 3 (ToolExecutionService Tag) is needed to fully close it. Option (a) sets up Phase 3 cleanly; option (c) overlaps with it.

5. **Naming concern is mitigatable** — add a brief module docstring at `decide/tool-gating.ts` clarifying "tool gating is a Decide concern: which subset of permitted tools is the agent allowed to fire on this iter."

## Decision

**Pending user / architecture-warden adjudication.**

If adjudicated as option (a): WS-3 Phase 2 dispatch covers the move + 4 inbound + 2 same-dir import updates. Predicted impact:
- `act/` LOC: 2798 → 2528
- `decide/` LOC: 1247 → 1517
- Cycle 2 reduction: 4-edge coupled → 1-edge coupled (full closure by Phase 3)

If adjudicated as option (b) or (c): thin spec updates accordingly before re-dispatch.

## Acceptance

- [ ] User or architecture-warden picks one of (a) / (b) / (c)
- [ ] If (a) or (b): file path noted in WS-3 thin spec §Phase 2; dispatch mechanism unchanged
- [ ] If (c): WS-3 thin spec §Phase 2 rewritten to specify Tag mechanism; Phase 3 sequence may shift
- [ ] Decision recorded in §Status field above + amendment log

## Cross-References

- WS-3 thin spec: `wiki/Planning/Implementation-Plans/2026-05-28-ws-3-kernel-capability-dag.md` §Phase 2
- Master plan: `wiki/Planning/Implementation-Plans/2026-05-28-canonical-refactor.md` §3.6 F2 (per-file mobility class)
- Architecture model: `wiki/Architecture/Design-Specs/2026-05-28-canonical-architecture-model.md` §2.3 leaf principle, §6 capability boundary contracts
- Evidence: `wiki/Research/Refactor-Reports/2026-05-28-ws-3-import-graph.md` §1 outbound from reason/ (4-edge cluster into act/tool-gating)
- Phase 1 precedent: PR #175 (tool-parsing.ts mechanical move to kernel/utils/) — proves the move-pattern is low-risk

## Amendment Log

| Date | Change | Reason |
|---|---|---|
| 2026-05-28 | Initial draft. | WS-3 Phase 2 prerequisite per thin spec; option (a) recommended. |
