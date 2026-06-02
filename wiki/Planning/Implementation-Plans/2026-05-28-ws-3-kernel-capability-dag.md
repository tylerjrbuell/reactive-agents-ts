---
title: WS-3 — Kernel `act/` Decomposition + Capability DAG
date: 2026-05-28
status: 🟡 ~80% SHIPPED (code-verified 2026-06-02) — 0 kernel cycles, tool-parsing→utils, tool-gating→decide; remaining = leaf-principle purism (low value, metric-gaming risk)
master-plan: 2026-05-28-canonical-refactor.md (§4 RC-2 + §6.2 WS-3 summary)
architecture-model: 2026-05-28-canonical-architecture-model.md (§2 kernel arch + §2.4 substrate distinction)
evidence-base: wiki/Research/Refactor-Reports/2026-05-28-ws-3-import-graph.md (Phase 0 import-graph dump)
root-cause-closed: RC-2 (kernel capability mesh with 3 cycles; `act/` conflates capability + tool substrate)
gh-issues-closed: [#113 (capability-scoped emit), #114 (transitionState() + ESLint), #115 (required-tool nomination), #117 (emitLLMExchange boundary), #118 (plan-execute synthetic kernel state contract), #169 (kernel mesh + cycles)]
authoritative-anchor: master-plan §4 RC-2 + §3.6 F2 + architecture-model §2.3 (leaf principle)
owner-warden: kernel-warden
session-budget: 2 sessions — Phase 1 (1 session) + Phase 2+3+4+5 (1 session, possibly split)
risk: HIGH (touches kernel hot path; cross-package coordination needed for Tag exposure; 5 phased; rollback complexity)
prerequisite: PR #172 (WS-1 source fixes) merged — typecheck must be green at HEAD before kernel touches begin
---

# WS-3 — Kernel `act/` Decomposition + Capability DAG

## Goal (one sentence)

Restore the kernel's leaf principle by (1) extracting tool substrate from `act/` into `kernel/utils/` and Tag-based service contracts, (2) collapsing 2 of 3 confirmed cross-capability cycles, (3) auditing the residual reason↔verify cycle, and (4) migrating capability-concern emits out of `runner.ts` into their owning capability boundaries.

## Anchor

- **Architecture model §2.3** (leaf principle): capabilities consume substrate + L1/L2 packages; never import sibling capability internals
- **Architecture model §2.4** (substrate distinction): introduces `kernel/substrate/` as canonical home for shared primitives
- **Architecture model §6** (capability boundary contract): each capability owns its emit; runner.ts emits ONLY loop-control concerns
- **Master plan §4 RC-2 mechanism:** `act/` conflates Act capability + tool substrate; 9 inbound cross-edges to `act/tool-*.ts` are not Act-capability reads
- **Master plan §3.6 F2:** differential mobility — 3 distinct disposition classes for act/ files
- **Evidence:** `wiki/Research/Refactor-Reports/2026-05-28-ws-3-import-graph.md` (27 edges, 3 cycles, per-file mobility)

## Current State (first-hand verified 2026-05-28; see evidence base)

```
Cross-capability edges:  27 (21 file-import pairs)
Confirmed cycles:        3 (act↔decide, act↔reason, reason↔verify)
act/ LOC:                3053 (across 6 files)
  - 1495 LOC act-proper (act.ts + guard.ts)
  - 1558 LOC tool substrate (tool-execution + tool-parsing + tool-gating + tool-capabilities)
runner.ts LOC:           1986
runner.ts emit lines:    39 (per master plan §3.6 F3 — mix of loop-control + capability concerns)
ESLint boundary rule:    not present
transitionState() callsites:    100 (canonical helper in use)
raw `state.status =`:   27 (Mission Pillar 4 violation 2.7×)
```

---

## Phase 1 — Extract `tool-parsing.ts` to `kernel/utils/` (high-confidence, low-risk)

**Goal:** Move pure regex/parse helpers out of `act/` to break Cycle 1 (act↔decide) and reduce act/ LOC.

**Files touched:**
- MOVE: `packages/reasoning/src/kernel/capabilities/act/tool-parsing.ts` → `packages/reasoning/src/kernel/utils/tool-parsing.ts`
- UPDATE 2 import sites:
  - `packages/reasoning/src/kernel/capabilities/decide/arbitrator.ts` (import of `FINAL_ANSWER_RE` + `extractFinalAnswer`)
  - `packages/reasoning/src/kernel/capabilities/reason/think.ts` (import of `evaluateTransform`)
- UPDATE self-import: `packages/reasoning/src/kernel/capabilities/act/tool-execution.ts` (currently imports `./tool-parsing.js`) → import from `kernel/utils/`

**Pre-verify:** `tool-parsing.ts` exports are PURE (no Effect/IO/kernel-state imports). Currently:

```bash
grep -E "^import" packages/reasoning/src/kernel/capabilities/act/tool-parsing.ts
```

Confirm only `effect` + same-package type imports. If any kernel-state import appears, abort Phase 1 and reclassify.

**Validation gate:**

- [ ] `packages/reasoning/src/kernel/utils/tool-parsing.ts` exists; `packages/reasoning/src/kernel/capabilities/act/tool-parsing.ts` does NOT
- [ ] All 3 import sites updated (no stale `../act/tool-parsing.js` references remain)
- [ ] `grep -lE "from ['\"]\\.\\./act/tool-parsing" packages/reasoning/src/` returns empty
- [ ] All workspace tests pass (3219+ baseline)
- [ ] Build 38/38 green
- [ ] Typecheck clean workspace-wide
- [ ] Cycle 1 (act↔decide) closes: re-run cycle-detection script → 2 cycles remaining (act↔reason, reason↔verify)
- [ ] `act/` LOC drops from 3053 to ~2798

**Predicted impact:** 2 cross-edges eliminated (act → /tool-parsing dependency from decide drops). Cycle 1 closes.

---

## Phase 2 — `tool-gating.ts` ADR + Move (architectural review required)

**Goal:** Resolve `act/tool-gating.ts` disposition via architectural decision record; collapse the 4 inbound cross-edges from `reason/`.

### Phase 2.0 — ADR authoring

**Deliverable:** `wiki/Decisions/2026-05-28-tool-gating-disposition.md`

**Three candidates** (per master plan §6.2 WS-3 summary):

| Option | Mechanism | Pros | Cons |
|---|---|---|---|
| **(a)** Move to `decide/tool-gating.ts` | Gating IS pre-Act selection (Decide concern semantically) | Cleanest semantic fit; mission Decide owns "select exactly ONE action" | Adds 1 file to `decide/`; tool-specific logic in non-tool dir |
| **(b)** Move to `comprehend/tool-gating.ts` | Gating reads required-tools (Comprehend signal) | Co-locates required-tool extraction + gating | Stretches Comprehend's remit beyond "parse meaning" |
| **(c)** Keep in `act/`; expose `ToolGatingService` Tag | Minimal file movement; clear cross-cap contract | Substrate-inside-capability conflation persists |

**Recommendation:** Option (a). Tool gating answers "which subset of permitted tools is the agent allowed to fire on this iter" — that's Decide's job (pre-Act filtering). Mission Pillar 5: "Single Arbitrator integrates all signals into one Verdict per iter. Strategy switching, early stop, retry, escalate are Verdict shapes." Tool gating is a Verdict prerequisite.

### Phase 2.1 — Execute ADR decision

**Files touched (assuming option (a)):**
- MOVE: `packages/reasoning/src/kernel/capabilities/act/tool-gating.ts` → `packages/reasoning/src/kernel/capabilities/decide/tool-gating.ts`
- UPDATE 4 inbound import sites:
  - `packages/reasoning/src/kernel/capabilities/reason/think-guards.ts` (3 imports: `gateNativeToolCallsForRequiredTools`, `isParallelBatchSafeTool`, `planNextMoveBatches`)
  - `packages/reasoning/src/kernel/capabilities/reason/think.ts` (1 import)
- UPDATE 1 self-import: `packages/reasoning/src/kernel/capabilities/act/act.ts` currently imports `./tool-gating.js` for `planNextMoveBatches` (same-dir) → import from `../decide/`
- UPDATE 1 self-import: `packages/reasoning/src/kernel/capabilities/act/guard.ts` imports `../act/tool-gating.js` → import from `../decide/`

**Validation gate:**

- [ ] `packages/reasoning/src/kernel/capabilities/decide/tool-gating.ts` exists; the act/-located file does NOT
- [ ] All 6 import sites updated
- [ ] `grep -lE "from ['\"]\\.\\./act/tool-gating" packages/reasoning/src/` returns empty
- [ ] All workspace tests pass; build green; typecheck clean
- [ ] `act/` LOC: ~2798 → ~2528
- [ ] reason → act edge count drops from 2 files to ≤1 file (tool-execution only; tool-gating gone)

---

## Phase 3 — `ToolExecutionService` Tag (closes Cycle 2)

**Goal:** Replace the 3 cross-capability internal imports of `act/tool-execution.ts` exports with a Tag-based service contract.

**Files touched:**

### Phase 3.1 — Define Tag

NEW: `packages/core/src/services/tool-execution-service.ts` (or `packages/reasoning/src/services/tool-execution-service.ts` if scoped to reasoning)

```typescript
import { Context, Effect, Layer } from "effect";
import type { ObservationResult } from "../types/observation.js";
import type { ToolCallSpec } from "@reactive-agents/tools";

export class ToolExecutionService extends Context.Tag("ToolExecutionService")<
  ToolExecutionService,
  {
    readonly makeObservationResult: (
      // signature from act/tool-execution.ts:makeObservationResult
      tc: ToolCallSpec,
      result: unknown,
    ) => ObservationResult;
    readonly extractObservationFacts: (
      // signature from act/tool-execution.ts:extractObservationFacts
      obs: ObservationResult,
    ) => readonly string[];
  }
>() {}
```

### Phase 3.2 — Live layer

NEW: `packages/reasoning/src/kernel/capabilities/act/tool-execution-service-live.ts`

```typescript
import { Layer } from "effect";
import { ToolExecutionService } from "../../../services/tool-execution-service.js";
import { makeObservationResult, extractObservationFacts } from "./tool-execution.js";

export const ToolExecutionServiceLive = Layer.succeed(
  ToolExecutionService,
  {
    makeObservationResult,
    extractObservationFacts,
  },
);
```

### Phase 3.3 — Migrate consumers

UPDATE: `packages/reasoning/src/kernel/capabilities/reason/think-guards.ts`
- Currently imports `{ makeObservationResult }` from `../act/tool-execution.js`
- Replace with: `const { makeObservationResult } = yield* ToolExecutionService`

This requires the consumer to be within an Effect.gen. If it isn't, the migration involves a larger refactor — fall back to direct module imports for Phase 3 and route as Tag in a later WS.

### Phase 3.4 — Wire Layer into runtime

UPDATE: `packages/runtime/src/runtime.ts` createRuntime — add `ToolExecutionServiceLive` to the `layers` array (post-WS-2 array structure assumed)

**Validation gate:**

- [ ] `ToolExecutionService` Tag defined + exported from canonical location
- [ ] `ToolExecutionServiceLive` Layer wired into both `createRuntime` + `createLightRuntime`
- [ ] All 3 consumer sites migrated to Tag consumption (or documented exception with rationale)
- [ ] `grep -lE "from ['\"]\\.\\./act/tool-execution" packages/reasoning/src/kernel/capabilities/[^a]` returns empty (only act/ self-imports remain)
- [ ] All workspace tests pass; build green; typecheck clean
- [ ] Cycle 2 (act↔reason) closes: re-run cycle-detection script → 1 cycle remaining (reason↔verify)

---

## Phase 4 — Cycle 3 audit (reason↔verify) + ESLint boundary rule

**Goal:** Resolve the genuine cross-capability cycle that doesn't disentangle through `act/` cleanup; add structural enforcement to prevent regression.

### Phase 4.1 — Read `verify/critique.ts`

Identify what `verify/critique.ts` imports from `reason/`. Three candidate resolutions per import:

- **Legitimate cross-cap dep** → expose via `VerifyService` or `ReasonService` Tag
- **Misplaced helper** → move helper to substrate or to the consuming capability
- **Structural mismatch** → refactor (rarest; reserve for last)

### Phase 4.2 — ESLint boundary rule

NEW: `.eslintrc` (or `eslint.config.js`) rule banning capability-to-capability internal imports:

```javascript
// Pseudo — actual ESLint plugin shape depends on existing config
{
  "no-restricted-imports": [
    "error",
    {
      "patterns": [
        {
          "group": ["**/kernel/capabilities/*/*.ts"],
          "importNames": ["*"],
          "message": "Cross-capability imports must route through a Tag in core/services/ or kernel/services/. See architecture-model §2.3 leaf principle."
        }
      ]
    }
  ]
}
```

Or use a dedicated boundary-enforcement plugin (e.g. `eslint-plugin-boundaries`).

### Phase 4.3 — `transitionState()` discipline lint

Per master plan §3.6 F10: 27 raw `state.status =` mutations vs ≤10 target.

Add lint rule banning raw `state.status =` assignments outside `kernel/state/transitionState()`, `kernel/loop/terminate.ts`, and explicitly-allowlisted killswitch escape sites (per architecture-model §5.1).

**Validation gate:**

- [ ] Phase 4.1: cycle 3 resolution decision documented + applied
- [ ] Re-run cycle-detection script → 0 cycles
- [ ] Phase 4.2: ESLint boundary rule live in CI; deliberately-wrong example fails the rule
- [ ] Phase 4.3: `state.status =` raw assignment count ≤ 10 (from baseline 27)
- [ ] Re-run cross-edge count → ≤22 (from baseline 27; expecting ~5 fewer post Phase 1-3)
- [ ] All workspace tests pass; build green; typecheck clean

---

## Phase 5 — `runner.ts` Capability Emit Relocation

**Goal:** Move capability-concern emit calls from `runner.ts` to their owning capability boundaries; reduce `runner.ts` LOC + restore mission invariant 10.

### Phase 5.1 — Audit the 39 emit-related lines in runner.ts

Categorize each emit call:

- **Loop-control** (legitimate at runner): `emitKernelStateSnapshot` per-iter, phase-started/completed boundary emits, terminal emits
- **Capability-concern** (must relocate): emit calls that should fire from the owning capability's boundary (e.g. `emitVerifierVerdict` belongs at verifier; `emitHarnessSignalInjected` belongs at compose tag emission; `emitBudgetSignalCollected` belongs at cost service)

Document the audit at `wiki/Research/Refactor-Reports/2026-05-28-ws-3-runner-emit-audit.md`.

### Phase 5.2 — Relocate per categorization

For each capability-concern emit: move the emit call into the owning capability's primary export. The capability now emits at its boundary; runner.ts orchestrates without emitting capability events.

**Validation gate:**

- [ ] `runner.ts` emit-related line count drops from 39 to ≤15 (loop-control only)
- [ ] Each capability dir's emit-related count increases proportionally
- [ ] `runner.ts` LOC drops (proportional; ~50-100 LOC savings expected)
- [ ] All workspace tests pass; build green; typecheck clean
- [ ] No emit events disappear (trace coverage unchanged in N=1 probe run)

---

## Scope OUT (non-goals — flagged for refusal)

- Decomposing `act/act.ts` (1208 LOC) further — its size is concentrated necessary logic per F2 verification
- Decomposing `runner.ts` to ≤500 LOC — WS-6 territory; this WS only handles emit relocation
- Touching strategy implementations (reactive.ts, plan-execute.ts, etc.) — separate combinator workstream
- Modifying `KernelState` shape — Pillar 4 lint comes via Phase 4.3 but no schema change
- Adding new capabilities (e.g. `learn/` expansion) — scoped out
- Touching `@reactive-agents/reactive-intelligence/` — RC-2 is purely kernel-internal

---

## Pre-Conditions

- WS-1 (PR #172) merged — workspace typecheck baseline reasonable
- WS-2 shipped (or branched) — runtime composition target shape exists; `ToolExecutionServiceLive` can be added to the `layers` array per WS-2's pattern
- Build green, tests green, typecheck near-clean at HEAD
- Evidence dump at `wiki/Research/Refactor-Reports/2026-05-28-ws-3-import-graph.md` reviewed
- ADR for Phase 2 (`wiki/Decisions/2026-05-28-tool-gating-disposition.md`) authored + decided before Phase 2.1 begins

---

## Tests (RED → GREEN per phase)

### Phase 1 (tool-parsing move)

RED: write a `grep` lint test asserting `../act/tool-parsing` import is absent from production code. Currently fails (2 import sites + 1 self-import).

```typescript
// packages/reasoning/tests/kernel-boundaries.test.ts
test("tool-parsing is consumed from kernel/utils/, not act/", () => {
  const matches = execSync(
    'grep -rlE "from [\\"\']\\.\\./act/tool-parsing" packages/reasoning/src/ | grep -v test',
  ).toString();
  expect(matches.trim()).toBe("");
});
```

GREEN: post-Phase 1 move, the test passes.

### Phase 2 (tool-gating ADR + move)

RED: similar grep test for `../act/tool-gating`.

### Phase 3 (Tag exposure)

RED: lint test asserting `act/tool-execution.ts` is consumed via Tag (not direct file import) from `reason/`:

```typescript
test("reason/ consumes ToolExecutionService via Tag, not act/tool-execution file", () => {
  const matches = execSync(
    'grep -rlE "from [\\"\']\\.\\./act/tool-execution" packages/reasoning/src/kernel/capabilities/reason/',
  ).toString();
  expect(matches.trim()).toBe("");
});
```

### Phase 4 (cycles + lint)

RED: cycle-detection test asserting `package: reason → verify ↔ verify → reason` cycle is absent.

```typescript
test("no cross-capability import cycles", () => {
  // Run cycle-detection script; expect 0 cycles
  const cycles = detectKernelCycles();
  expect(cycles).toEqual([]);
});
```

### Phase 5 (emit relocation)

RED: lint test asserting `runner.ts` emit-line count ≤15.

```typescript
test("runner.ts emit count is bounded by loop-control concerns", () => {
  const src = readFileSync("packages/reasoning/src/kernel/loop/runner.ts", "utf-8");
  const emitLines = (src.match(/emit[A-Z]\w+/g) ?? []).length;
  expect(emitLines).toBeLessThanOrEqual(15);
});
```

### Existing tests that MUST still pass

- All workspace `bun test` (5750+ at baseline)
- `bunx turbo run build` 38/38
- `bun run typecheck` clean across all packages

---

## Verification Protocol

```bash
# Baseline (pre-WS-3, on main at HEAD)
echo "=== Pre-WS-3 baseline ==="
echo "Cross-edges: $(./detect-edges.sh)"     # 27
echo "Cycles: $(./detect-cycles.sh)"          # 3
echo "act/ LOC: $(wc -l packages/reasoning/src/kernel/capabilities/act/*.ts | grep -v test | tail -1 | awk '{print $1}')"  # 3053
echo "runner.ts emit lines: $(grep -cE 'emit[A-Z]' packages/reasoning/src/kernel/loop/runner.ts)"  # 39
echo "raw state.status= : $(grep -rcE 'state\\.status\\s*=' packages/*/src --include='*.ts' | grep -v test | awk -F: '{s+=$2} END {print s}')"  # 27

# Per-phase gates (run after each phase ships)
# Phase 1: post tool-parsing move
echo "Cycle count post-P1: $(./detect-cycles.sh)"    # 2
echo "act/ LOC post-P1: $(...)"                       # 2798

# Phase 2: post tool-gating move
echo "Cycle count post-P2: 2 (unchanged; gating doesn't break a cycle)"
echo "act/ LOC post-P2: 2528"

# Phase 3: post Tag exposure
echo "Cycle count post-P3: 1"

# Phase 4: post cycle 3 + lint
echo "Cycle count post-P4: 0"
echo "raw state.status= : ≤10"

# Phase 5: post emit relocation
echo "runner.ts emit lines: ≤15"

# Final
bunx turbo run build && bun test && bun run typecheck
```

---

## Done Criteria (falsifiable)

### Phase 1 — tool-parsing extraction
- [ ] `kernel/utils/tool-parsing.ts` exists; `kernel/capabilities/act/tool-parsing.ts` does NOT
- [ ] Zero `../act/tool-parsing` imports remain in production code
- [ ] Cycle 1 (act↔decide) closes
- [ ] All tests pass; build green; typecheck clean

### Phase 2 — tool-gating ADR + move
- [ ] ADR shipped at `wiki/Decisions/2026-05-28-tool-gating-disposition.md`
- [ ] `kernel/capabilities/decide/tool-gating.ts` exists (if option (a)); act/-located file does NOT
- [ ] All 6 import sites updated
- [ ] `act/` LOC ≤ 2530

### Phase 3 — ToolExecutionService Tag
- [ ] `ToolExecutionService` Tag + Layer defined
- [ ] All 3 cross-capability import sites of `act/tool-execution.ts` use Tag consumption
- [ ] Cycle 2 (act↔reason) closes

### Phase 4 — cycle 3 + lint
- [ ] Cycle 3 (reason↔verify) resolution shipped (per Phase 4.1 audit decision)
- [ ] Zero confirmed cycles in formal cycle-detection script
- [ ] ESLint boundary rule live; deliberately-wrong example fails
- [ ] `transitionState()` discipline lint live; raw `state.status =` count ≤10

### Phase 5 — runner.ts emit relocation
- [ ] `runner.ts` emit-line count ≤15 (was 39)
- [ ] No trace event disappears (N=1 probe verifies emit completeness)

### Cross-cutting
- [ ] All workspace tests pass (5750+ baseline)
- [ ] Build green (38/38)
- [ ] Typecheck clean across all packages
- [ ] No new `as any` or `as unknown as` introduced
- [ ] Cross-edge count ≤22 (from 27)

---

## Rollback Plan

Per-phase atomic commits. Each phase rollback:

- **Phase 1 rollback:** restore `act/tool-parsing.ts`; revert 3 import sites
- **Phase 2 rollback:** restore `act/tool-gating.ts`; revert 6 import sites; ADR remains as record
- **Phase 3 rollback:** revert Tag definition + Live layer + consumer migrations; act/tool-execution stays importable
- **Phase 4 rollback:** revert cycle 3 resolution; remove ESLint rule (but consider keeping it warning-only since it's preventive)
- **Phase 5 rollback:** revert emit relocations; runner.ts emits restored

If catastrophic: revert all WS-3 commits in reverse order; kernel returns to mesh state.

---

## Evidence Artifact

`wiki/Research/Refactor-Reports/2026-05-28-ws-3-final.md` containing:

- Pre/post measurements per phase (edges, cycles, LOC, emit counts)
- N=1 probe trace coverage diff (proves emit relocations preserve completeness)
- ADR cross-reference (Phase 2)
- Cycle 3 resolution rationale (Phase 4.1)
- Confirmation of GH issues closed (#113, #114, #115, #117, #118, #169)

---

## Why This Workstream Is Third

After WS-1 (release-flow residual fixes) and WS-2 (runtime composition + agent-facade canonical seam):

- WS-2 stabilizes the runtime/agent-facade type surface so WS-3's `ToolExecutionService` Tag can be wired into createRuntime's `layers` array per the new declarative pattern
- WS-3's leaf principle restoration unblocks WS-4 (anti-scaffold purge) and future strategy combinator work
- Kernel mesh disentangle is a one-time structural payoff — every subsequent capability touch becomes cheaper
- 5 phases enable incremental landing + per-phase rollback

---

## Owner + Handoff

`kernel-warden` dispatch via Agent tool with MissionBrief input per pilot. Warden produces UpwardReport per phase. Main thread reviews + runs verification gates before merging each phase PR.

Phase 2 (`tool-gating` ADR) may require non-warden authoring (architecture decision authority) — user may write the ADR + warden executes the move per the decided option.

Phase 3 (Tag exposure) crosses package boundaries (`packages/core/services/` Tag definition + `packages/reasoning/` Live layer + `packages/runtime/` Layer wiring). Coordinate across `kernel-warden` + `runtime-warden`.

---

## Cross-Reference

- Master plan: `wiki/Planning/Implementation-Plans/2026-05-28-canonical-refactor.md` §4 RC-2, §3.6 F2, §6.2 WS-3 summary
- Architecture model: §2.3 leaf principle, §2.4 substrate distinction, §6 capability boundary contract
- Evidence: `wiki/Research/Refactor-Reports/2026-05-28-ws-3-import-graph.md` (Phase 0)
- Related GH issues: #113, #114, #115, #117, #118, #169
- Verified-working references: `arbitrator.ts` (single-owner Verdict ✅), `kernel-state.ts` (`transitionState()` exists, used 100 times ✅), `recall/recall-service.ts` + `learn/learning-pipeline.ts` (already leaves ✅)
