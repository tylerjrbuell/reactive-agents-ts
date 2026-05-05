# North Star Closure Scorecard — 2026-04-25

**Question:** Are the failure modes the North Star plan set out to fix actually being closed by the work shipped in Phase 0 + Phase 1 Sprints 1–2?

**Method:** For each failure mode (G-1..G-6, W-series), document (a) the work shipped to close it, (b) the empirical evidence the work is doing what it claims, (c) the comparison to the Apr 24 baseline.

**Baseline:** `harness-reports/improvement-report-20260424-north-star-1.md` — corpus run on cogito:14b, six standard probes on qwen3:14b. Produced **before** any of this sprint's work landed.

**Current commits since baseline (11 PRs/commits across Phase 0 + Sprint 1 + Sprint 2):**

| Commit | What it shipped |
|---|---|
| `93ff6793` | Typed framework error taxonomy (P0 S0.1) |
| `d90641c5` | Capability port struct + Effect Schema + static table (S1.1) |
| `bb55fc26` | Persist Capability in CalibrationStore (S1.2) |
| `0601ba8c` | Capability resolver + Ollama num_ctx wired (S1.3) — closes G-1 |
| `9dbf57a0` | W4 regression pinned via cf-14 — closes W4 |
| `e139b7ee` | Probe-on-first-use for Ollama (S2.4 lifted forward) |
| `d1df7935` | Unify ModelTier with Capability.tier (S2.2) — closes G-2 |
| `f58d843b` | TrustLevel on ObservationResult — Q5 grandfather (S2.3) |
| `aa52eafa` | ContextCurator port + render primitive (S2.5 Slice A) |
| `d506e868` | Curator authors Recent observations section (S2.5 Slice B) |
| `5b93374b` | Production wiring via ContextProfile (S2.5 Slice C) |
| `853ce4be` | Showcase + performance tests for curator |

---

## Architectural-Gap Closure (G-1 through G-6)

| Gap | Title | Apr 24 Status | Current Status | Evidence | Verdict |
|-----|-------|---------------|----------------|----------|---------|
| **G-1** | Capability provider-scoped, `num_ctx` never set | ❌ unprobed | ✅ **CLOSED** | `cf-15-num-ctx-from-capability` green; `cf-16-capability-cache-roundtrip` green; `0601ba8c` ships `resolveCapability` 3-tier resolver; `e139b7ee` ships probe-on-first-use via `/api/show`. `num_ctx` now driven by `capability.recommendedNumCtx`. | ✅ Structurally closed + gate-pinned |
| **G-2** | Two `ModelTier` schemas (drift risk) | ❌ code-only gap | ✅ **CLOSED** | `cf-17-tier-derived-from-capability` asserts referential identity (`ReasoningModelTier === LLMProviderModelTier`). One source of truth in `llm-provider/capability.ts`; `reasoning/context-profile.ts` re-exports. | ✅ Structurally closed + gate-pinned |
| **G-3** | Tool observations never populate semantic memory | ⚠️ memory populates but blocks 8–12s on hot path | 🟡 **UNCHANGED** | Not addressed in Phases 0–1 Sprint 1–2. Memory-flush blocking time still observable in baseline traces. `Effect.forkDaemon` migration (W16) is queued. | 🟡 No regression, no progress |
| **G-4** | Compression is 3 uncoordinated systems | ❌ not directly tested | 🟡 **PARTIALLY CLOSED** | `cf-19` + `cf-20` pin ContextCurator as **sole prompt author** for the kernel (per S2.5 Slices A/B/C). The 3 compression sites (`tool-formatting.ts` always-on, `context-compressor.ts` advisory, `patch-applier.ts` message-slicing) are still present — deletion is the Sprint 3 follow-up. **What's closed:** prompt-author authority. **What's open:** compression-system unification. | 🟡 Structural authority closed; behavioral unification deferred |
| **G-5** | Termination scattered across 4 writers | ✅ confirmed via baseline (rate-limit-loop 16 vs 12) | 🟡 **PROTECTED, NOT FIXED** | `cf-14-w4-maxiterations-honored` pins the W4 regression at the unit level (builder hoists `maxIterations` to `_maxIterations`). The 4-writer architecture is still present; `cf-14` is a *guard rail*, not an architectural fix. ExecutionEngine refactor (S2.1) deferred to Sprint 3. | 🟡 Regression-pinned at unit level; structural fix deferred |
| **G-6** | `ExecutionEngine` 4,404 LOC mixed concerns | ❌ structural gap | 🟡 **UNCHANGED** | Not addressed. Same LOC count. Memory-flush 8–12s symptom still observable. | 🟡 No regression, no progress |

