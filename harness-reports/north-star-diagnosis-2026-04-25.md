# North Star Diagnosis — 2026-04-25 (post-trace-inspector)

**Question asked:** Are we certain about what will greatly improve performance, and what architecture/design patterns will get us there?

**Method:** Built a trace inspector (`scratch-trace-inspector.ts`, gitignored) that reads kernel iteration counters from authoritative controller-side events (`decision-evaluated`, `intervention-dispatched`, `intervention-suppressed`) — bypassing the known `traceStats().iterations` bug (memory note 2774) and the entropy-scored.iter anomaly. Inspected all 8 corpus traces from the 2026-04-25 run.

---

## Verdict 1 — W4 is GENUINELY CLOSED at runtime (7/8 traces)

| Scenario | label | peakIter | max | W4 |
|---|---|---|---|---|
| success-days-of-week | success | 0 | 4 | ? inconclusive (terminated before controller ran) |
| success-capital-france | success | 3 | 4 | ✓ HELD |
| success-rgb-colors | success | 3 | 4 | ✓ HELD |
| success-typescript-paradigm | success | 4 | 4 | ✓ HELD |
| failure-rate-limit-loop | failure | **9** | 12 | ✓ HELD |
| failure-save-loop | failure | 3 | 12 | ✓ HELD |
| failure-verify-loop | failure | 7 | 12 | ✓ HELD |
| failure-contradictory-data | failure | 5 | 12 | ✓ HELD |

**Conclusion:** The kernel's iteration counter (peak 9 on the worst scenario, max=12) is well within bounds. **The corpus's "29 iterations" report was a measurement bug** — `traceStats().iterations` and the `entropy-scored.iter` anomaly (which surfaced values like iter=23, iter=28) were both misreporting. The kernel itself is correctly capping iterations. **cf-14 is testing the right thing.**

Action: write a regression test that uses controller-event peakIter (not `traceStats`) so the corpus reporting line stops mis-stating runtime behavior.

---

## Verdict 2 — The REAL bug is termination judgment, not iteration enforcement

This is the load-bearing finding. All 3 remaining false-positive scenarios (`failure-rate-limit-loop`, `failure-save-loop`, `failure-verify-loop`) terminated with `result.success === true` — at iter 9, 3, 7 respectively, well within budget. The kernel didn't run too long; it **stopped while the agent was still failing**, then declared success.

### Evidence — what the controller actually decided per failure scenario

| Scenario | Decisions fired | Has switch-strategy? | Final status |
|---|---|---|---|
| failure-rate-limit-loop | stall-detect ×2, tool-inject ×3, compress ×2, early-stop | **NO** | `success` ❌ |
| failure-save-loop | stall-detect ×2 | **NO** | `success` ❌ |
| failure-verify-loop | stall-detect ×2, tool-inject ×2 | **NO** | `success` ❌ |
| **failure-contradictory-data** | stall-detect ×2, **switch-strategy** | **YES** | `failure` ✅ |

**The pattern is unmistakable:** the only labeled-failure scenario the framework correctly identified as failure is the only one where `switch-strategy` fired. Every scenario where the controller stayed in tactical-intervention mode (tool-inject / compress / stall-detect) ended in a false-positive success.

### Why suppression made this worse

```
Suppression reasons across 8 traces:
  below-entropy-threshold     14
  savings-below-cost           2
```

14 suppressions for "below-entropy-threshold" means: the controller's threshold for escalating was too high for the actual entropy signal. The dispatcher *saw* the trouble (it was evaluating decisions every iteration) but the suppressor kept blocking action. Combined with the absence of an escalation ladder, the framework's behavior collapses to: **"detect, suppress, repeat tactical, agent gives up gracefully, declare success."**

---

## Verdict 3 — Entropy is a less useful discriminator now (concerning)

Apr 24 baseline entropy gap (success vs failure): **0.340**
Today: **0.140**

That's a -59% drop in our primary failure-detection signal's strength. Plausible causes (any combination):
1. Curator's `Recent observations:` section adds inline content that flattens entropy by giving the model more to think about (less surprise per token)
2. Effect 3.19 type-drift fix changed some streaming behavior
3. Cogito:14b model state difference between runs (single sample, high variance)

Whatever the cause, **entropy alone is now too weak to drive the dispatcher reliably**. This makes Verdict 2's escalation ladder even more critical — we can't lean harder on entropy; we need DIFFERENT signals.

---

## High-leverage architectural changes (with confidence ranking)

