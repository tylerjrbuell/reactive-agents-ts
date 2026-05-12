# Harness Research Integration — Design Spec

**Date:** 2026-05-11
**Status:** Approved — pending implementation
**Author:** Tyler Buell + Claude
**Scope:** Verified findings from three March 2026 harness engineering papers integrated into North Star v5.0, Phase 1.5 roadmap, Compose API Wave A scope, M3 default behavior, and Hot.md.

---

## 1. Research Basis

All quantitative claims verified directly against primary sources.

| Paper | Authors | arXiv | Key contribution |
|---|---|---|---|
| Natural-Language Agent Harnesses (NLAH) | Pan et al., Tsinghua University | 2603.25723 | NLH ablations: verifier gates hurt, self-evolution helps, file-backed state helps, multi-candidate search hurts |
| Meta-Harness | Lee, Nair, Zhang, Khattab et al., Stanford IRIS + MIT | 2603.28052 | Automatic harness optimization from raw traces; harness transfers across models |
| AutoHarness | Lou et al., Google DeepMind | 2603.03329 | Compiling domain rules into code harnesses; eliminates illegal actions in 145 games |
| AgentSpec | Wang, Poskitt, Sun — ICSE 2026 | 2503.18666 | DSL for runtime safety enforcement; 90%+ unsafe execution prevention (code agents) |

---

## 2. Verified Findings and Design Implications

### F-1: Verifier gates are net-negative in isolation

**Verified numbers:** LLM-as-judge verification gate: -0.8pp SWE-bench Verified, -8.4pp OSWorld (36-task sample; -8.4pp ≈ 3 tasks).
**Caveat:** The tested verifier is an expensive LLM-as-judge gate, not a lightweight retry mechanism. Direct applicability to M3's current retry-context approach requires a controlled ablation on our own gate scenarios.
**Design implication:** M3 Phase 1.5 goal changes from "tune retry context until ≥50% recovery" to "ablate first — disable verifier entirely and measure; tune only if ablation shows net-positive." Verifier default changes to **opt-in** in code.

### F-2: Self-evolution is the most robustly positive module

**Verified numbers:** +4.8pp SWE-bench Verified, +2.7pp OSWorld across both benchmarks.
**Correction from video:** Self-evolution is not the "only" positive module. File-backed state was also positive (+1.6pp SWE, +5.5pp OSWorld). The correct framing: self-evolution has the most *consistent* positive signal across both benchmarks.
**Design implication:** Add M14 (Self-Evolution) to Phase 1.5. Design as a Compose API hook (onFailure + strategy-evaluated), not kernel code — keeps harness logic composable per paper's own recommendation. File-backed state result confirms the already-shipped SQLite session history (gateway-chat) is research-validated correct.

### F-3: Multi-candidate search consistently hurts

**Verified numbers:** -2.4pp SWE-bench Verified, -5.6pp OSWorld.
**Context:** This is parallel candidate generation and selection — harness overhead of managing branches exceeds benefit at current baseline capability levels.
**Design implication:** Audit M2 (Strategy Switching) — if it evaluates strategies in parallel before selecting, it exhibits the hurt pattern. If it is sequential fallback, the finding likely does not apply. Add an explicit note to Phase 1.5 M2 scope.

### F-4: Adding structure costs 13.6x compute and is 0.8pp worse

**Verified numbers:** Full IHR vs. without harness skill: ~13.6x token cost, pass rate 74.4% vs. 75.2% (heavier config is *worse*, not the same).
**Correction from video:** "Same pass rate, 14x compute" is inaccurate on both counts — it's 13.6x and outcomes slightly favor the lighter config.
**Design implication:** Pruning Principle added to North Star §9: adding harness structure costs disproportionate compute and can actively hurt outcomes. Subtraction is a first-class engineering act.

### F-5: Raw execution traces are irreplaceable

**Verified numbers:** Removing raw traces: 50.0% → 34.6% accuracy (meta-harness). Summary-only replacement: 34.9%. Traces account for 40% of files read per optimization round.
**Design implication:** `@reactive-agents/trace` and Phase C Snapshot/Replay are load-bearing infrastructure, not polish. Raw trace fidelity must be preserved — no lossy compression of trace payloads.

### F-6: Harness-optimized on one model transfers to others

**Verified numbers:** Math retrieval harness improves five held-out models by +4.7pp average on IMO-level problems.
**Design implication:** Calibration profiles (M7) and compose recipes are reusable assets that transfer across providers. Strengthens the case for M7 Phase 1.5 activation.

---

## 3. Workstream Specifications

