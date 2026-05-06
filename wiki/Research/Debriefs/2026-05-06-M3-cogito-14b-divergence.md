---
date: 2026-05-06
type: finding
mechanism: M3
status: blocks-phase-1.5-as-specified
related:
  - "[[Experiments/M3 Verifier and Retry]]"
  - "[[Planning/Phase 1.5 Improvement Roadmap]]"
  - "[[Failure-Modes/FM-A Tool Engagement]]"
tags: [debrief, harness-improvement, verifier, retry, divergence, cogito]
---

# M3 Cogito:14b Divergence — Empirical Evidence Refutes Phase 1.5 Hypothesis

## TL;DR

**Phase 1.5 spec for M3 says:** "Tune retry context for cogito:14b → ≥50% recovery on FM-A1/FM-C2."

**Empirical reality (this session):** Cogito:14b on the task-quality-gate probe does NOT manifest FM-A1 or FM-C2. It manifests a different failure mode where the **verifier never fires** — making the retry-policy success criterion unmeasurable.

**Recommendation:** Pivot M3 Phase 1.5 to address the verifier's blind spot, OR drop M3 and prioritize M6/M7 instead.

## Evidence

### Baseline probe: `task-quality-gate-cogito-14b-2026-05-06T20-25-17.json`

| Task | Composite | Faithfulness | Wall | terminatedBy | verifier-verdict count |
|------|-----------|--------------|------|--------------|----------------------|
| T1-knowledge-recall | 100% | 100% | 8s | done | (passed) |
| T2-single-tool-synthesis | 98% | 93% | 61s | done | (passed) |
| T3-selective-filter | 88% | 67% | 56s | done | (passed) |
| **T4-multi-criteria** | **30%** | **0%** | 11s | **oracle_forced** | **0** |
| **T5-long-form-synthesis** | **67%** | **7%** | 67s | **harness_deliverable** | **1 (verified=true)** |

### Trace diagnosis

**T4 (`01KQZFH4YSJX6X4BJA94PEZXWG`) — empty output, oracle force-termination:**
- 0 verifier-verdict events emitted
- Model called `pulse` instead of `final-answer`
- Oracle injected `pendingGuidance: "You are ready to answer. Call final-answer now with your complete response. This is mandatory."`
- After 1 ignored signal, oracle force-terminated → `terminatedBy: "oracle_forced"`, `outputLen: 0`, `status: failed`
- **Retry policy never gets the chance to fire because no verifier rejection ever occurred.**

**T5 (`01KQZFHFQA97RHHCNXQ792VWNQ`) — verifier false positive on harness fallback:**
- 1 verifier-verdict, `verified: true` (all 6 checks passed)
- Output (`outputLen: 2797`) was raw `[{"id":48037555,"title":"Valve releases..."}]` JSON dump
- `terminatedBy: "harness_deliverable"` — harness assembled output from tool artifacts because model never called final-answer
- Quality scorer rated `faithfulness: 7%` (raw JSON ≠ synthesis), but verifier passed it
- **The verifier's `synthesis-grounded` check is fooled by raw tool-result JSON because the data IS grounded in observations — it just isn't synthesized.**

## Why the planned M3 fix is unmeasurable

The M3 Phase 1.5 plan reads:
> Iterate retry context (simplified prompts, temperature tuning) to unlock cogito:14b without degradation. Success criteria: ≥50% recovery on cogito:14b with tuned context.

The retry policy only fires when `verifier-verdict.verified === false`. In our cogito:14b runs:
- T4: 0 verifier-verdict events → retry NEVER fires → no signal to tune
- T5: 1 verifier-verdict, verified=true → retry NEVER fires → no signal to tune

A fix tuning FM-A1/FM-C2 retry signals would produce identical traces before and after, because those signals never fire on cogito:14b's actual failures. **You cannot measure recovery rate of a mechanism that never executes.**

The M3 spec appears to have been written from p02 spike data on **cogito:8b** (which DOES manifest FM-A1) and generalized to cogito:14b without empirical validation.

## What cogito:14b actually does

Two distinct failure modes, neither addressed by retry-context tuning:

