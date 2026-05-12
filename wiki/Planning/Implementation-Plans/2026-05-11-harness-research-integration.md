# Harness Research Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate verified harness engineering research findings into the reactive-agents-ts canonical docs: promote North Star to v5.0, update the Compose API spec with self-evolution hooks, and update Hot.md with the session findings. No production code changes — the M3 verifier opt-in was dropped because the NLAH paper tested an LLM-as-judge gate, not reactive-agents-ts's heuristic defaultVerifier.

**Architecture:** Three independent workstreams (WS1–WS3), all doc-only. WS1 (North Star v5.0) and WS2 (Compose API spec) execute in parallel. WS3 (Hot.md) executes after WS1 completes.

**Tech Stack:** Markdown (wiki edits only)

**Spec:** `wiki/Architecture/Design-Specs/2026-05-11-harness-research-integration.md`

---

## WS1 — North Star v4.0 → v5.0

**Files:**
- Modify: `wiki/Architecture/Specs/05-DESIGN-NORTH-STAR.md`

### Task 1: Update version header

- [ ] **Open the file and find the header block** (first 10 lines). It currently reads `**North Star v4.0**` with a status note.

- [ ] **Replace the version line and add an amendment note**

Find:
```markdown
# Reactive Agents — Design North Star v4.0
```
Replace with:
```markdown
# Reactive Agents — Design North Star v5.0
```

Find the existing status/date block near the top (the block with `**Status:** AUTHORITATIVE...` and `**Date:** 2026-04-26`) and append to it:
```markdown
**v5.0 amendments (2026-05-11):** Pruning Principle added (§9); M14 Self-Evolution added to Phase 1.5 (§2.2, §6); M3 changed to ablation-gated (§2.2, §6); M8 elevated to elevated-priority IMPROVE (§2.2, §6); Phase B Wave A/B tag catalog expanded to 7 tags (§6). All changes grounded in verified research (arXiv 2603.25723, 2603.28052). See `Architecture/Design-Specs/2026-05-11-harness-research-integration.md`.
```

### Task 2: Update §2.2 mechanism verdicts table

- [ ] **Find the M3 row** in the mechanism verdicts table (§2.2). It currently reads:

```markdown
| M3: Verifier + Retry | 🔄 IMPROVE | Core validated; retry context ineffective on cogito:14b | Tune retry context (target: ≥50% recovery) |
```

Replace with:
```markdown
| M3: Verifier + Retry | 🔄 IMPROVE (ablation-gated) | Research (arXiv:2603.25723) shows LLM-as-judge verifier gates are net-negative in isolation (-0.8pp SWE, -8.4pp OSWorld). Note: that paper tested LLM-as-judge; our defaultVerifier is a heuristic guard — applicability unconfirmed until our own ablation. | **Step 1:** ablate on our gate corpus (disable verifier, measure delta). **Step 2 (only if net-positive):** tune retry context for cogito:14b. |
```

- [ ] **Find the M8 row**. It currently reads:

```markdown
| M8: Sub-agent Delegation | 🔄 IMPROVE | Test harness ready; real LLM metrics unvalidated | Real LLM execution (target: ≥15% accuracy lift) |
```

Replace with:
```markdown
| M8: Sub-agent Delegation | 🔄 IMPROVE (elevated priority) | NLAH (arXiv:2603.25723) shows 90% of compute flowing through child agents in the TRAE coding system — context-specific finding, but signals delegation as high-leverage. | Real LLM execution on 10 scenarios; compose pipeline integration; target raised to ≥20% accuracy lift on complex (≥3-step) tasks. |
```

- [ ] **Add M14 row** directly after the M13 row:

```markdown
| M14: Self-Evolution | 🔄 IMPROVE (new) | Not yet implemented. Research (arXiv:2603.25723) shows acceptance-gated attempt narrowing is the most consistently positive module (+4.8pp SWE, +2.7pp OSWorld). | Implement as Compose API hooks (`lifecycle.failure` + `control.strategy-evaluated`) after Phase B Wave A ships. Target: ≥3pp lift on looping gate scenarios; no regression on non-looping scenarios. |
```

- [ ] **Add file-backed state footnote** after the mechanism verdicts table (after the closing `|---|` row), before the next `###` heading:

```markdown
> **File-backed state confirmed:** The per-sender SQLite session history (gateway-chat, shipped May 1) corresponds to the NLAH "file-backed state" module, which was also robustly positive (+1.6pp SWE, +5.5pp OSWorld). This is a research confirmation of an already-correct decision.
```