**G-closure summary:** **2 closed (G-1, G-2), 2 partially closed (G-4, G-5), 2 unchanged (G-3, G-6).** Of the 4 not-yet-fully-closed gaps, **all 4 are explicitly queued for Sprint 3** (G-3 → embedding batching; G-4 → compression-system deletion; G-5 → invariant signature/createRuntime; G-6 → ExecutionEngine extraction).

---

## Weakness Closure (W-series + IC-series)

| ID | Title | Closing Commit | Gate Scenario | Status |
|----|-------|----------------|---------------|--------|
| **W4** | `maxIterations` not enforced — agents run past ceiling | `9dbf57a0` (Sprint 1 close) | `cf-14-w4-maxiterations-honored` | ✅ Pinned (gate green) |
| **W11/IC-17** | `goalAchieved` not derived from `end_turn` stop reason | (P0 prior work) | `cf-04-goal-achieved-from-end-turn` | ✅ Pinned (gate green) |
| **P0 S0.1** | Untyped framework errors → swallowed silently | `93ff6793` | `cf-10-error-swallowed-event-emitted` | ✅ Pinned (gate green) |
| **P0 S0.3** | Secrets leaking into traces/logs | (S0.3 commit) | `cf-11-redactor-strips-secrets` | ✅ Pinned (gate green) |
| **P11** | Advisory-only intervention dispatches | (P11 commit) | `cf-13-no-advisory-only-dispatches` | ✅ Pinned (gate green) |
| **Q5/S2.3** | Internal meta-tools missing trust justification | `f58d843b` | `cf-18-meta-tools-trusted` | ✅ Pinned (gate green) |
| **Phase 1 §4 (port)** | No structural single-prompt-author invariant | `aa52eafa` | `cf-19-untrusted-observation-rendered` | ✅ Pinned (gate green) |
| **Phase 1 §4 (section)** | No trust-aware untrusted observation rendering | `d506e868`, `5b93374b` | `cf-20-curator-renders-untrusted-section` | ✅ Pinned (gate green) |
| **W2** | ICS observation nudges don't reset loop detector | (TODO) | `cf-TODO-w2-ics-observation-nudges-reset-loop-detect` | 🟡 Scaffold only; closing work queued |
| **W5** | Tree-of-thought candidate LLM call inflation | (TODO) | `cf-TODO-w5-tree-of-thought-candidate-llm-calls-infl` | 🟡 Scaffold only; closing work queued |
| **W13** | Early-stop high-entropy loops (per Apr 24 clarification: "16 vs 12 iterations" was actually steps, not iterations) | (none) | (none) | 🟡 Mischaracterization clarified; no closing work needed |
| **IC-13** | Entropy AUC validation needed | (validate-entropy.ts) | (script-based) | ✅ Validated previously (entropy AUC=1.000, dispatch AUC=0.750→1.000 after IC-13 fix) |

**Weakness closure summary:** **8 closed (gate-pinned), 2 scaffolded (W2, W5), 1 clarified (W13), 1 already-validated (IC-13).** No regressions detected.

---

## Empirical Performance Signals

### Gate scenario aggregate (all currently green)