### CHANGE A — Failure-aware termination oracle  ⭐ HIGHEST CONFIDENCE / HIGHEST LEVERAGE

**The fix in one sentence:** The termination oracle currently accepts the agent's own success claim; it should reject success when the controller's recent activity says otherwise.

**Specific gating signals (all available from existing trace data):**
- Reject `success=true` if `dispatchesByIter[lastIter] > 0` AND no `switch-strategy` fired in the run
- Reject `success=true` if `maxEntropy > 0.5` AND the agent never produced a recovery action (tool retry succeeded, scratchpad checkpoint, etc.)
- Reject `success=true` if a tool-failure streak ≥ 3 occurred and the agent didn't pivot tools

**Where it lands:** `packages/reasoning/src/strategies/kernel/utils/termination-oracle.ts` gains a `controller-signal-veto` evaluator that runs after the existing `end_turn` evaluators.

**Expected impact:** would have flipped `failure-rate-limit-loop`, `failure-save-loop`, `failure-verify-loop` from false-positive success to true failure — taking the corpus from 5/8 → 8/8 correct boolean. **This is a single-file, ~80 LOC change with massive empirical impact.**

**Pattern: Verdict-Override.** The agent's self-report is one signal; the controller's aggregate is another; the meta-controller produces the final verdict by reconciling them.

---

### CHANGE B — Escalation ladder in the controller  ⭐ HIGH CONFIDENCE / HIGH LEVERAGE

**The fix in one sentence:** Tactical interventions (tool-inject, compress, stall-detect) currently repeat indefinitely with no graduation; they need an explicit escalation pipeline.

**Three-tier ladder:**
- **Tier 1 — Tactical** (current behavior): tool-inject, compress, stall-detect, early-stop
- **Tier 2 — Strategic**: triggered when N≥2 tier-1 dispatches in last 3 iterations with no entropy decrease → fire switch-strategy
- **Tier 3 — Terminal**: triggered when tier-2 fires and entropy still doesn't decrease → terminate-as-failure (this composes with CHANGE A)

**Where it lands:** `packages/reactive-intelligence/src/controller/dispatcher.ts` gains an "escalation guard" before each Tier-1 decision: check the recent dispatch history and graduate if needed.

**Expected impact:** would have fired switch-strategy on `failure-save-loop` (2 stall-detects with high entropy) and `failure-verify-loop` (2 stall-detect + 2 tool-inject). Combined with CHANGE A, this is the structural change that makes the framework actually act on its own detection signal.

**Pattern: Decision Ladder.** Each decision tier knows its trigger condition for graduating to the next tier. No tier loops indefinitely.

---

### CHANGE C — Provenance / single-source iter counter  MEDIUM CONFIDENCE / MEDIUM LEVERAGE

**The fix in one sentence:** `iter` on trace events is set by multiple writers and at least two of them disagree (controller events vs entropy-scored events) — collapse to one source.

**Specific finding:** entropy-scored.iter shows values like 23, 28 in scenarios where the kernel only ran 9 iterations. This is a separate writer using a different counter. It corrupted the corpus's iteration reporting and motivated the inspector script we just wrote.

**Where it lands:** `packages/reactive-intelligence/src/sensors/entropy-sensor.ts` (or wherever the entropy-scored event is emitted) — read `state.iteration` directly, never compute or buffer a separate counter.

**Expected impact:** stops corpus runs from misreporting kernel iterations as 29 when they're actually 9. Unblocks reliable AUC analysis going forward.

**Pattern: Single Source of Truth.** Every observable derived from kernel state must read the same field. No parallel counters.

---

### CHANGE D — Per-tier suppression thresholds  MEDIUM CONFIDENCE / MEDIUM LEVERAGE

**The fix in one sentence:** Suppression's `below-entropy-threshold` fires 14 times in 8 traces — the threshold is calibrated globally but local models have different entropy distributions than frontier models.

**Where it lands:** `ContextProfile` already has per-tier values (toolResultMaxChars, etc.); add `entropyDispatchThreshold?: number` and have the suppressor read it.

**Expected impact:** local-model suppression rate drops, more dispatches actually fire, more chances for CHANGE B's escalation to trigger.

**Pattern: Per-tier Calibration.** Behavior thresholds parameterized by tier rather than fixed globally.

---

### CHANGE E — The deferred Sprint 3 structural moves (already known)

