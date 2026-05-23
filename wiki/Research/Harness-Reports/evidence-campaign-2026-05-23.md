---
tags: [evidence-campaign, harness, empirical-gate]
date: 2026-05-23
companion: architecture-drift-analysis-2026-05-23.md
purpose: ground each morph direction call in measurable real-run signal before any code lands
status: plan
---

# Evidence Campaign — Ground Morph Direction in Real Runs

## Principle

Architecture analysis (`architecture-drift-analysis-2026-05-23.md`) names 3 owner calls. Each is a hypothesis until measured against real runs. **No morph commit lands until the corresponding empirical signal is collected.**

This campaign turns each architectural call into a falsifiable question with a probe + threshold.

---

## Architectural Calls → Empirical Questions

### Call 1 — Compose subsume RI? Dual? Invert?

**Empirical questions:**
- Q1a: **Does RI dispatcher actually fire on real production workloads?** If RI is below-threshold on >80% of iterations across the gate corpus, RI's value is theoretical and subsumption-by-deletion is viable.
- Q1b: **Do RI interventions correlate with outcome improvement when they fire?** Compare success/quality/tokens on iterations where RI fired vs suppressed, same task.
- Q1c: **Are there Compose hooks that fire from runtime events RI does not see, and vice versa?** Enumerate exact event coverage diff.

**Measurable signal:**
- per-probe RI dispatched count, suppressed count, suppression reason histogram
- per-task A/B: `withReactiveIntelligence()` vs without — Δ success rate, Δ token count, Δ wall-clock
- coverage matrix: which events trigger RI handlers vs which trigger Compose hooks

**Threshold for decision:**
- If Q1a: RI fires on <10% of iter AND Q1b: when it fires Δ-success ≤ +2pp → **subsume (delete RI substrate, keep handlers as default Compose subscriptions)**
- If Q1a: RI fires on >30% of iter AND Q1b: Δ-success ≥ +5pp → **dual substrate justified; document boundary + write coverage tests**
- If Q1a: 10–30% AND Q1b: 2–5pp → **collapse to one (subsume); doesn't earn parallel substrate**

**Cheapest probe:** failure-corpus.ts on 3 models (cogito:14b, qwen3:14b, gpt-4o-mini) × 2 variants (RI-on / RI-off) = 6 runs × 8 scenarios = 48 traces. Use existing failure-corpus scenarios. Run time ~90 minutes.

---

### Call 2 — Strategies re-platform to phase compositions?

**Empirical questions:**
- Q2a: **How much of each non-reactive strategy maps cleanly to the 10 capabilities?** Line-by-line audit per strategy file.
- Q2b: **Do users observe outcome differences across strategies on the same task, or is the differentiation theoretical?** Same task across reactive / plan-execute-reflect / reflexion / ToT — measure Δ correctness, Δ tokens, Δ latency.
- Q2c: **Where in each strategy does it bypass the kernel for a reason vs by accident?** Identify which lines need ride-on-kernel vs which encode genuine algorithmic divergence.

**Measurable signal:**
- capability mapping table: per strategy, % of LOC = capability-mappable / strategy-specific / dead-code
- 5-task × 4-strategy matrix: correctness, tokens, duration, output quality (rubric or LLM-as-judge)
- diff diagnostic emit coverage (kernel-state-snapshot, verifier-verdict, llm-exchange) by strategy

**Threshold for decision:**
- If Q2a: ≥70% of strategy LOC is capability-mappable AND Q2b: cross-strategy quality variance ≤ 10% on matched tasks → **re-platform is high-ROI; minimal feature loss**
- If Q2a: ≥70% AND Q2b: cross-strategy variance > 30% → **re-platform but preserve algorithmic phases as named primitives** (ToT branch search ≠ reactive iter)
- If Q2a: <50% capability-mappable → **strategies have genuine algorithmic divergence; re-platform partial; some strategies stay parallel**

**Cheapest probe:** capability mapping audit = static analysis, no runs needed. Quality variance = 5 standardized tasks × 4 strategies × qwen3:14b = 20 runs. Run time ~30 minutes.

---

### Call 3 — `learn/` ownership: kernel capability or scattered?

**Empirical questions:**
- Q3a: **Does within-session learning currently improve agent performance on later iterations of the same task?** Measure first-iter vs last-iter quality on multi-iter runs.
- Q3b: **Do M6 skills / M7 calibration / M10 memory actually fire per iter, or only at run boundaries?** Trace emit count by phase.
- Q3c: **What's the cross-session learning rate today?** Run same task in 2 sessions, measure quality lift (or no-op) in session 2.

**Measurable signal:**
- per-iter quality delta on multi-iter probes (rubric or LLM-as-judge)
- emit counts: skill-activated, calibration-loaded, memory-recall — by iter, by phase
- 2-session repeat: session-1 success rate vs session-2 success rate, holding task constant

**Threshold for decision:**
- If Q3a/c: zero or negative cross-iter/cross-session lift → **learn/ as kernel capability is necessary; current scatter doesn't compound**
- If Q3a/c: ≥5pp lift on session-2 → **scatter works; learn/ as capability is premature**
- If only Q3a positive but Q3c flat → **session-2 persistence broken; fix M6 persistence first, capability question deferred**