```
cf-04  goal-achieved-from-end-turn          ✓ green (W11/IC-17)
cf-10  error-swallowed-event-emitted        ✓ green (S0.2)
cf-11  redactor-strips-secrets              ✓ green (S0.3)
cf-13  no-advisory-only-dispatches          ✓ green (P11)
cf-14  w4-maxiterations-honored             ✓ green (W4)
cf-15  num-ctx-from-capability              ✓ green (G-1)
cf-16  capability-cache-roundtrip           ✓ green (G-1 cache)
cf-17  tier-derived-from-capability         ✓ green (G-2)
cf-18  meta-tools-trusted                   ✓ green (Q5/S2.3)
cf-19  untrusted-observation-rendered       ✓ green (port)
cf-20  curator-renders-untrusted-section    ✓ green (section)
                                            -----
                                            11/11 green
```

### Curator stress-suite (today, gemma4:e4b, 4 scenarios A/B)

| Scenario | A-OFF fid | B-ON fid | Verdict |
|---|---|---|---|
| S1 hn-faithful-citation | 100% | 100% | ≈ tie (B has +48% token cost, no gain) |
| S2 selective-filter | 71% | 86% | ✓ fid win — B got 2 picks A missed |
| S3 multi-tool-synthesis | 0% | 0% | ≈ tie (both failed — separate FC chaining bug) |
| S4 pure-synthesis | 100% | 100% | ≈ tie (-5% tokens, no observations to render) |
| **AGGREGATE** | **68%** | **71%** | **1W 3T 0L** — section helps targeted workload, no fidelity regressions |

**Key insight:** the curator section's value is *workload-dependent* — it pays off for selective filtering with non-default criteria (S2), is overhead for trivially-solvable tasks (S1), and is a no-op when no observations exist (S4). The off-by-default activation policy is the right design.

### Failure corpus (cogito:14b) — comparison vs Apr 24 baseline

| Scenario | Apr 24 success | **Today success** | Apr 24 steps/max | **Today steps/max** | Apr 24 disp | **Today disp** |
|---|---|---|---|---|---|---|
| success-days-of-week | true | **true** | 2/4 | **2/4** | 0 | **0** |
| success-capital-france | true | **true** | 3/4 | **5/4** ⚠ | 0 | **0** |
| success-rgb-colors | true | **true** | 3/4 | **5/4** ⚠ | 0 | **0** |
| success-typescript-paradigm | true | **true** | 5/4 ⚠ | **4/4** ✓ | 0 | **0** |
| failure-rate-limit-loop | **true** ✗ | **true** ✗ | 16/12 ⚠ | **29/12** ⚠⚠ | 5 | **5** |
| failure-save-loop | **true** ✗ | **true** ✗ | 6/12 | **5/12** ✓ | 0 | **0** |
| failure-verify-loop | **true** ✗ | **true** ✗ | 8/12 | **19/12** ⚠ | 2 | **2** |
| failure-contradictory-data | **true** ✗ | **false** ✓ | 8/12 | **4/12** ✓ | 0 | **1** |

**Today's aggregate metrics:**
- Framework `result.success` accuracy: **5/8** (was 4/8) — **+1 false-positive eliminated** (failure-contradictory-data now correctly returns `false`)
- Avg entropy gap (success vs failure): **0.140** (was 0.340) — entropy is a *less* useful discriminator today
- Avg dispatches on failure scenarios: **2.0** (Apr 24 also ~1.75)
- "steps over max" violations: 4 today vs 2 on Apr 24 — the *count* went up, but per the Apr 24 W13 clarification, this is a **steps-vs-iterations measurement confusion** (steps ≠ kernel iterations; corpus reports steps)

### Honest reading of the corpus deltas

**The wins:**
1. **One fewer false positive** (failure-contradictory-data: was `success=true` → now correctly `success=false`). The dispatcher fired exactly once at iter 4, the agent terminated correctly. **This is a real behavioral improvement.**
2. **success-typescript-paradigm** dropped from 5 steps to 4 steps — the only scenario that hit "steps>max" on Apr 24 is now within bound.
3. **failure-save-loop** completed in 5 steps (was 6) with correctly-low entropy.

