---
title: Reactive-Agents Alignment Gap — canon vs our harness, prioritized changes
date: 2026-05-30
type: research
tags: [agentic, harness, gap-analysis, design]
related:
  - "[[2026-05-30-harness-engineering-canon]]"
  - "[[2026-05-29-tier-aware-context-architecture]]"
---

# Reactive-Agents Alignment Gap

Each canonical finding ([[2026-05-30-harness-engineering-canon]]) mapped to our
harness: ✅ aligned · ⚠️ deviates · 🔴 conflicts. Then the prioritized change set.

## Mapping

| Canon finding | RA today | Verdict |
|---|---|---|
| Verify world-STATE not prose/LLM-judge | Verifier (`agent-took-action`, `synthesis-grounded`) + reflexion `isSatisfied` judge **output text** | ⚠️ **deviates** — root of the `success:true`+no-file lie |
| Proxy state = minimal observable post-conditions | none — no first-class post-condition concept | ⚠️ missing |
| `pass^k` reliability, not `pass@1` | probes report single-run pass@1 | ⚠️ missing measurement |
| DSPy assertions + error-injected retry | B (reflexion required-tools gate) + verifier retry; no general assertion construct | 🟡 partial (B = brick one) |
| Evaluator-optimizer loop | reflexion (self-critique) — evaluator is the model, not mechanical | ⚠️ evaluator should be mechanical |
| **Mask/keep tools resident, don't churn** | `RA_LAZY_TOOLS` **dynamically prunes** visible + FC tool set **per iteration** | 🔴 **conflicts** — KV-cache break + the relevantTools-drop bug + recall-lure are all symptoms of tool-set churn |
| KV-cache prefix stability | system prompt injects `Date:`/`Time:` (minute-precision) every call + dynamic tool churn | 🔴 conflicts |
| Tool-result clearing (keep tool_use, drop payload) | inline ≤4000 + recall pointer >4000 + `extractObservationFacts` LLM pre-digest | 🟡 partial; **extractObservationFacts is a non-canonical extra LLM call** |
| Just-in-time retrieval (only for NOT-in-context) | recall/find exist; recall **lure** advertised even when data inline | 🟡 Inc 1 gate aligns it |
| Reversible compression (keep pointer) | `storedKey` + recall | ✅ aligned |
| Recitation — goal into recency each turn | brief/pulse exist; no continuous goal recitation; plan-execute plan not recited to recency | ⚠️ missing |
| Preserve errors in context | failed tool observations retained | ✅ mostly aligned |
| Workflows-over-agents / simplest pattern | adaptive routes to strategies | 🟡 routing is keyword-brittle (NOT the spot-test bug; lower priority) |
| Stateless reducer / event log | two-record (messages vs steps) + replay pkg | ✅ aligned |
| Reflexion = external-signal reflection | was self-text; B now gates on required tools | 🟡 fixed for required-tools; extend to post-conditions |
| File-as-memory / externalized context | scratchpad + 4-layer memory + skills | 🟡 partial |
| Sub-agent condensed summary (1–2k tok) | spawn-agent | 🟡 verify return size |
| Multi-agent: breadth-read ∥, writes single-thread | spawn-agent (no task-type policy) | 🟡 codify |
| Minimal resident tool set / ACI | lazy-disclosure reduces count via churn | 🔴 churn, not minimal-resident |

## Prioritized change set (root-level, canon-backed)

### P1 — PostConditionVerifier: state-grounded completion (THE anchor)
Make success a function of **observable post-conditions** (tool fired in ledger,
artifact produced, output structurally complete), **mechanically** checked — the
success authority over prose. Generalizes B across all strategies; demotes the
prose verifier to a quality signal. Derive post-conditions **deterministically**
(required tools → `ToolCalled`; literal deliverable path in task → `ArtifactProduced`;
format → `OutputContains`) — NOT LLM-derived. Validated: proxy-state (2602.16246),
τ-bench, DSPy assertions, evaluator-optimizer. **Closes the demotion gap (C)
without trusting the classifier** — the path `./commits.md` is literally in the task.

### P2 — Tool-set stability (stop per-iteration churn)
The relevantTools-drop bug, the recall lure, and KV-cache breakage are one root:
**we mutate the tool set every turn.** Canon (Manus): keep tools **resident**,
constrain via the provider's tool_choice / required mode (logit-mask analog) +
stable visible set. Action: stabilize the per-iteration visible/FC set (compute
once, hold), prefer provider tool-constraint over re-pruning; pass the tool
contract as ONE struct (kills the "forgot a field" class). Validated: Manus.

### P3 — `pass^k` reliability as the metric
Make consistency first-class: N≥3 per tier, report `pass^k` not `pass@1`. Single
runs hid cogito's flip-flop + gpt-4o-mini variance this session. Cheap, decisive.
Validated: τ-bench (90%→57% @ k=8).

### P4 — Recitation + recency placement
Recite the active goal/plan into the **recency** span each turn (Manus todo.md).
Pairs with plan-execute (recite the plan) + counters lost-in-the-middle on local
tiers. Validated: Manus, 12-factor dumb-zone.

### P5 — Remove non-canonical extras (smallest high-signal token set)
- Kill `extractObservationFacts` (Inc 2) where data is already inline — a redundant
  per-result LLM pre-digest (44% of local tokens); canon = clear/keep, don't
  pre-digest. (Ablation already specced.)
- Inc 1 recall-gate (built, opt-in) → aligns "keep recent in-context."

### P6 — Lower priority / codify-later
KV-cache prefix stability (coarsen the injected timestamp), routing-on-structure
(not keyword), file-as-externalized-memory for long tasks, multi-agent task-typing
(delegate breadth-read, single-thread writes), sub-agent summary-size check.

## The convergence thesis
Three of this session's "failure modes" are one canonical gap each:
1. completion lie → **state-grounded verification** (P1)
2. tool-visibility / recall churn → **tool-set stability** (P2)
3. variance/inconsistency → **`pass^k` measurement** (P3)
Tier-token issues (Inc 1/2/3) are the existing context-engineering campaign.
Model capability (cogito) is a floor the harness makes **honest**, not competent.

> [!gap] P2 (tool-set stability vs lazy-disclosure) needs an ablation: lazy-disclosure
> was itself empirically adopted (2026-04-26) for prompt-curation gains. Canon says
> mask-don't-churn — but our gain was real. Resolve by measurement, not assumption.