**FM-Fail-Forward (T4 pattern):**
- Calls a meta-tool (e.g., `pulse`) instead of `final-answer`
- Oracle gate detects "ready to answer" but model ignores the directive
- Oracle force-terminates after 1 nudge → empty output, run failed

**FM-Synthesis-Bypass (T5 pattern):**
- Stalls without calling final-answer (entropy frozen at 0.15 across iterations)
- Harness assembles output from `_tool_result_*` scratchpad keys → raw JSON dump
- Verifier's `synthesis-grounded` check passes raw JSON because data IS grounded
- Quality scorer correctly identifies low faithfulness, but verifier never rejects

## Pivot options

### Pivot A — Refocus M3 on verifier blind spot (recommended)

Add a verifier check that rejects harness-assembled outputs (e.g., `terminatedBy === "harness_deliverable"` AND output looks like raw JSON). Then the existing retry policy fires on T5-class failures, and M3 retry tuning becomes measurable.

**Predictable after-trace:** T5 baseline `verified=true` → after `verified=false` → retry path fires → improved signal injected → model emits synthesized answer.

**Effort:** ~1 day. Single coordinated change in `verifier.ts`.

### Pivot B — Refocus M3 on oracle nudge effectiveness

T4 shows oracle force-terminating after 1 ignored "call final-answer now" nudge. Either:
- Increase nudge budget (2-3 attempts) before force-termination
- Adopt M3's example-driven signal style for the oracle nudge text

**Risk:** Touches single-owner termination invariant (`kernel/loop/terminate.ts`). Politically loaded.

**Effort:** ~2 days, plus invariant validation.

### Pivot C — Drop M3, prioritize M6/M7

M3's premise is invalid for cogito:14b. Re-spec M3 entirely OR shift Phase 1.5 priority to:
- **M6 (skill persistence)** — clearer scope, SQLite layer, 5-7 days
- **M7 (calibration activation)** — wire ≥8 fields, 4-6 days

**Effort:** Zero on M3; reassign team capacity.

## What is preserved regardless of pivot

The M3 verifier itself is production-ready (100% precision on cogito:8b fabrication, 22 unit tests passing). The `improvedVerifierRetryPolicy` and FM-A1/FM-C2 signal builders are correctly designed for the failure mode they target — that mode just isn't what cogito:14b shows.

This finding does NOT invalidate:
- M3 verifier shipping in v0.10.0
- M3 retry policy as opt-in for cogito:8b workflows
- The signal-builder API for future tier-specific tuning

## Open question for user

The Phase 1.5 roadmap's M3 success criterion (`≥50% recovery on cogito:14b`) is unmeasurable as specified. Which pivot fits the project's intent?

- A: Verifier blind spot — keeps M3 as planned timeline, redirects target
- B: Oracle nudge tuning — different mechanism, touches termination invariant
- C: Drop M3, advance M6 or M7 — clean break, requires roadmap amendment

## Pivot A — shipped 2026-05-06

**Decision:** A then B (verifier blind spot first, oracle nudge tuning next).

**Implementation summary:**
- Added `terminatedBy?: string` to `VerificationContext` (`packages/reasoning/src/kernel/capabilities/verify/verifier.ts`).
- Added new terminal check `output-is-model-authored` in `defaultVerifier` that fails when `terminatedBy === "harness_deliverable"`. Reason text: "output was assembled by harness fallback (terminatedBy=harness_deliverable) — model never produced a synthesized final answer."
- In `runner.ts`, inlined `verifier.verify()` at the harness_deliverable assembly site (where `consecutiveStalled` triggers fallback). When the new check rejects and retry budget allows, the verifier-driven retry policy fires: harness signal injected, status → thinking, loop continues. After retry budget exhausted, original `terminate(state, {reason: "harness_deliverable"})` runs as before.
- Updated existing §9.0 verifier call to pass `state.meta.terminatedBy` so any future paths setting it route through the new check too.
- Two existing tests in `output-quality-gate.test.ts` opted into the original semantics via `maxVerifierRetries: 0` to preserve test intent (they test the harness_deliverable terminal path, not retry-on-fallback).