Four independent workstreams. WS1–WS3 can execute in parallel. WS4 (Hot.md) executes after WS1 completes.

---

### WS1 — North Star v4.0 → v5.0

**File:** `wiki/Architecture/Specs/05-DESIGN-NORTH-STAR.md`
**Type:** Targeted amendments. Do not restructure sections not listed here.

#### §1 Amendment — Header
Change version line to: `**North Star v5.0** — Harness Research Integration (2026-05-11)` and update the status line:
> Added: Pruning Principle, M14 Self-Evolution, M3 ablation-gated (roadmap posture only — no code change), M8 elevated priority. All changes grounded in three verified March 2026 papers and cross-checked for fit with reactive-agents-ts architecture. (see Design-Specs/2026-05-11-harness-research-integration.md).

#### §2.2 Amendment — Mechanism Verdicts Table

Update three rows and add one:

| Mech | Old verdict | New verdict |
|---|---|---|
| **M3** Verifier+Retry | `🔄 IMPROVE — tune retry context (target: ≥50% recovery on cogito:14b)` | `🔄 IMPROVE (ablation-gated) — ablate before tuning. Run gate corpus with verifier disabled; tune only if ablation shows net-positive delta. Note: NLAH (arXiv:2603.25723) tested an LLM-as-judge gate; our defaultVerifier is a heuristic guard — direct applicability is unconfirmed. Ablation uses our own corpus.` |
| **M8** Sub-agent Delegation | `🔄 IMPROVE — real LLM metrics (target: ≥15% accuracy lift)` | `🔄 IMPROVE (elevated priority) — NLAH (arXiv:2603.25723) shows 90% of compute flowing through child agents in the TRAE coding system. Context-specific finding, but signals delegation as high-leverage. Target raised from ≥15% to ≥20% accuracy lift. Compose API integration for delegation traces added to scope.` |
| **M14** Self-Evolution | (new row) | `🔄 IMPROVE — new mechanism. Acceptance-gated attempt loop: stay narrow until failure signals justify broadening. Implemented as Compose API hooks (lifecycle.failure + control.strategy-evaluated), not kernel code. Target: ≥3pp lift on SWE gate scenario set. Research basis: NLAH (arXiv:2603.25723) +4.8pp SWE / +2.7pp OSWorld.` |

Also add a footnote after the table:
> **File-backed state validation:** The existing per-sender SQLite session history (gateway-chat, shipped May 1) corresponds to the NLAH "file-backed state" module, which was also positive on both benchmarks (+1.6pp SWE, +5.5pp OSWorld). This is a research confirmation of an already-correct decision.

#### §6 Phase 1.5 Amendment — Mechanism Table

Replace the M3 and M8 rows:

| Mech | Action | Target | Effort |
|---|---|---|---|
| **M3** Verifier+Retry | **Step 1:** Ablation — disable verifier, run gate corpus, measure net delta. **Step 2 (if and only if ablation shows net-positive):** Tune retry context (temperature 0.0→0.2). If ablation shows net-negative, M3 is demoted to opt-in-only; no further tuning. | Step 1: ablation result with p-value on gate corpus. Step 2 (conditional): ≥50% recovery on cogito:14b. | Step 1: 1 day. Step 2: 3–5 days (conditional). |
| **M8** Sub-agent Delegation | Run 10 delegation scenarios on frontier + qwen3:14b. Wire delegation traces through `control.strategy-evaluated` compose hook (after Phase B Wave A). Measure accuracy lift, token ROI, and trace completeness. | ≥20% accuracy lift on complex tasks (≥3-step); delegation events visible in trace via compose hook. | 3–5 days (after Phase B Wave A) |
| **M14** Self-Evolution | Implement `composeNarrowRetry(maxBroadenAfter)` helper using `lifecycle.failure` + `control.strategy-evaluated` Compose hooks. Validate on 3 gate scenarios where agents currently loop. | ≥3pp lift on looping gate scenarios; no regression on non-looping scenarios. | 4–6 days (after Compose API Wave A ships the hooks) |

Add M14 row to the Phase 1.5 completion gate:
- [ ] M14 self-evolution: ≥3pp lift on looping gate scenarios, no regressions

#### §6 Phase B Amendment — Wave A and Wave B

In Wave A scope, add:
> **Tag catalog initial set expanded to 7 (was 5).** Two additional tags added based on research findings: `lifecycle.failure` (fires after tool error, LLM refusal, or verifier rejection; enables self-evolution hook) and `control.strategy-evaluated` (fires after `strategy-evaluator.ts` scores the current trajectory; enables acceptance-gated narrowing). These are the two injection points required by M14.

