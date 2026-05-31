---
title: Canonical Harness Core — tier-aware thin core, scaffolds earn their keep
date: 2026-05-31
status: design-spec (analysis + architecture + proof-gated roadmap)
branch: overhaul/agentic-core-2026-05-31
supersedes-scope: widens 2026-05-31-agentic-core-overhaul.md from "context layer" to the whole agentic loop
research:
  - "[[2026-05-30-harness-engineering-canon]]"
  - "[[2026-05-30-reactive-agents-alignment-gap]]"
  - "[[2026-05-29-agentic-context-engineering-findings]]"
  - "[[2026-05-31-agentic-core-overhaul]]"
proof-gate: "No design decision in this doc counts until it runs LIVE, whole-vs-whole, cross-tier. Unit-green is not evidence (this session built a context-projection system that never ran live, and a 'correct' project() that regresses live)."
---

# Canonical Harness Core

## Goal
A thin, robust, deterministic agentic core that gets out of capable models' way AND
earns measurable uplift on small models — where every optional mechanism is OFF by
default and graduates to on (per tier) only by a cross-tier ablation receipt. Salvage
the systems that earn their keep; remove the rest; never re-bloat the default.

## The mission tension (why "just go thin" is wrong for RA)
The harness canon ([[2026-05-30-harness-engineering-canon]]) — Anthropic, Manus,
12-factor, τ-bench — converges on a THIN harness: smallest high-signal context, minimal
resident tools, one loop, state-grounded verification, get out of the way. But that canon
is written for **capable models with large windows**. RA's mission is different and
harder: **small-model uplift AND frontier excellence in one framework.** Small models
genuinely benefit from scaffolding capable models don't need. So the principle is not
"thin = good." It is:

> **Tier-aware: thin by default; scaffold only where it earns measurable uplift, gated
> per tier, proven by ablation — never assumed, never default-everywhere.**

## The crux (why we keep spinning wheels)
Two problems, one root.
1. **Thick-by-default harness.** 13 mechanisms, a strategy dispatcher, a meta-tool zoo
   (brief/pulse/recall/find/discover-tools/completion-gaps), per-iteration context
   re-curation, recall/`[STORED:]` indirection, lazy-disclosure tool churn. The harness
   intervenes every turn — burning steps/tokens, breaking the KV-cache, luring weak models
   into recall-loops, and fragmenting the execution path across strategies.
2. **Piece-wise proof methodology.** We A/B pieces of the maze against other pieces (this
   session: project() vs curate() — both maze parts), flag-gated, each "no regression,"
   none moving the needle. Every mechanism carries a "KEEP" verdict from its own owner that
   was **never measured against its own absence**. The anti-scaffold principle is never
   enforced at the **aggregate**. So complexity only ratchets up. You cannot measure your
   way to thin one knob at a time — the drag is the sum, not any single piece.

The fix to (2) is the spine of this whole plan: **the unit of proof is the WHOLE loop,
whole-vs-whole, cross-tier — and the salvage map below is a set of falsifiable hypotheses
the bench adjudicates, not a list of verdicts.**

## Top-level principles
These govern HOW we work, above the architecture.

- **P0 — Live-or-it-doesn't-count.** No KEEP/REMOVE/REDESIGN decision is real until it runs
  live, whole-vs-whole, cross-tier on the bench. Unit-green proves the code runs, not that
  the design helps. (Antidote to this session's dead-function build + the live-regressing
  "correct" project().)
- **P1 — Strangler-fig migration is the de-risking, so it is top-level, not a final phase.**
  Old (thick) and new (thin core) run side-by-side behind the existing `RA_OVERHAUL` flag.
  The new path is proven incrementally. **Deletion of thick machinery happens ONLY on an
  aggregate live win** — which is exactly why Phase-4's piecemeal deletion was correctly
  blocked (`2026-05-31-phase4-ab-grid-and-deletion-gating.md`). Public API is preserved via
  shims throughout. This is the answer to "salvage what we have without sacrificing a better
  design": nothing is cut until its replacement out-performs it, live.
- **P2 — Salvage map = falsifiable hypotheses, not verdicts.** Each mechanism's
  KEEP/REDESIGN/REMOVE is a bench hypothesis. We may hold strong priors; we may not
  pre-decide what only the bench can settle. **Hard landmine:** lazy-disclosure (tool churn)
  was *empirically adopted 2026-04-26 for real prompt-curation gains*; canon says
  mask-don't-churn. That conflict is resolved by measurement, not by baking a removal that
  contradicts a measured gain.
- **P3 — Scaffold governance lifecycle (the scaling pattern).** Every optional mechanism
  obeys one lifecycle: `default-OFF → tier-gated trial → graduates to tier-ON only via a
  cross-tier ablation receipt (≥3pp first-attempt lift, ≤15% token overhead) → removed when
  it stops earning`. New mechanisms we add later plug in the same way and prove themselves
  the same way. This — not a code abstraction — is what scales without re-bloating the
  default. (Defer the generic plug-in interface; let it emerge from the 2nd–3rd real scaffold.)