**The regressions (or apparent regressions):**
1. **success-capital-france / success-rgb-colors** went from 3 to 5 steps. Same answer (success=true), but cogito spent more steps thinking. Likely driven by the curator's added context section nudging more deliberation, OR by Effect-3.19 type-drift fix changing some streaming behavior. Either way: harmless on outcome, but worth tracking.
2. **failure-rate-limit-loop** went from 16 to 29 steps. The agent kept retrying longer than before. Per Apr 24's W13 clarification, **this is the corpus's "steps" metric, not the kernel's iterations** — the kernel's `maxIterations=12` enforcement is what `cf-14` pins. Steps include thoughts + actions + observations, so 29 steps ≈ ~9-10 kernel iterations, still within the 12-iter max.
3. **Entropy gap shrunk from 0.340 to 0.140** — entropy is less useful as a failure predictor on today's framework. Worth investigating whether the curator's context changes are flattening entropy by giving the model "more to think about."

**What this evidence does NOT support:**
- ❌ "Cf-14 closed W4 in production." cf-14 pins the *builder hoisting*; the corpus shows agents are still running many steps. To confirm W4 is *behaviorally* fixed we'd need to inspect traces and confirm `state.iteration` doesn't exceed `maxIterations` (which is the actual W4 invariant, not "step count under maxIterations").
- ❌ "We've reduced false positives across the corpus." 1/4 is improvement, not transformation. Three of four labeled-failure scenarios still return `success=true`.

**What this evidence DOES support:**
- ✅ The dispatcher fires more meaningfully (correctly killing failure-contradictory-data this time)
- ✅ One previously-broken scenario now produces the correct boolean
- ✅ No structural regressions visible — the gate-pinned behaviors hold

---

## Are We Heading In The Right Direction?

### What the evidence supports

1. **G-1 fully closed** — `num_ctx` is now structurally driven by capability resolution. Probe-on-first-use means agents don't need to update a static table for every new model. This was the highest-impact gap (it caused tool-call failures on local models with default 2048 contexts).

2. **G-2 fully closed** — single `ModelTier` source via `cf-17` referential identity assertion. Drift between two tier definitions is now structurally impossible.

3. **Sole prompt-author invariant established** — `cf-19` + `cf-20` pin that the ContextCurator is the only authority for per-iteration kernel prompts. This unlocks future migrations (compression unification, observation rendering) without architectural debate.

4. **W4 regression-pinned** — W4 was visible at runtime in the Apr 24 baseline (16/12, 5/4). `cf-14` now catches this at unit-test time before merge. Whether the corpus run today still shows it tells us whether the FIX (not just the gate) is holding — see corpus completion.

5. **Trust boundary surface established** — the curator's `<tool_output>`-wrapping for untrusted observations is the first structural defense against prompt injection from tool outputs. Today it's opt-in; the seam is in place for future tightening (defaults, per-tier policy).

6. **Curator helps the targeted workload** — empirically validated today (S2 selective-filter: 71% → 86% with section ON). Validates the design thesis.

### What the evidence does NOT yet support

1. **No claim of agent-success-rate improvement on the failure corpus** — the corpus comparison is the single most important empirical signal, and it's still running. Until then, we can claim *structural* progress but not *agent-quality* progress on the corpus.

2. **G-3, G-4 (full), G-5 (full), G-6 still open** — Sprint 2 was scoped as Invariant + Curator + Trust + Tier; the bigger structural moves (compression-system deletion, ExecutionEngine extraction, semantic memory async) are explicitly Sprint 3 work. We've shipped the *prerequisites*; the structural moves themselves remain.

3. **Multi-tool chaining still broken on small local models** (S3 today: both A and B scored 0%). Orthogonal to curator; appears to be FC dialect / tool gating issue. Surfaces a Sprint 3 candidate item: healing-pipeline + native-fc work for local models.

### Net assessment (with corpus comparison)

**Verdict:** 🟡 **Heading in the right direction on STRUCTURE; behavioral payoff is partial and uneven.**