These are prerequisites for the surgical changes above to compound. Listed for completeness:
- **G-4 full**: delete the 3 compression systems, route through ContextCurator
- **G-5**: `createRuntime(config, capability)` invariant signature
- **G-6**: ExecutionEngine 4404-LOC extraction (think/act/observe/synthesize → composable phases)
- **G-3**: async semantic memory via `Effect.forkDaemon` (W16) — unblocks the 8-12s memory-flush hot-path block

These are bigger lifts but each one removes a class of bugs that surface in the corpus. CHANGE A and B are *immediate* wins; CHANGE E unblocks the *next* wave.

---

## Confidence ladder — what we're sure about vs guessing

| Claim | Confidence | Evidence |
|---|---|---|
| W4 is held at the kernel-iteration level | ⭐⭐⭐⭐⭐ | Trace inspector confirms peakIter ≤ max in 7/8 traces |
| The corpus's "29 iters" was measurement noise | ⭐⭐⭐⭐⭐ | Distinct iter values from controller events: max 9 in worst trace |
| Termination oracle is the load-bearing bug | ⭐⭐⭐⭐⭐ | 3/4 false positives correlate exactly with absence of switch-strategy decision |
| Decision Ladder + Verdict Override would close them | ⭐⭐⭐⭐ | Direct evidence per scenario; one-file changes |
| Entropy gap shrinkage causes are X/Y/Z | ⭐⭐ | Single-sample variance not eliminated; need ≥3 runs to confirm |
| Per-tier thresholds will improve local-model behavior | ⭐⭐⭐ | Plausible from suppression count; not directly measured |
| Sprint 3 structural moves are correct priorities | ⭐⭐⭐⭐ | Each addresses a confirmed gap (G-3..G-6) but wins are downstream of CHANGE A+B |

---

## Recommended action sequence (highest leverage first)

**This week (one PR each, ~1 day each):**
1. **Implement CHANGE A** — Verdict-Override evaluator in termination-oracle.ts. Add gate scenario `cf-21-failure-detected-from-controller-signal`. Re-run corpus → expect 5/8 → 8/8 correct booleans.
2. **Implement CHANGE C** — fix entropy-scored.iter to read `state.iteration`. Add gate scenario `cf-22-trace-iter-from-state`. Eliminates the bogus 23/28 iter values.

**Next week:**
3. **Implement CHANGE B** — Decision Ladder in dispatcher. Add gate scenario `cf-23-tactical-escalates-to-strategic`. Re-run corpus → expect not just correct booleans but earlier termination on failure scenarios.
4. **Implement CHANGE D** — per-tier `entropyDispatchThreshold` on ContextProfile.

**Sprint 3 (already planned):**
5. **CHANGE E** — the structural deferred work. CHANGE A and B make the corpus correct; CHANGE E makes it FAST.

---

## What "great improvement" will actually look like in numbers

If CHANGES A+B+C land, the failure corpus should show:

| Metric | Today | Expected after A+B+C |
|---|---|---|
| Correct `success` boolean | 5/8 | **8/8** |
| Avg dispatches that escalate | 0.25 (1 of 4 failures had switch-strategy) | **≥3 of 4** |
| Steps over actual max iterations | 0 | **0** (already true; reporting fixed) |
| Entropy gap (success vs failure) | 0.140 | **≥0.300** (per-tier thresholds restore signal-to-noise) |
| corpus run wall time | ~5 min | **~2 min** (early termination on failures) |

**The agent-quality gains from CHANGE A+B alone would be larger than everything Phase 0 + Phase 1 has shipped to date.** Phases 0/1 built the *foundation* (typed errors, capability port, sole-author invariant); CHANGES A+B convert that foundation into *behavioral payoff* against the very corpus the framework was designed to handle.

---

## Patterns we now know we need (post-S2.5 reflection)

1. **Verdict-Override** — terminal decisions reconcile multiple signal sources, never trust one
2. **Decision Ladder** — tactical decisions graduate to strategic if they don't change the trajectory
3. **Single Source of Truth** — derived observables (iter, tokens, entropy) all read from the same kernel state field
4. **Per-tier Calibration** — behavioral thresholds parameterized by ContextProfile, not fixed globally
5. **Sole Author** (already shipped via S2.5) — one component owns each concern, no parallel paths
6. **Trust Boundary** (already shipped via S2.3 + S2.5) — content provenance is part of every observation, drives rendering decisions
7. **Provenance** (CHANGE C extends Single Source of Truth) — every emitted event carries the `state.X` field it depends on, never a stored or computed parallel

These are the design patterns the framework lacks today and that the failure modes prove it needs. The North Star plan can be re-grouped around these — CHANGE A through D map cleanly to patterns 1-4.