- **P4 — pass^k cross-tier is the metric.** N≥3 per tier, report `pass^k` not `pass@1`
  (τ-bench: 90% pass@1 → 57% at k=8). Single runs hid the variance all session.

## The core architecture (five parts)
Tight by intent. Code-level schemas deferred to per-phase plans — the bench will reshape them.

1. **One reducer loop.** Model the agent as a (near-)pure reducer over an append-only event
   log: `reduce(log, capability) → next_action` (observe→decide→act→verify). ONE loop.
   Strategies (plan-execute / reflexion / ToT) become **reducer policies / prompt patterns
   over the same log and the same assembler** — NOT separate kernels with separate context
   assembly. (Kills the fragmentation that made this session's grid hard: adaptive routed to
   plan-execute, which bypassed the reactive assembler entirely.) 12-factor stateless-reducer;
   Anthropic "simplest pattern, workflows over agents."
2. **Deterministic context projection.** `project(log, capability) → messages`: pure,
   append-only, KV-cache-stable (no per-turn re-curation, no minute-precision timestamps).
   Per-result projection is **content-aware, not bare-reference**: recent result(s) FULL
   (tier-scaled budget); aged/overflowing results → **bounded content preview (head/tail +
   shape) + stable system-side reference**, honest truncation (`…[N omitted; re-run tool /
   resolved system-side]`), NEVER a bare pointer the model must chase. *(This folds in the
   Phase-4 grid finding: bare-ref `summary+ref` REGRESSED on overflow-summarize because the
   model could no longer read the content; legacy's inline compressed-preview stayed faithful.
   Content-preview is now one hypothesis inside the core, not the headline.)* The reversible
   store stays system-side; `recall`/`[STORED:]` leave the model stream entirely. Canon:
   tool-result clearing, reversible compression w/ pointers, recency placement, JIT retrieval.
3. **Capability → scaffoldProfile spine (the tier-aware heart).** `resolve(model) → {window,
   outputBudget, dialect, tier, scaffoldProfile}` — ONE source of capability truth; every
   budget (num_ctx sizing, projection budget, output budget) derives from it by construction
   (kills the 8192/32768/15360 drift). `scaffoldProfile` declares **which optional mechanisms
   are ON for this tier**, each entry backed by an ablation receipt. Frontier → near-empty
   (thin). Small → more scaffolds ON (recitation, tighter budgets, post-condition steering, …)
   — but each EARNED its tier-on, not assumed. This is the spine that reconciles thin-canon
   with the small-model mission. **Lock this; defer the plug-in plumbing.**
4. **State-grounded verification.** Success = content-aware post-conditions over real
   artifacts (expected items present, no leaked markers, deliverable path exists), checked
   **mechanically/deterministically** — the success authority; the prose/LLM "I did X" is
   demoted to a quality signal. Canon: τ-bench state-grounding, proxy-state, DSPy assertions,
   evaluator-optimizer (mechanical evaluator). Generalizes the existing reflexion "B" gate +
   the PostCondition terminal seam (which RA got right — keep the bones, add content-awareness).
5. **Minimal resident, masked tool set.** Tools resident + constrained via the provider's
   tool_choice (logit-mask analog), stable prefix, consistent name prefixes — **mask, don't
   churn**. Smallest high-signal set. *(Hypothesis, P2: masking ≥ lazy-disclosure churn
   cross-tier — must beat the measured 2026-04-26 churn gain to win.)* The meta-tool zoo is a
   removal hypothesis, not a decision (see salvage map).

## Salvage map (HYPOTHESES — the bench adjudicates, P2)
Strong priors stated; none is a verdict until live whole-vs-whole proves it.

**KEEP (high prior — RA got the bones right):**
- Two-record event model (messages vs steps); append-only log; replay pkg.
- Provider adapters + MCP across 6 providers (the MCP-name fix `34dc70cf` this session).
- PostCondition terminal single-owner seam (add content-awareness, part 4).
- Subagent delegation (canon: isolate context, return 1–2k-tok summary; delegate breadth-read,
  single-thread writes) — verify return-size.
- Memory store, **system-side / opt-in tool**, not auto-injected.
- The ablation discipline + wardens + this doc's governance lifecycle (P3).

**REDESIGN (high prior the current shape is wrong, replacement must out-perform live):**
- Context assembly → deterministic content-aware projection (part 2).
- Verification → content-aware state-grounded (part 4).
- Strategy dispatcher → reducer policies over one assembler (part 1).
- Capability/budget drift → the single capability→scaffoldProfile spine (part 3).

**REMOVE / DEMOTE-TO-OPT-IN (hypotheses to falsify against absence):**
- Meta-tool zoo (brief / pulse / discover-tools / find-as-router / completion-gaps) → at most
  1–2 opt-in (one real search tool). Hypothesis: removal does not reduce small-tier pass^k.
- Model-facing `recall` + `[STORED:]` markers + age-blind 4000 inline cap → system-side only.
  (Evidence prior: recall lures weak models into invented-key loops; spike `2c5d77bf`.)
