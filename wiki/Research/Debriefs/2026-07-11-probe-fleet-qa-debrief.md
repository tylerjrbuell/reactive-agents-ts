---
title: Real-world probe fleet QA — 8 findings, 4 fixed same-day
date: 2026-07-11
type: debrief
status: completed
tags: [harness, probes, qa, receipts, code-action, deliverables, accounting]
---

# Real-world probe fleet QA (2026-07-11)

**Method:** 10 probe archetypes building agents through the PUBLIC builder API against
live gemma4, graded with deterministic checks including receipt-claims-vs-disk
cross-checks. Fleet: `.agents/skills/harness-improvement-loop/scripts/real-world-probes/`
(`run-fleet.sh`). Reports: `wiki/Research/Harness-Reports/real-world-probes-2026-07-11/`.
Diagnosis: 4 parallel read-only investigators (root-cause maps), fixes inline.

## Fixed (each: RED pin → fix → live re-probe → commit)

1. **`309a5c3a` — inline agent loop deliverable-blind (3rd site of the ledger disease).**
   Every default-strategy run reported `produced:false` with the file on disk
   (p1/p2/p4/p5/p10) — inline-act executed tools with callId+args+success in hand and
   shipped NO ledger; `metadata.reasoningSteps` stayed `[]`. Now mints the canonical
   action/observation pair per call.
2. **`ed5caa07` — code-action structurally broken with real tools (5 defects).**
   Hyphenated builtin names as `new Function` params (invalid JS) AND declared to the
   model as callable; TS-annotated generations in a JS evaluator (10/10 attempts died);
   sandbox failure strategy-fatal past its own retry loop (⇒ tokensUsed:0/llmCalls:0
   lie); sandbox tool calls minted no ledger pair (4th site); code-execute's
   return-contract invisible (`result:null` on bare expressions read as failure).
   After: p7 ALL CHECKS PASS (exact 5239625 on disk, produced:true, honest accounting).
3. **`d4623073` — reflexion/plan-execute/ToT `llmCalls:0`.** Kernel counts its calls;
   strategies never read `state.llmCalls` nor counted direct calls. Live p9: 3/8/19.
4. **`b1755ff4` — `goalAchieved` null forever on end_turn.** `resolveGoalAchieved`
   (shared run()+stream): missing declared deliverable → false (outranks final-answer
   claims); all produced → null→true (never upgrades explicit false); pure Q&A →
   heuristic verbatim.

## Open backlog (ranked, with evidence)

1. **Content fabrication under produced deliverables** (p4, deterministic reproducer in
   fleet): ENOENT on rates.json → model hardcoded `usdToEurRate = 0.93` INSIDE a
   code-execute comment ("Assuming an exchange rate...") → wrote 186.00, success:true.
   ENOENT observation carried root but NO recovery hint (list-directory exposed but
   never named). Needs: verifier/grounding corpus at strategy+engine result boundary
   (zero verifier-verdict events outside react kernel) + hint wiring on this path.
2. **`success:true` with empty output** (p5 re-probe, p10 second run) — engine-path
   output ownership; M7 protects strategy results, not this path.
3. **ToT pathological cost on trivial tasks** — 19 LLM calls / 32k tokens / ~2min to
   add three numbers (p9). Adaptive avoids it; direct ToT selection has no floor.
4. **p6 semi-honesty** — output admits "could not be found" but `success:true`,
   terminatedBy end_turn (no requiredTools declared ⇒ no gate). Model-initiated
   abstain remains cut (known).
5. **Reflexion empty-generate budget collision** (kernelMaxIterations 3 < tool count) —
   from earlier wave, still open.

## Lessons

- The receipt-vs-disk cross-check found 3 of 4 fixed bugs — assert claims against
  reality, not against the framework's own bookkeeping.
- Test fixtures used underscored tool names (`add`, `web_search`) while every REAL
  builtin is hyphenated — the code-action parse-death shipped invisible for months.
- Same disease, four sites: a path that executes tools without shipping the canonical
  ledger (kernel act.ts was fine; blueprint/plan-execute/reflexion `a4c5154d`,
  inline loop `309a5c3a`, code-action sandbox `ed5caa07`). Any NEW execution path must
  mint the pair — candidate for an invariant test.
