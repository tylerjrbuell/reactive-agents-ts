---
title: WS-3 Phase 0 — Kernel Capability Import-Graph Evidence
date: 2026-05-28
purpose: First-hand mapping of all cross-capability imports under `packages/reasoning/src/kernel/capabilities/` to ground WS-3 scope in evidence
related:
  - wiki/Planning/Implementation-Plans/2026-05-28-canonical-refactor.md §3.4 RC-2 + §3.6 F2
  - wiki/Architecture/Design-Specs/2026-05-28-canonical-architecture-model.md §2.3 (leaf principle)
methodology: |
  For each ordered pair (src_cap, dst_cap) in {act, attend, comprehend, decide, reason, recall, reflect, sense, verify, learn}:
    grep -lE "from ['\"]\.\.\/$dst_cap" packages/reasoning/src/kernel/capabilities/$src_cap/*.ts (excluding *.test.ts)
  Edge count = number of distinct files in src_cap importing from dst_cap.
  Cycle = (src_cap, dst_cap) both have edges in opposite directions.
verified-by: |
  Reproducible via `bash` loop in master plan §3.6 F2 + first-hand grep 2026-05-28 evening
---

# WS-3 Phase 0 — Kernel Capability Import-Graph Evidence

## TL;DR

**27 cross-capability edges** across **21 file-import pairs** in current code (corrected from prior audit's overcount of 38).

**3 confirmed cycles** (capability A imports from B + B imports from A):

1. **act ↔ decide** (`act/act.ts ↔ decide/arbitrator.ts`)
2. **act ↔ reason** (`act/tool-execution.ts ↔ reason/{think,think-guards}.ts`)
3. **reason ↔ verify** (`reason/{think,think-guards}.ts ↔ verify/critique.ts`)

**`act/` capability dir is 3053 LOC across 6 files.** Of that, 4 files (`tool-execution.ts` 893 LOC, `tool-parsing.ts` 255 LOC, `tool-gating.ts` 270 LOC, `tool-capabilities.ts` 140 LOC = 1558 LOC) are tool substrate, not Act capability proper.

---

## §1 — Full Cross-Edge Inventory (27 edges)

Format: `src_cap → dst_cap (N files) [files]`

### Outbound from `act/` (7 edges across 6 files)

| src → dst | Files in `act/` importing |
|---|---|
| `act → attend` | `tool-capabilities.ts`, `tool-execution.ts` |
| `act → decide` | `act.ts` (→ `decide/arbitrator.ts`) |
| `act → reason` | `tool-execution.ts` (→ `reason/stream-parser.ts`) |
| `act → sense` | `act.ts` (→ `sense/step-utils.ts`) |
| `act → verify` | `guard.ts`, `act.ts` |

### Outbound from `attend/` (1 edge)

| src → dst | File |
|---|---|
| `attend → verify` | `context-utils.ts` |

### Outbound from `decide/` (4 edges)

| src → dst | File |
|---|---|
| `decide → act` | `arbitrator.ts` (← `act/tool-parsing.ts`) |
| `decide → attend` | `arbitrator.ts` |
| `decide → comprehend` | `oracle-nudge.ts` |
| `decide → verify` | `arbitrator.ts` |

### Outbound from `reason/` (5 edges)

| src → dst | Files |
|---|---|
| `reason → act` | `think-guards.ts`, `think.ts` |
| `reason → attend` | `think-guards.ts`, `think.ts` |
| `reason → decide` | `think.ts` |
| `reason → sense` | `think-guards.ts`, `think.ts` |
| `reason → verify` | `think-guards.ts`, `think.ts` |

### Outbound from `recall/` (1 edge)

| src → dst | File |
|---|---|
| `recall → comprehend` | `recall-service.ts` |

### Outbound from `reflect/` (3 edges)

| src → dst | Files |
|---|---|
| `reflect → decide` | `loop-detector.ts` |
| `reflect → reason` | `strategy-evaluator.ts` |
| `reflect → verify` | `strategy-evaluator.ts` |

### Outbound from `sense/` (1 edge)

| src → dst | File |
|---|---|
| `sense → verify` | `step-utils.ts` |

### Outbound from `verify/` (1 edge)

| src → dst | File |
|---|---|
| `verify → reason` | `critique.ts` |

### Outbound from `comprehend/`, `learn/` (0 edges)

✅ Already leaves. Pure leaves consume no sibling capability.

---

## §2 — Cycle Analysis

### Cycle 1: `act ↔ decide`

```
act/act.ts          ──imports──► decide/arbitrator.ts
decide/arbitrator.ts ──imports──► act/tool-parsing.ts  ← act/ TOOL SUBSTRATE
```

**Resolution path:** Extract `tool-parsing.ts` to `kernel/utils/tool-parsing.ts` (pure regex helpers per §4 F2 disposition). `decide/arbitrator.ts` then imports from `kernel/utils/`, not from `act/`. Direction reverses: only `act → decide` remains. NOT a cycle.

### Cycle 2: `act ↔ reason`

```
act/tool-execution.ts  ──imports──► reason/stream-parser.ts
reason/think.ts        ──imports──► act/tool-parsing.ts    ← act/ TOOL SUBSTRATE
reason/think-guards.ts ──imports──► act/tool-execution.ts  ← exposing makeObservationResult
reason/think-guards.ts ──imports──► act/tool-gating.ts     ← act/ TOOL SUBSTRATE
```

**Resolution path:**
- `act/tool-parsing.ts` → `kernel/utils/tool-parsing.ts` (Phase 1)
- `act/tool-gating.ts` → architectural ADR (Phase 2) — likely `decide/tool-gating.ts` since gating is "select subset of permitted tools" (Decide concern, pre-Act)
- `act/tool-execution.ts` stays in `act/` but exposes `ToolExecutionService` Tag — `reason/think-guards.ts` consumes the Tag, not the file (Phase 3)
- `reason/stream-parser.ts` ← `act/` import: stays (stream-parser IS reason substrate; `act/tool-execution.ts` legitimately uses it)

After Phase 1+2+3: `reason ↔ act` resolves to one direction (`act → reason` for stream-parser only).

### Cycle 3: `reason ↔ verify`

```
reason/think.ts         ──imports──► verify/requirement-state.ts
reason/think-guards.ts  ──imports──► verify/{requirement-state,evidence-grounding}.ts
verify/critique.ts      ──imports──► reason/...   ← need to read critique.ts to find the import
```

**Resolution path:** Phase 4 — read `verify/critique.ts` to identify its `reason/` import; route through a service Tag if it's a sibling concern, or refactor if the import is structurally wrong.

This cycle is the only one NOT obviously closed by the `act/`-monolith disentangle. Genuine cross-capability dependency requiring its own architectural review.

---

## §3 — `act/` LOC Breakdown (3053 LOC)

| File | LOC | Inbound from other capabilities (cross-edge count) | Concern | Right home |
|---|---|---|---|---|
| `act/act.ts` | 1208 | 0 | Act capability orchestration | **stays in `act/`** |
| `act/guard.ts` | 287 | 0 | Pre-act guard | **stays in `act/`** |
| `act/tool-execution.ts` | 893 | 3 (reason/think-guards `makeObservationResult`, reason/think-guards `extractObservationFacts`, reason/think) | Kernel-state-coupled tool dispatch | **stays in `act/` as canonical Act owner; expose `ToolExecutionService` Tag** |
| `act/tool-parsing.ts` | 255 | 2 (decide/arbitrator `FINAL_ANSWER_RE` + `extractFinalAnswer`, reason/think `evaluateTransform`) | Pure regex helpers | **move to `kernel/utils/tool-parsing.ts`** |
| `act/tool-gating.ts` | 270 | 4 (reason/think-guards `gateNativeToolCallsForRequiredTools`, reason/think `planNextMoveBatches`, reason/think `isParallelBatchSafeTool`, act/act `planNextMoveBatches` — but act/act is same-dir, doesn't count cross-cap) | Tool selection logic | **ADR — likely `decide/tool-gating.ts`** |
| `act/tool-capabilities.ts` | 140 | 0 | Tool capability declarations | stays in `act/` |

**Predicted `act/` LOC post-extraction:** 1208 + 287 + 893 + 140 = **2528 LOC** (parsing moved → -255 LOC) or 1208 + 287 + 893 + 140 - 270 (gating moved) = **2258 LOC** depending on Phase 2 disposition.

If `act/tool-execution.ts` further decomposes into its own substrate dir (`act/tool-execution/` with extracted helpers), LOC may drop further. WS-3 scope keeps it intact for now.

---

## §4 — Per-File Mobility Class (from §3 + §3.6 F2)

| File | Mobility class | Move target | Reason |
|---|---|---|---|
| `act/tool-parsing.ts` | PURE SUBSTRATE | `kernel/utils/tool-parsing.ts` | No state coupling; pure regex/parse helpers |
| `act/tool-gating.ts` | SUBSTRATE-OR-CAPABILITY | TBD via ADR (Decide vs Act+Tag) | Selection logic — semantically belongs to Decide; pragmatically stays in Act with Tag |
| `act/tool-execution.ts` | KERNEL-COUPLED-PRIMITIVE | stays in `act/`; expose `ToolExecutionService` Tag | Imports kernel state; legitimate Act capability owner |
| `act/tool-capabilities.ts` | DECLARATIVE-IN-ACT | stays in `act/` | Tool capability declarations belong with Act |
| `act/act.ts` | ACT-CORE | stays in `act/` | The Act capability entry |
| `act/guard.ts` | ACT-PRE-CHECK | stays in `act/` | Pre-act guard logic |

---

## §5 — Phase Plan Mapping (per WS-3 thin spec)

| WS-3 Phase | Action | Expected edge change |
|---|---|---|
| Phase 1 | Move `act/tool-parsing.ts` → `kernel/utils/tool-parsing.ts` | act → decide remains (1 file); decide → act drops (was 1 file via parsing import). **Cycle 1 closes.** |
| Phase 2 | ADR + move `act/tool-gating.ts` (likely to decide/) | act → decide may gain 1 (if gating moves to decide) — but no new cycle. reason → act drops 1 (gating import). |
| Phase 3 | Expose `ToolExecutionService` Tag from act; reason consumes via Tag | reason → act drops 2 (think-guards). **Cycle 2 closes.** |
| Phase 4 | Audit reason ↔ verify cycle; read `verify/critique.ts` for the verify → reason import | Resolution TBD — may be legitimate cross-cap dep requiring Tag, or structural mismatch requiring refactor |
| Phase 5 | Migrate runner.ts emit calls to capability boundaries | runner.ts emit-line count drops 20-30; capability emit completeness ↑ |

**Predicted post-WS-3 state:** ≤1 cycle remaining (pending Phase 4 investigation); ~20-22 cross-edges (down from 27); `act/` LOC ~2528 (down from 3053).

---

## §6 — Anti-Pattern: Tool Substrate Inside Act Capability Directory

The root architectural issue surfaced by this graph: `act/tool-*.ts` files are **tool substrate** (consumed by multiple capabilities as primitives for tool operations), but they live inside the `act/` capability directory. This conflation creates the mesh structure that violates the leaf principle.

Other capability dirs do NOT have this conflation:
- `attend/` contains attention/curation logic only
- `decide/` contains decision/arbitrator logic only
- `verify/` contains verification logic only

Only `act/` mixes capability-proper with substrate. The canonical architecture model (§2.4) introduces `kernel/substrate/` as the canonical home for primitives consumed across capabilities. WS-3 implements the model.

---

## §7 — Verification Snapshot (commands)

```bash
# Edge count
for src in act attend comprehend decide reason recall reflect sense verify learn; do
  for dst in act attend comprehend decide reason recall reflect sense verify learn; do
    [ "$src" != "$dst" ] && \
    f=$(grep -lE "from ['\"]\.\.\/$dst" packages/reasoning/src/kernel/capabilities/$src/*.ts 2>/dev/null | grep -v ".test.ts" | wc -l) && \
    [ "$f" -gt 0 ] && echo "$src → $dst ($f files)"
  done
done | wc -l   # → 21 file-import pairs
# Cross-edge total
... | awk -F'(' '{gsub(/ files\)/,"",$2); s+=$2} END {print s}'   # → 27 edges

# act/ LOC
wc -l packages/reasoning/src/kernel/capabilities/act/*.ts | grep -v test | tail -1   # → 3053 total

# Cycle detection
for src in act attend comprehend decide reason recall reflect sense verify learn; do
  for dst in act attend comprehend decide reason recall reflect sense verify learn; do
    if [ "$src" \< "$dst" ]; then
      ab=$(grep -lE "from ['\"]\.\.\/$dst" packages/reasoning/src/kernel/capabilities/$src/*.ts 2>/dev/null | grep -v ".test.ts" | wc -l)
      ba=$(grep -lE "from ['\"]\.\.\/$src" packages/reasoning/src/kernel/capabilities/$dst/*.ts 2>/dev/null | grep -v ".test.ts" | wc -l)
      [ "$ab" -gt 0 ] && [ "$ba" -gt 0 ] && echo "CYCLE $src ↔ $dst"
    fi
  done
done   # → 3 cycles: act ↔ decide, act ↔ reason, reason ↔ verify
```

All commands reproducible at `main` HEAD `9cd739a7` (pre-PR-172 merge).