In Wave B chokepoints, add to the list:
- `lifecycle.failure` — fires from `kernel/capabilities/verify/verifier.ts` and `kernel/capabilities/act/tool-execution.ts` on error/rejection
- `control.strategy-evaluated` — fires from `kernel/capabilities/reflect/strategy-evaluator.ts` after each strategy score

#### §9 Amendment — What Stays vs What Changes

Add new section at the end of §9:

**The Pruning Principle (added v5.0)**

> Harness components encode assumptions about what the model cannot do alone. Those assumptions expire as model capability improves. When an assumption expires, the component should be removed — not patched, not made configurable. Structure should shrink as model capability grows.
>
> Empirical basis: adding a full harness skill set costs ~13.6x the tokens and produces outcomes 0.8pp *worse* than a lighter configuration (NLAH arXiv:2603.25723, Table 1). This is not a cost/performance tradeoff — it is structure actively degrading outcomes while consuming resources.
>
> **Operational rule:** Before adding any new harness mechanism, identify the model-capability assumption it encodes and document it in the mechanism's spec. During each major version review, test whether that assumption still holds on current frontier models. Mechanisms whose assumptions have expired are removal candidates, not improvement candidates.

#### Amendment Log Entry (append to existing log)

```
| v5.0 | 2026-05-11 | Harness research integration. Added: Pruning Principle (§9),
|      |            | M14 Self-Evolution (§2.2 + §6 Phase 1.5), M3 ablation-gated
|      |            | (roadmap posture only — §2.2 + §6 Phase 1.5), M8 elevated priority
|      |            | (§2.2 + §6 Phase 1.5), Phase B Wave A/B tag catalog expansion (§6).
|      |            | Research verified against primary sources; WS2 (heuristic verifier
|      |            | opt-in) dropped — NLAH paper tested LLM-as-judge, not heuristic guards.
|      |            | Research basis: arXiv 2603.25723, 2603.28052.
|      |            | See Design-Specs/2026-05-11-harness-research-integration.md. |
```

---

### WS2 — Compose API Spec: Self-Evolution Hooks

**File:** `wiki/Architecture/Design-Specs/2026-05-06-compose-harness-api.md`
**Type:** Additive only. No changes to existing content.

**Add a new section after the existing tag catalog section:**

---

#### Self-Evolution Hooks (v5.0 addition)

Two new tags added to support M14 (Self-Evolution) — the most robustly positive module from NLAH research (arXiv:2603.25723):

**`lifecycle.failure`**

```typescript
// Fires after: tool execution error, LLM refusal, or verifier rejection
// Payload:
type LifecycleFailurePayload = {
  reason: 'tool-error' | 'llm-refusal' | 'verifier-rejection';
  errorMessage: string;
  attemptNumber: number;       // how many times this task has been attempted
  failureStreak: number;       // consecutive failures without a successful step
  currentStrategy: string;     // name of active reasoning strategy
};
// Handler return:
// - undefined → continue with default behavior
// - { narrowTo: string } → switch to named sub-strategy before next attempt
// - { abandon: true } → escalate to parent / exit-failure immediately
```

Fires from: `kernel/capabilities/act/tool-execution.ts` (tool errors), `kernel/capabilities/reason/think.ts` (refusals), `kernel/capabilities/verify/verifier.ts` (rejections).

**`control.strategy-evaluated`**

```typescript
// Fires after: strategy-evaluator.ts completes a trajectory score
// Payload:
type ControlStrategyEvaluatedPayload = {
  currentStrategy: string;
  score: number;             // 0–1 confidence in current trajectory
  failureStreak: number;
  recommendedAction: 'continue' | 'switch' | 'escalate';
  availableStrategies: string[];
};
// Handler return:
// - undefined → accept recommendedAction
// - { override: 'continue' | 'switch' | 'escalate' } → override recommendation
// - { switchTo: string } → switch to a specific named strategy
```

Fires from: `kernel/capabilities/reflect/strategy-evaluator.ts` after each evaluation cycle.

**Built-in composition helper: `composeNarrowRetry`**

```typescript
import { composeNarrowRetry } from '@reactive-agents/runtime/compose';

// Acceptance-gated attempt loop:
// - Stay on current (narrow) strategy until `maxBroadenAfter` consecutive failures
// - Only then allow strategy-evaluator to broaden the search space
// - Implements the self-evolution pattern from NLAH arXiv:2603.25723
export function composeNarrowRetry(maxBroadenAfter: number = 3) {
  return (harness: Harness) => {
    harness.on('control.strategy-evaluated', (payload, ctx) => {
      if (payload.failureStreak < maxBroadenAfter) {
        return { override: 'continue' }; // stay narrow
      }
      return undefined; // allow broadening after threshold
    });
  };
}
```