### Task 3: Update Phase 1.5 table in §6

- [ ] **Find the Phase 1.5 mechanism table** in §6. Replace the M3 and M8 rows and add M14:

Replace M3 row:
```markdown
| **M3** Verifier Retry | **Step 1 (ablation):** Run gate corpus (minimum 20 tasks) with verifier disabled, measure accuracy delta vs. baseline. **Step 2 (conditional):** Only if Step 1 shows net-positive signal — tune retry context (temperature 0.0→0.2, retry prompt variants). If Step 1 shows net-negative, M3 is closed as context-specific; no further tuning. | Step 1: ablation result with delta on our gate corpus. Step 2 (conditional): ≥50% recovery on cogito:14b with verified net-positive. | Step 1: 1 day. Step 2: 3–5 days (conditional). |
```

Replace M8 row:
```markdown
| **M8** Sub-agent Delegation | Run 10 delegation scenarios on frontier + qwen3:14b. Wire delegation traces through `control.strategy-evaluated` compose hook (Phase B Wave A prereq). Measure accuracy lift, token ROI, and trace completeness. | ≥20% accuracy lift on complex tasks (≥3-step); delegation events visible in trace via compose hook. | 3–5 days (after Phase B Wave A). |
```

Add M14 row after M10:
```markdown
| **M14** Self-Evolution | Implement `composeNarrowRetry(maxBroadenAfter)` helper using `lifecycle.failure` + `control.strategy-evaluated` compose hooks. Validate on 3 gate scenarios where agents currently loop. | ≥3pp lift on looping gate scenarios vs. baseline; no regression on non-looping scenarios. | 4–6 days (after Phase B Wave A). |
```

Update the Phase 1.5 completion gate — add:
```markdown
- [ ] M14 self-evolution: ≥3pp lift on looping gate scenarios; evidence artifact in `wiki/Research/Harness-Reports/phase-1.5-m14-YYYY-MM-DD.md`
```

### Task 4: Update Phase B Wave A tag count in §6

- [ ] **Find the Wave A row** in the Phase B wave sequence table. It currently says "5 initial tags". Change to:

```markdown
| **Wave A** | `harness-pipeline.ts` registry + resolver; `harness-tag-catalog.generated.ts` (**7 initial tags** — 5 original + `lifecycle.failure` + `control.strategy-evaluated` for M14 self-evolution); `TagMap`, `PayloadFor`, `ContextFor` type system; `.compose()` on builder | Type inference works; pipeline registry resolves tags |
```

- [ ] **Add two new rows to the Wave B chokepoints list** (find the list inside Wave B description):

```markdown
- `lifecycle.failure` — fires from `kernel/capabilities/act/tool-execution.ts` (tool errors) and `kernel/capabilities/verify/verifier.ts` (rejections); payload: `{ reason, errorMessage, attemptNumber, failureStreak, currentStrategy }`
- `control.strategy-evaluated` — fires from `kernel/capabilities/reflect/strategy-evaluator.ts`; payload: `{ currentStrategy, score, failureStreak, recommendedAction, availableStrategies }`
```

### Task 5: Add Pruning Principle to §9

- [ ] **Find §9** ("What Stays vs What Changes"). Add a new subsection at the end:

```markdown
### The Pruning Principle (v5.0)

Harness components encode assumptions about what the model cannot do alone. Those assumptions expire as model capability improves.

**Empirical basis:** Full harness skill set costs ~13.6× the tokens and produces outcomes 0.8pp *worse* than a lighter configuration (NLAH arXiv:2603.25723, Table 1). Adding structure actively degrades outcomes while consuming resources.

**Operational rule:** Before adding any new harness mechanism, identify and document the model-capability assumption it encodes. During each major version review, test whether that assumption still holds on current frontier models. Mechanisms whose assumptions have expired are removal candidates, not improvement candidates.
```

### Task 6: Append amendment log entry

- [ ] **Find the amendment log** (near the end of the file, `## 11. Amendment Log` or similar). Append:

```markdown
| v5.0 | 2026-05-11 | Pruning Principle (§9); M14 Self-Evolution (§2.2 + §6 Phase 1.5); M3 ablation-gated (§2.2 + §6 Phase 1.5); M8 elevated-priority IMPROVE (§2.2 + §6 Phase 1.5); Phase B Wave A/B tag catalog expanded to 7 (§6). Research basis: arXiv 2603.25723, 2603.28052. Design spec: `Architecture/Design-Specs/2026-05-11-harness-research-integration.md`. |
```