**Cheapest probe:** 5 multi-iter tasks × 2 sessions × qwen3:14b = 10 runs. Run time ~30 minutes. Need cross-session memory persistence not disabled.

---

## Campaign Sequence — Cheap First

| # | Phase | Probe | Runs | Model | Time | Answers |
|---|---|---|---|---|---|---|
| 1 | Static | Capability mapping audit of plan-execute / reflexion / ToT | 0 | — | 30 min | Q2a |
| 2 | Coverage | Event coverage diff RI vs Compose (static + 1 trace replay) | 1 | qwen3:14b | 10 min | Q1c |
| 3 | Quality | 5-task × 4-strategy cross-strategy matrix | 20 | qwen3:14b | 30 min | Q2b |
| 4 | Within | 5-task multi-iter quality delta (existing wide probe) | 5 | qwen3:14b | 20 min | Q3a, Q3b |
| 5 | Cross-session | 5-task × 2-session repeat | 10 | qwen3:14b | 30 min | Q3c |
| 6 | RI ablation | failure-corpus × {RI-on, RI-off} | 16 | cogito:14b | 30 min | Q1a, Q1b |
| 7 | Tier expansion | wide-probe × {cogito:14b, qwen3:14b, gpt-4o-mini} | 36 | mixed | 60 min | All Q's by tier |

**Total wall-clock: ~3.5 hours including idle.** Total LLM calls: ~88 (mostly local Ollama, no cost).

Frontier slice (gpt-4o-mini in step 7) requires `OPENAI_API_KEY` — confirm before step 7 or drop frontier slice.

---

## Outputs

Each step produces a structured artifact for the next morph spec:

| Step | Artifact | Lands at |
|---|---|---|
| 1 | `capability-mapping-2026-05-23.md` — per-strategy line mapping | `wiki/Research/Harness-Reports/` |
| 2 | event coverage matrix (markdown table) | append to drift analysis |
| 3 | cross-strategy quality matrix (JSON + table) | `wiki/Research/Harness-Reports/` |
| 4 | within-session learning delta plot | `wiki/Research/Harness-Reports/` |
| 5 | cross-session persistence test results | `wiki/Research/Harness-Reports/` |
| 6 | RI ablation: success Δ, token Δ by scenario | `wiki/Research/Harness-Reports/` |
| 7 | tier-stratified probe summary | `wiki/Research/Harness-Reports/` |

After all 7: **morph spec is written with explicit empirical citations per call.** No vibes architecture.

---

## What Today's Sweep Already Tells Us (Re-anchored)

Re-reading `sweep-2026-05-23-qwen3-14b.md` with empirical-gate eyes:

| Finding | Already-evidence-supported claim | Still-hypothesis claim |
|---|---|---|
| F1 (plan-execute no snapshots) | confirmed (grep + trace replay) | "fix it" — fix priority needs Q2b |
| F3 (RI 0/5 dispatched) | confirmed on qwen3:14b only | "RI is dead weight" — needs Q1a/b across tiers |
| F4 (verifier passes shallow) | confirmed (1 trace, repro task) | "FM-C1 is catastrophic in practice" — needs Q3a (recurrence rate across tasks) |
| F7 (no llm-exchange) | confirmed (grep) | "blocks F8 diagnosis" — true; "high priority" — needs Q2c |
| F8 (78s think) | observed on 1 probe, 1 model | "thinking-mode regression" — needs cross-model repro |

**The drift analysis's morph direction is plausible but not measured.** Until campaign data lands, morph proposals are hypotheses, not directives.

---

## Decision Gates — When Campaign Modifies Drift Analysis

The drift analysis ranked top-3 calls. Campaign output may reorder them:

- **If Q1a shows RI fires <10% across tiers:** Call 1 (Compose subsume RI) drops to bottom — it's effectively already-dead-weight; subsume by deletion is mechanical.
- **If Q2b shows cross-strategy variance is high (>30%):** Call 2 (re-platform) becomes harder — strategies encode real differences, need careful primitive extraction not collapse.
- **If Q3a shows positive within-session learning despite no learn/:** Call 3 (open learn/) drops priority — scatter actually compounds via implicit channels.

Order of P1/P2/P3 in morph direction = order of strongest empirical signal.

---

## What This Costs vs Spot-Fixing

Spot fix F1 today = 1–2 commits, ~half day. Yields one bug fixed.
Campaign = 3.5 hours of runs + 1 day analysis = 2 days. Yields **empirically-grounded morph spec** that closes F1/F3/F4/F7/F8 as side effects of one architectural commit each.

Spot-fix ROI is local. Campaign ROI is structural. The user's stated framing ("identify what next-level harness needs") only resolves via campaign.

---

## Immediate Next Move

Step 1 (capability mapping audit) is pure analysis, no runs needed. Can start now, answers Q2a today, gates whether step 3 even needs to happen.

Step 2 (event coverage diff) similarly cheap.

Steps 3–7 = real runs, parallelizable in pairs (cogito + qwen3 on different probes simultaneously).

Recommend: kick off steps 1+2 now, surface Q2a result before scheduling steps 3–7.
