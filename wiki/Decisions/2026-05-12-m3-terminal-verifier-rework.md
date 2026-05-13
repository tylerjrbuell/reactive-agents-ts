---
type: decision
status: ACCEPTED
created: 2026-05-12
tags: [decision, M3, verifier, ablation, phase-1.5, rework]
links:
  - "[[Research/Harness-Reports/phase-1.5-m3-ablation-2026-05-12|M3 Ablation Report]]"
  - "[[Research/Harness-Reports/phase-1-mechanism-validation-2026-05-04|Phase 1 M3 Validation]]"
  - "[[Architecture/Specs/05-DESIGN-NORTH-STAR|North Star]]"
---

# Decision: Disable M3 Terminal Retry Loop; Retain Heuristic Pass/Fail Gate

**Date:** 2026-05-12

**Owner:** Kernel / Reasoning Team

**Status:** ACCEPTED

**Phase:** Phase 1.5 — M3 REWORK action

---

## Problem Statement

The M3 terminal verifier in `runner.ts` implements two behaviors: (1) a heuristic pass/fail gate that checks whether the final answer meets task requirements, and (2) a retry loop that re-prompts the agent when the gate rejects the output. Prior to this decision, both behaviors were active.

The Phase 1.5 ablation (`ra-full` vs `ra-full-noop-verifier`) tested whether the retry loop produces net-positive outcomes. The pre-stated decision rule required ≥2 of 3 models to show higher accuracy for `ra-full` to sustain a KEEP verdict. That condition did not fire.

### Context

- **Ablation result:** 0pp aggregate accuracy delta across 30 run pairs; noop matched or exceeded accuracy in 2 of 3 models (qwen3 +1pp, cogito +1pp for noop; gpt-4o-mini +1pp for ra-full)
- **Token signal:** ra-full uses *fewer* tokens than noop for qwen3 and cogito, indicating the verifier is triggering premature early termination rather than adding retry overhead
- **Non-terminal path:** `act.ts:678` non-terminal verification is a separate mechanism (observability-only, out of scope for this ablation) — it is not touched
- **Judge reliability:** 84% parse failure rate (156/186 assessments returned 0.5 fallback) — verdict is provisional pending judge upgrade to structured output
- **Empirical report:** `wiki/Research/Harness-Reports/phase-1.5-m3-ablation-2026-05-12.md`

---

## Options Considered

### Option 1: Keep retry loop as-is (KEEP)

**Description:** Retain the current behavior — terminal verifier rejects → agent is re-prompted with failure feedback → up to `maxVerifierRetries` additional attempts before final exit.

**Pros:**
- No code change required
- Retry loop has non-zero signal on loop-intelligence (+2pp) and tool-mastery (+2pp) dimensions

**Cons:**
- 0pp aggregate accuracy lift across 30 paired runs — the retry is not converting guard detections into quality improvements
- Premature termination effect observed in 2 of 3 models (ra-full uses fewer tokens despite having a retry path, implying early exit on some tasks)
- Adds code complexity and two separate retry sites in runner.ts

**Cost:** ~0 implementation cost; ongoing complexity + misleading signal that a retry mechanism is helping

### Option 2: Remove all terminal verification (REMOVE)

**Description:** Disable both the retry loop and the heuristic gate entirely — agent output exits unconditionally.

**Pros:**
- Maximally simple; zero verifier overhead

**Cons:**
- Eliminates the pass/fail gate that does have a measurable guard function (loop-intelligence +2pp, tool-mastery +2pp dimension signal)
- Removes a rollback point if future judge quality improves and retry becomes viable
- Overshoot — the ablation only tested the retry loop, not the gate itself

**Cost:** Low implementation cost; loses a genuine guard signal

### Option 3: Disable retry loop; retain heuristic pass/fail gate (REWORK — chosen)

**Description:** Remove the in-loop retry path (sites 1 and 2 in runner.ts). Keep the terminal verifier call as a one-shot pass/fail gate: pass → emit verdict + continue; fail → exit with failure status (no retry). Non-terminal verification in `act.ts:678` is unchanged.