### Task 7: Commit WS1

- [ ] **Commit**

```bash
git add wiki/Architecture/Specs/05-DESIGN-NORTH-STAR.md
git commit -m "docs(wiki): promote North Star to v5.0 — harness research integration

M3 ablation-gated, M8 elevated-priority IMPROVE, M14 self-evolution added, Pruning Principle.
Research basis: arXiv 2603.25723 (Tsinghua NLAH) + 2603.28052 (Stanford Meta-Harness)."
```

---

## WS2 — Compose API Spec: Self-Evolution Hooks

**Files:**
- Modify: `wiki/Architecture/Design-Specs/2026-05-06-compose-harness-api.md`

### Task 8: Add two new tags to the tag catalog

- [ ] **Read the file** to find the existing tag catalog table. It will have columns like `| Tag | Namespace | Fires from | Payload type |` or similar. Find where existing tags are listed (look for `prompt.system`, `nudge.loop-detected`, etc.).

- [ ] **Add two new rows** to the tag catalog table:

```markdown
| `lifecycle.failure` | `lifecycle.*` | `kernel/capabilities/act/tool-execution.ts` (tool errors), `kernel/capabilities/reason/think.ts` (LLM refusals), `kernel/capabilities/verify/verifier.ts` (rejections) | `LifecycleFailurePayload` |
| `control.strategy-evaluated` | `control.*` | `kernel/capabilities/reflect/strategy-evaluator.ts` | `ControlStrategyEvaluatedPayload` |
```

### Task 9: Add self-evolution hooks section

- [ ] **Find a logical insertion point** after the existing tag catalog section (before the Wave implementation notes or at the end of the design sections).

- [ ] **Add the following section**:

````markdown
---

## Self-Evolution Hooks (v5.0 addition)

Two new tags added to support M14 (Self-Evolution). Research basis: NLAH arXiv:2603.25723 — acceptance-gated attempt narrowing is the most consistently positive harness module (+4.8pp SWE-bench Verified, +2.7pp OSWorld).

### `lifecycle.failure`

Fires after: tool execution error, LLM refusal, or verifier rejection.

```typescript
type LifecycleFailurePayload = {
  reason: 'tool-error' | 'llm-refusal' | 'verifier-rejection';
  errorMessage: string;
  attemptNumber: number;    // total attempts on current task
  failureStreak: number;    // consecutive failures without a successful step
  currentStrategy: string;  // name of active reasoning strategy
};

// Handler return values:
// undefined                    → continue with default behavior
// { narrowTo: string }         → switch to named sub-strategy before next attempt
// { abandon: true }            → escalate to parent / exit-failure immediately
```

### `control.strategy-evaluated`

Fires after `strategy-evaluator.ts` completes a trajectory score.

```typescript
type ControlStrategyEvaluatedPayload = {
  currentStrategy: string;
  score: number;                  // 0–1 confidence in current trajectory
  failureStreak: number;
  recommendedAction: 'continue' | 'switch' | 'escalate';
  availableStrategies: string[];
};

// Handler return values:
// undefined                                     → accept recommendedAction
// { override: 'continue' | 'switch' | 'escalate' } → override recommendation
// { switchTo: string }                          → switch to specific named strategy
```

### Built-in helper: `composeNarrowRetry`

```typescript
import { composeNarrowRetry } from '@reactive-agents/runtime/compose';

/**
 * Acceptance-gated attempt loop.
 * Stays on current (narrow) strategy until maxBroadenAfter consecutive failures,
 * then allows strategy-evaluator to broaden. Implements NLAH self-evolution pattern.
 */
export function composeNarrowRetry(maxBroadenAfter: number = 3) {
  return (harness: Harness) => {
    harness.on('control.strategy-evaluated', (payload) => {
      if (payload.failureStreak < maxBroadenAfter) {
        return { override: 'continue' }; // stay narrow
      }
      return undefined; // allow broadening after threshold
    });
  };
}

// Usage:
const agent = buildAgent()
  .withReasoning(...)
  .compose(composeNarrowRetry(3))
  .build();
```
````

### Task 10: Update Wave A tag count

- [ ] **Find the Wave A description** in the wave sequence table or section. It currently says "5 initial tags". Change every occurrence to "7 initial tags (includes `lifecycle.failure` + `control.strategy-evaluated` for M14 self-evolution)".

### Task 11: Commit WS2

- [ ] **Commit**