- `extractObservationFacts` per-result LLM pre-digest → remove (≈44% of local tokens;
  non-canonical extra LLM call). Hypothesis: removal is token-protective at flat faithfulness.
  *(Caveat: Phase-3 ablation earlier found removal token-COSTLY on one fixture — re-test under
  the new projection; this is precisely a P2 "measure, don't assume" case.)*
- Lazy-disclosure per-iteration tool churn → masking (part 5). **P2 landmine:** must beat the
  measured 2026-04-26 churn gain; do not pre-remove.

## Proof methodology (the antidote to wheel-spin)
- **Whole-vs-whole, not piece-vs-piece.** Bench the entire thin core (a given scaffoldProfile)
  against the entire current thick harness. Aggregate live win authorizes wholesale deletion.
- **pass^k cross-tier** (P4), failure-mode tasks not comfort-zone tasks: overflow-summarize,
  overflow-transcribe, multi-result accumulation, weak-tier recall-temptation, dishonest-success
  detection. Tiers: frontier (sonnet), mid (haiku / gpt-4o-mini), local (qwen3.5 / qwen3.x;
  NOT cogito:3b — runaway).
- **Always-on wire telemetry** (overhaul principle #4): capture exactly what the model received
  (assembled messages) + what the provider returned (done_reason, prompt/eval tokens). No
  external proxy. Makes every A/B self-evident.
- **Frontier-first sequencing (critical, prevents a morale-killing false negative).** The bare
  thin core will likely LOSE to the thick harness on small tiers — because small-tier scaffolds
  aren't ported yet. Judge the bare core only where thinness is a virtue (frontier/mid: token
  win + no capability regression), establish that beachhead, THEN graduate small-tier scaffolds
  one at a time with cross-tier receipts. Do NOT run "bare-core vs thick" on local first and
  conclude the redesign failed.

## Phased roadmap (each phase a provable increment; control-first; no scaffold without a caller)
**Phase A — Measurement substrate (build FIRST; it is the substrate, not overhead).**
- pass^k failure-mode bench (extend `task-quality-gate.ts` / the `assembly-ab-grid.sh` shape):
  the failure-mode task set + content-aware faithfulness + recall-loop + token p95 + runaway +
  dishonest-success metrics, cross-tier.
- Always-on wire telemetry in both paths.
- **Lock the thick (current) baseline cross-tier.** Exit gate: baseline numbers recorded; bench
  reproduces a known failure (overflow-summarize on the tier it fails) and a known success.

**Phase B — The thin canonical core (frontier/mid first).**
- Single reducer + deterministic content-aware projection + capability→scaffoldProfile spine
  (thin profile) + state-grounded verification + minimal masked tools.
- Bench thin-core vs thick on frontier/mid. Exit gate: thin core ≤ tokens at no capability
  regression on frontier/mid, wire-proven, pass^k flat-or-up. (Expected win: tokens + determinism
  + zero recall-loops.)

**Phase C — Tier-aware scaffold graduation (earn the small tiers).**
- For local/small tiers, ablate each candidate scaffold (recitation, post-condition steering,
  tighter budgets, masking-vs-churn, observation handling) back ON only with a cross-tier receipt
  (P3 lifecycle). Each graduation is one ablation, one receipt, recorded in the scaffoldProfile.
- Exit gate: small-tier pass^k ≥ thick baseline on the failure-mode bench, with the scaffoldProfile
  documenting WHY each ON entry is on.

**Phase D — Collapse + delete on aggregate win (the salvage payoff).**
- Once the thin core (with earned per-tier scaffolds) beats thick aggregate cross-tier live:
  migrate strategies to reducer policies, delete the dead thick machinery wholesale (the deletion
  Phase-4 correctly blocked piecemeal, now justified by aggregate win), keep public API via shims.
- Exit gate: thick path removed; `RA_OVERHAUL` becomes the default; no public-API break.

## Explicitly NOT in scope yet (YAGNI — let the bench teach us)
- A generic reducer-middleware / plug-in registry interface. Lock the capability→scaffoldProfile
  resolution; let the concrete plug-in abstraction emerge from the 2nd–3rd real scaffold (P3).
- Memory v2 / dreaming pipeline (separate initiative).
- Multi-agent task-typing policy (codify-later, alignment-gap P6).

## Open risks
- **Masking vs churn (P2 landmine):** new masking may not recover the 2026-04-26 churn gain on
  some tier → keep churn as a tier-gated option, don't hard-remove.
- **Reducer-policy strategies:** plan-execute/ToT currently carry real planning logic; collapsing
  to policies must not lose their decomposition value — bench plan-heavy tasks.
- **scaffoldProfile sprawl:** the governance lifecycle (P3) is the only thing preventing the
  profile from becoming the new maze. Enforce the receipt requirement strictly.

## Next action
Call advisor once more, then write the **Phase A** bite-sized implementation plan
(`superpowers:writing-plans` → `wiki/Planning/Implementation-Plans/`) — the measurement
substrate. No core code until the bench exists and the thick baseline is locked.