**Pros:**
- Matches empirical evidence: retry adds no accuracy lift, but the gate itself has non-zero dimensional signal
- Eliminates premature early-termination caused by retry exhaustion truncating runs
- Reduces dead variables (`verifierRetries`, `maxVerifierRetries`, `verifierRetryPolicy`, `defaultVerifierRetryPolicy`) that add cognitive overhead
- Clean rollback path: re-enable by restoring the retry block and variables

**Cons:**
- Verdict is provisional (84% judge parse failure rate) — decision may need revision after judge upgrade and re-run
- Removes the retry mechanism before it has been tested with a reliable judge

**Cost:** ~0.5 day implementation; low risk (additive removal, no logic change to the gate itself)

---

## Chosen Solution

### Decision

**We choose Option 3: Disable retry loop, retain heuristic pass/fail gate** because the ablation shows 0pp aggregate accuracy delta and the retry loop is causing premature termination rather than quality improvement.

### Rationale

The ablation pre-stated decision rule required ≥2 of 3 models to show higher accuracy for `ra-full` to sustain KEEP. qwen3:14b and cogito:14b both showed noop matching or beating ra-full by 1pp. gpt-4o-mini was the sole exception (+1pp for ra-full). All margins are within the noise floor given the 84% judge parse failure rate.

The token data reinforces the interpretation: ra-full uses *fewer* tokens than noop for qwen3 (−5%) and is comparable for cogito. This is counterintuitive if the retry loop were adding meaningful iterations — it instead points to the verifier triggering an early-exit branch that truncates some runs, reducing both iteration count and output quality on those tasks.

The non-zero dimensional signal (loop-intelligence +2pp, tool-mastery +2pp) confirms the heuristic gate is not a no-op — it detects genuine issues. The problem is that the retry loop does not convert those detections into improved answers. Retaining the gate as a one-shot pass/fail preserves the detection signal while removing the counterproductive retry path.

This is directionally consistent with NLAH (arXiv:2603.25723), though our verifier is a heuristic guard rather than an LLM-as-judge. The mechanism is different; the net outcome (retry does not help) is the same.

### Trade-off