Usage:
```typescript
const agent = buildAgent()
  .withReasoning(...)
  .compose(composeNarrowRetry(3))  // broaden only after 3 consecutive failures
  .build();
```

---

Also add both new tags to the tag catalog table in the existing spec:

| Tag | Namespace | Fires from | Payload type |
|---|---|---|---|
| `lifecycle.failure` | `lifecycle.*` | `tool-execution.ts`, `think.ts`, `verifier.ts` | `LifecycleFailurePayload` |
| `control.strategy-evaluated` | `control.*` | `strategy-evaluator.ts` | `ControlStrategyEvaluatedPayload` |

Update the Wave A tag count from "5 initial tags" to "7 initial tags (includes 2 self-evolution hooks)."

---

### WS4 — Hot.md Update

**File:** `wiki/Hot.md`
**Type:** Replace the "Latest Session" block with a new one. Keep all other sections.

Replace the existing `## Latest Session (2026-05-10)` block with:

```markdown
## Latest Session (2026-05-11)

### Harness Research Integration — Three Papers Verified

Four March 2026 papers on harness engineering were reviewed, all quantitative claims verified against primary sources before any roadmap changes were made.

**Key findings and their impact:**

| Finding | Source | Roadmap impact |
|---|---|---|
| LLM-as-judge verifier gates: -0.8% SWE, -8.4% OSWorld | Tsinghua NLAH (2603.25723) | M3 is now ablation-gated; verifier opt-in by default in code (G-8) |
| Self-evolution: +4.8% SWE, +2.7% OSWorld (most consistent positive signal) | Same | M14 added to Phase 1.5; delivered via Compose API hooks |
| File-backed state: +1.6% SWE, +5.5% OSWorld | Same | Confirms SQLite session history (gateway-chat) was correct |
| Full harness adds 13.6x tokens and is 0.8pp *worse* | Same | Pruning Principle added to North Star §9 |
| Raw traces: 50% → 34.6% accuracy without them | Stanford Meta-Harness (2603.28052) | `@reactive-agents/trace` and Snapshot/Replay are critical path |
| Harness transfers across 5 models (+4.7pp avg) | Same | Strengthens M7 calibration consumer priority |

### North Star v5.0 Promoted ✅

All amendments are in `05-DESIGN-NORTH-STAR.md`. Design spec at `Architecture/Design-Specs/2026-05-11-harness-research-integration.md`.

### v0.10.6 Shipped ✅ (unchanged from prior session)

### What's Next
```

Keep the existing "What's Next" block content but prepend:

```markdown
### Immediate: Phase 1.5 M3 Ablation (unblocked)

Run the M3 ablation before starting Compose API Wave A — it's a 1-day task that uses our own gate corpus to determine whether the verifier is net-positive or net-negative for reactive-agents-ts specifically. Result informs M3 Phase 1.5 direction.
```

---

## 4. Execution Order

| Order | Workstream | Dependencies | Assignable to subagent? |
|---|---|---|---|
| Parallel | WS1 — North Star v5.0 | None | Yes |
| Parallel | WS2 — Compose API spec | None | Yes — doc edit only |
| After WS1 | WS3 — Hot.md | WS1 complete | Yes |

WS1 and WS2 touch different files entirely — no merge conflicts possible.

**Not included (dropped):** M3 opt-in code change. The NLAH paper tested an LLM-as-judge gate; our `defaultVerifier` is a heuristic guard. The research finding does not directly apply. M3 direction is deferred to the ablation result from our own gate corpus.

---

## 5. Validation Gates

| WS | Gate |
|---|---|
| WS1 | North Star version header reads v5.0; M3 ablation-gated, M8 elevated, M14 added, Pruning Principle present; amendment log entry appended |
| WS2 | Both new tags appear in tag catalog; `composeNarrowRetry` helper defined with correct TypeScript types; Wave A tag count updated to 7 |
| WS3 | Hot.md Latest Session block dated 2026-05-11; all 6 findings present in table; M3 ablation listed as pre-Phase-B gate |

---

## 6. Out of Scope

- AgentSpec DSL safety enforcement — noted as future direction, no implementation planned in this spec
- AutoHarness game-rule compilation — research confirmation only; no action for this project
- Meta-harness automatic harness optimization — requires Snapshot/Replay infrastructure first (Phase C prereq); add to Phase E/F roadmap in a future spec
- Compose API Wave B–F implementation — this spec only adds two tags to Wave A scope; full implementation follows the existing Phase B plan