```bash
git add wiki/Architecture/Design-Specs/2026-05-06-compose-harness-api.md
git commit -m "docs(wiki): add self-evolution compose hooks to Compose API spec

lifecycle.failure + control.strategy-evaluated tags added to Wave A scope.
composeNarrowRetry helper designed. Research basis: NLAH arXiv:2603.25723."
```

---

## WS3 — Hot.md Update

**Depends on:** WS1 complete (North Star v5.0 must be promoted before Hot.md references it)

**Files:**
- Modify: `wiki/Hot.md`

### Task 12: Replace Latest Session block

- [ ] **Find `## Latest Session (2026-05-10)`** in `wiki/Hot.md`. Replace the entire block (from that heading down to the `---` separator before `## What's Next`) with:

```markdown
## Latest Session (2026-05-11)

### Harness Research Integration — Three Papers Verified ✅

Four March 2026 papers reviewed; all quantitative claims verified against primary sources before any changes were made.

| Finding | Source | Impact |
|---|---|---|
| Verifier gates net-negative: -0.8pp SWE, -8.4pp OSWorld | Tsinghua NLAH (arXiv:2603.25723) | M3 ablation-gated in Phase 1.5 roadmap; kernel heuristic verifier already correct (finding applies to LLM-as-judge, not our guard) |
| Self-evolution most consistent positive module: +4.8pp SWE, +2.7pp OSWorld | Same | M14 added to Phase 1.5 as Compose API hook |
| File-backed state also positive: +1.6pp SWE, +5.5pp OSWorld | Same | Confirms SQLite session history (gateway-chat) was correct |
| Adding full harness costs 13.6× tokens and is 0.8pp *worse* | Same | Pruning Principle added to North Star §9 |
| Raw traces essential: 50% → 34.6% accuracy without them | Stanford Meta-Harness (arXiv:2603.28052) | `@reactive-agents/trace` + Snapshot/Replay are critical path |
| Harness transfers across 5 models (+4.7pp avg) | Same | Strengthens M7 calibration consumer priority |

### North Star v5.0 Promoted ✅

Canonical doc: `wiki/Architecture/Specs/05-DESIGN-NORTH-STAR.md`
Design spec: `wiki/Architecture/Design-Specs/2026-05-11-harness-research-integration.md`

### v0.10.6 Shipped ✅

All packages on npm. All P1 issues resolved.
```

### Task 13: Update What's Next

- [ ] **Find `## What's Next`** and prepend a new section before the existing "Immediate: Phase B" block:

```markdown
### Pre-Phase-B Gate: M3 Ablation (1 day)

Run the M3 ablation before starting Compose API Wave A. Temporarily pass a `noopVerifier` via `KernelInput.verifier` in a dev test harness, run gate corpus (20+ tasks), measure accuracy delta. Note: the NLAH finding is for LLM-as-judge gates; our `defaultVerifier` is a heuristic guard — ablation determines whether the same pattern holds here. Result informs Phase 1.5 M3 priority.

```

### Task 14: Update the footer metadata

- [ ] **Find the bottom of Hot.md** — the `**Last Updated:**`, `**Current Phase:**`, and `**Next Review:**` lines. Update:

```markdown
**Last Updated:** 2026-05-11
**Current Phase:** B (Compose API) — Wave A next; M3 ablation gate first
**Next Review:** After M3 ablation result + Compose API Wave A lands
```

### Task 15: Commit WS3

- [ ] **Commit**

```bash
git add wiki/Hot.md
git commit -m "docs(wiki): update Hot.md — harness research integration session (2026-05-11)"
```

---

## Final: Validate Wiki Consistency

After all three workstreams commit:

- [ ] **Cross-check the tag count** — confirm `05-DESIGN-NORTH-STAR.md` §6 Phase B Wave A now says "7 initial tags" and `2026-05-06-compose-harness-api.md` Wave A section also says "7 initial tags". The two docs must agree.

- [ ] **Verify Hot.md links are live** — the design spec path (`wiki/Architecture/Design-Specs/2026-05-11-harness-research-integration.md`) must exist on disk.

- [ ] **Grep for any remaining WS2 code-change references** — ensure no task still references `noopVerifier`, `KernelInput.enableVerification`, or the dropped G-8 gap.

```bash
grep -n "noopVerifier\|enableVerification\|G-8" wiki/Planning/Implementation-Plans/2026-05-11-harness-research-integration.md
```

Expected: no matches (all dropped-WS2 references removed).