**Tests:** +6 unit tests (5 verifier-check tests in `m3-verifier-retry.test.ts` + 1 deterministic Pivot A integration test in `output-quality-gate.test.ts`). Reasoning suite: 1112/1112 pass. Runtime suite: 738/739 pass (1 pre-existing skip).

**Behavior change:** Pre-fix, harness_deliverable was a silent terminal pass. Post-fix, the default config (`maxVerifierRetries: 1`) consumes one retry attempt before terminating — the model gets one more chance to synthesize from the gathered artifacts. Downstream consumers using default config see one extra iteration on stalled tasks.

**Empirical limitation observed (2026-05-06 follow-up probes):**

The structural fix is correct (deterministic test confirms), but **the harness_deliverable path is rarely reached in current production behavior**. In after-fix cogito:8b probes (5 task runs, T1–T5), zero runs took the `harness_deliverable` path:

| RunId | Task | terminatedBy | New check fired? |
|-------|------|--------------|------------------|
| `01KQZRR97474ETQP4DYJYGNSQ4` | T1 | `final_answer` | n/a (verified=true) |
| `01KQZRRE2T2XMYXTG7509EW2SX` | T2 | `switching_exhausted` | n/a (no verdict event) |
| `01KQZRS22TMQ0G0KXP7SNEXPYW` | T3 | `controller_signal_veto` | n/a (no verdict event) |
| `01KQZRS7HWZGBW0P8E2G1JVVKV` | T4 | `final_answer` | n/a (verified=true) |
| `01KQZRSGTAHRZ3SAH519NCF3GR` | T5 | `final_answer` | n/a (verified=true) |

In cogito:14b after-fix probes, 5/5 runs likewise avoided harness_deliverable (oracle_forced fired in T4/T5 before the consecutive-stalled threshold).

**Why this still ships:** Pivot A closes a structural blind spot — when harness_deliverable DOES fire, the verifier now sees it and the retry policy can engage. The deterministic kernel test in `output-quality-gate.test.ts` ("Pivot A — harness-deliverable fires verifier-driven retry before terminating") proves the mechanism. Probe variance just means most cogito stalls hit other failure paths first (oracle_forced, controller_signal_veto, switching_exhausted).

**Implication for Pivot B:** The `oracle_forced` path is the bigger lever — it intercepted the cogito:14b T4 failure and several cogito:8b runs. Pivot B's "increase oracle nudge budget OR adopt example-driven nudge text" addresses this directly.

**Cogito:8b T4/T5 after-fix observation:** Both produced real synthesized outputs (T4 = 323 chars, 73% composite; T5 = 2153 chars, 74% composite). These took the `final_answer` path, not harness_deliverable, so the lift cannot be causally attributed to Pivot A. Treat as model-variance noise, not Pivot A signal.

## Pivot B — pending

Next: address `oracle_forced` failure mode (T4 cogito:14b empty-output pattern, several cogito:8b stalls). Approach options:
- Increase oracle nudge budget from 1 to N (tier-dependent — local models likely need 2–3)
- Adopt M3's example-driven signal style for the oracle nudge text ("emit `final-answer` with your synthesized response, not describe what you'd do")
- Both

Run a fresh baseline before implementing Pivot B so the before/after diff has a clean reference.

## References

- Probe: `.agents/skills/harness-improvement-loop/scripts/task-quality-gate.ts`
- Pre-fix baseline: `wiki/Research/Harness-Reports/task-quality-gate-cogito-14b-2026-05-06T20-25-17.json`
- Post-fix cogito:14b: `wiki/Research/Harness-Reports/task-quality-gate-cogito-14b-2026-05-06T23-03-08.json`
- Post-fix cogito:8b: `wiki/Research/Harness-Reports/task-quality-gate-cogito-8b-2026-05-06T23-07-47.json`
- T4 baseline trace: `~/.reactive-agents/traces/01KQZFH4YSJX6X4BJA94PEZXWG.jsonl`
- T5 baseline trace: `~/.reactive-agents/traces/01KQZFHFQA97RHHCNXQ792VWNQ.jsonl`
- Diagnose CLI: `bun run rax:diagnose replay <runId>`