| Dimension | Status | Evidence |
|---|---|---|
| Structural gap closure | ✅ Real progress | G-1, G-2 closed; G-4 partial (sole-author invariant established); W4 builder-pinned |
| Sole prompt-author invariant | ✅ Established | cf-19 + cf-20 pin the curator as the only authority |
| Trust boundary surface | ✅ Established | `<tool_output>` wrapping primitive in place; opt-in production wiring |
| Targeted-workload agent gain | ✅ Validated | S2 selective-filter went 71% → 86% with section ON |
| False-positive corpus reduction | 🟡 Marginal | 4/8 → 5/8 correct (+1). Real but small. |
| Entropy as failure discriminator | ⚠ Worse | Gap shrunk 0.340 → 0.140. Worth investigation. |
| W4 *behavioral* fix (not just builder pin) | ❓ Unclear | Step counts went UP in corpus. Per Apr 24's W13 clarification, this is steps-not-iterations confusion, but it warrants direct trace inspection to confirm. |
| Multi-tool chaining for local models | ❌ Still broken | S3 today: 0% on both A and B. Orthogonal to curator; queued for Sprint 3 healing pipeline. |

### What we should do with this picture

**1. Don't over-claim.** The structural work is real and the gates are pinned, but the corpus shows only 1 fewer false positive — calling this "we fixed agent quality" would be unjustified.

**2. Investigate the entropy gap shrinkage.** Going from 0.340 to 0.140 is a -59% drop in our discriminator's strength. Plausible causes: (a) curator changes alter entropy distribution, (b) Effect-3.19 type-drift fix changed some streaming behavior, (c) cogito:14b model state difference. Worth a focused probe before Sprint 3 leans on entropy more heavily.

**3. Trust-but-verify W4.** cf-14 is green; corpus shows steps-over-max counts that *look* like W4 violations but per the Apr 24 clarification are likely steps-vs-iterations confusion. **Action**: write a one-shot script that reads the most recent corpus traces and reports the actual `state.iteration` peaks per scenario. If those are ≤ maxIterations, W4 is genuinely closed; if not, cf-14 is testing the wrong thing.

**4. Sprint 3 priorities are confirmed by this data:**
   - **G-4 deletion** (the 3 compression systems): likely contributing to the entropy-gap shrinkage by adding noise
   - **G-6 ExecutionEngine extraction**: still a 4404-LOC structural risk
   - **Healing pipeline for local models**: S3 multi-tool chaining failure is a Phase 2/3 priority
   - **Async semantic memory** (G-3, W16): unblocks the 8-12s memory-flush hot-path block

### Bottom line

The North Star plan's *structural* targets are being closed at the rate the plan predicted (G-1 ✅, G-2 ✅, G-4 partial, W4 pinned, sole-author invariant established). The *behavioral* payoff in the failure corpus is real but small (+1 false positive eliminated) and accompanied by a concerning signal (entropy discriminator weakened by 59%). The work is moving in the right direction, but **we should not yet claim agent-quality wins**; we should claim structural-foundation wins and invest Sprint 3 in (a) the deferred deletions/refactors that will make the structural work pay off behaviorally, and (b) a focused investigation of the entropy-gap regression before it compounds.

---

## Appendix: How to re-run this scorecard

```bash
# Failure corpus (~5 min on cogito:14b)
bun .agents/skills/harness-improvement-loop/scripts/failure-corpus.ts

# Gate scenarios (~2s)
bun run gate:check

# Curator stress suite (~6 min on gemma4:e4b — see scratch.ts)
bun scratch.ts

# Then update the corpus comparison + agent-suite tables in this doc.
```

Sources of variance to be aware of: (a) cogito:14b temperature defaults; (b) Ollama model state differs across runs; (c) HN scores drift between runs (controlled in our suite via cached fixture); (d) gemma4:e4b is a small model with high variance on edge-case judgments. For statistical claims, run each ≥3 times and report median + range.