- **We gain:** Elimination of premature early-termination; simpler runner.ts without retry state variables; honest signal (gate pass/fail without false promise of retry recovery)
- **We accept:** Loss of retry path before it has been tested under a reliable judge; provisional verdict that may change after judge upgrade
- **Mitigation:** Rollback plan documented below; judge fix (action item #3 from ablation) is the immediate follow-up; re-run with fixed judge is recommended before Phase B if schedule permits

---

## What Was Retained

**Site 3 — terminal pass/fail gate (`runner.ts:~1678`):**

```typescript
const verdict = verifier.verify({
  action: "final-answer",
  content: state.output,
  // ...
  terminal: true,
});
```

This call remains. It emits a structured verdict to the trace stream and can exit with failure status. The `verifier` instance itself is preserved; only the retry loop that wrapped it is removed.

**Non-terminal verification (`act.ts:678`):**

Out of scope for this decision. The ablation design explicitly excluded `act.ts` non-terminal verification (the `ra-full-noop-verifier` condition only bypassed the terminal path). This path is unchanged.

---

## What Was Removed

**Site 2 — in-loop retry at `runner.ts:~1451–1519`:**

The retry block that fires when the agent produces a candidate final answer mid-loop and the verifier rejects it. Converts the verifier into a feedback step with re-prompt. Removed.

**Site 1 — harness-deliverable retry at `runner.ts:~1006–1039`:**

The retry block in the fallback-output assembly path, used when the loop exits on exhausted budget and the harness assembles output from partial artifacts. Removed.

**Dead variables (removed from `runner.ts:~555–575` initialization block):**

- `verifierRetries` — mutable retry counter
- `maxVerifierRetries` — cap derived from `effectiveInput.maxVerifierRetries ?? 1`
- `verifierRetryPolicy` — policy function derived from `effectiveInput.verifierRetryPolicy ?? defaultVerifierRetryPolicy`
- `defaultVerifierRetryPolicy` import from `../../kernel/capabilities/verify/verifier.js`

The `verifier` instance and `defaultVerifier` import are retained (used by the gate at site 3).

---

## Rollback Plan

Re-enable the retry loop by:

1. Restore the `verifierRetries`, `maxVerifierRetries`, `verifierRetryPolicy` variable declarations in the initialization block (`runner.ts:~555–575`)
2. Restore the `defaultVerifierRetryPolicy` import
3. Restore the retry blocks at sites 1 (`~1006–1039`) and 2 (`~1451–1519`)
4. Revert the commit that removed them (commit message will reference this decision doc)

The gate at site 3 is unchanged and does not need to be touched during rollback.

**Trigger for rollback consideration:** Judge upgraded to structured output (tool-use JSON schema), re-run shows ≥2pp accuracy lift for ra-full over noop on ≥2 of 3 models with n≥5 per cell.

---

## Implementation

### Affected Components

- `packages/reasoning/src/kernel/loop/runner.ts` — remove retry sites 1 and 2; remove dead variable declarations and import

### Key Files

- `packages/reasoning/src/kernel/loop/runner.ts` — primary change site
- `packages/reasoning/src/kernel/capabilities/verify/verifier.ts` — `defaultVerifierRetryPolicy` export becomes unused (may be removed or kept for future use)
- `packages/judge-server/src/handler.ts` — follow-up: fix structured output (action item #3 from ablation, separate PR)

### Validation

- **Test:** Existing verifier test suite must stay green; add regression test asserting no retry occurs when verifier rejects (mock verifier → reject → assert single exit, no re-prompt)
- **Metric:** Token counts on benchmark corpus should be stable or decrease vs pre-rework baseline
- **Evidence:** `wiki/Research/Harness-Reports/phase-1.5-m3-ablation-2026-05-12.md` (ablation report)

---

## Caveats & Provisional Nature

**84% judge parse failure rate** — the accuracy percentages driving this decision are computed from `passRate` and `reliability` fields in benchmark run status (not raw per-dimension judge scores). Per-model margins are 1pp, which is within the noise floor of this setup.

This verdict is **provisional**. The required follow-up is:

1. Fix `packages/judge-server/src/handler.ts` to use Anthropic tool-use JSON schema for structured output (forces JSON-only, eliminates prose wrapping)
2. Re-run the ablation with the fixed judge (n≥5 per cell recommended for 2pp resolution)
3. If the re-run shows ≥2pp lift for ra-full on ≥2 models: revert this decision and implement retry-budget tuning instead

If Phase B schedule is tight and the re-run is not feasible before Phase B gate, proceed on current evidence — the 0pp aggregate result and the premature-termination token signal are sufficient to justify disabling the retry path.

---

## Phase Gates & Dependencies

- **Blocked by:** Nothing — implementation can begin immediately
- **Blocks:** Phase B gate (clean M3 state required before Phase B orchestration work)
- **Related:** cogito:14b FM-A1 retry prompt tuning (Issue #3, Running Issues Log) — separate workstream, not affected by this decision
- **Follow-up required:** Judge structured output fix (action item #3 from ablation) before any future ablation re-run

---

## Audit & Compliance

- **Aligns with:** North Star v4.0 thin-orchestrator discipline — remove mechanism overhead that does not earn its keep
- **Enforced by:** Regression test (no retry on verifier reject); code review verifying dead variables are absent
- **Review cadence:** Re-evaluate after judge upgrade + re-run; otherwise stable for Phase B

---

## References

- [[Research/Harness-Reports/phase-1.5-m3-ablation-2026-05-12|M3 Ablation Report (Phase 1.5)]] — empirical basis for this decision
- [[Research/Harness-Reports/phase-1-mechanism-validation-2026-05-04|Phase 1 M3 Validation]] — prior IMPROVE verdict that triggered the ablation
- [[MOCs/Decisions MOC|Decisions MOC]] — all architecture decisions
- [[Decisions/Decision Index|Decision Index]] — searchable catalog

---

**Last Updated:** 2026-05-12
**Phase:** Phase 1.5
**Status:** ACCEPTED (provisional — re-evaluate after judge structured output upgrade)
