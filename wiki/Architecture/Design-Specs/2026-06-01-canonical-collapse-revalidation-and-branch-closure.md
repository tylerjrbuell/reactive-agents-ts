---
title: Canonical Collapse — Revalidation Verdict + Branch-Closure + Phase-A Bench
date: 2026-06-01
branch: overhaul/agentic-core-2026-05-31
status: design-approved (brainstorm 2026-06-01); references the locked design specs, does NOT restate them
references:
  - "[[2026-05-31-canonical-context-assembly]]"   # the Context Engine target (design-locked)
  - "[[2026-05-31-canonical-harness-core]]"        # the Harness target + Phase A→D roadmap (design-spec)
  - "[[2026-06-01-context-length-handling-competitive-research]]"  # the one refinement folded in
purpose: "Three things only — (1) a revalidation verdict on the two locked specs vs the 8 value pillars + current research; (2) the bank-minimal branch-closure checklist for overhaul/agentic-core-2026-05-31; (3) the Phase-A bench design-intent. The ideal architecture already lives in the two referenced specs; this doc does not re-derive it."
---

# Canonical Collapse — Revalidation, Branch-Closure, Phase-A Bench

> **Not a 4th design doc.** The ideal architecture is the two locked specs above.
> This records: does it hold (revalidation), what banks now (branch-closure), and
> how we build the substrate that gates the redesign (Phase A bench).

## The value thesis being served (user mandate, 2026-06-01)
RA = an advanced, **transparent, controllable** harness, **adaptable to any model
cross-tier**, that drives robust agentic value + problem-solving — solving the field's
real pain points: **trust, cost management, model-adaptive intelligence, anti-black-box
control, anti-hallucination, observability, self-improvement** → deterministic, safe
results from any model, hobby → home-automation → business-domain. The architecture must
serve these 8 pillars, not just be tidy.

**Hard invariant (user, 2026-06-01):** *every refactored/new mechanism must return
**equal-or-better value** than the incumbent it replaces — proven, not assumed.* This is
the Phase-A bench's core verdict rule (§3).

---

## §1 — Revalidation verdict: ADOPT (the design holds)

The two locked specs were re-read in full and checked against the 8 pillars + the current
canon (Anthropic Effective Context Engineering, Manus, 12-Factor stateless-reducer,
τ-bench state-grounding/pass^k) and the 2026-06-01 competitive research (LangChain Deep
Agents, Anthropic context-editing+memory, OpenAI Agents SDK, Mastra).

**Verdict: adopt as-is. No pillar is unserved.**
- `canonical-context-assembly` (the Context Engine) — ONE append-only event log + content-
  addressed `ResultStore` + pure total `project(log, capability, store)` + capability-derived
  budgets + system-decided result projection (full | summary+ref | cleared) + observability-
  as-return-type + strategies-as-reducers + honesty-as-projection. Serves determinism,
  trust/anti-hallucination, anti-black-box (one inspectable path), observability by construction.
- `canonical-harness-core` (the Harness) — tier-aware thin core + capability→scaffoldProfile
  spine + state-grounded verification + masked tools + pass^k proof methodology + Phase A→D.
  Serves cross-tier model-adaptive intelligence, cost, and the small-model-uplift mission.

The two reconcile: **context-assembly = the destination (the maze deleted); harness-core =
the disciplined gate (deletion justified by whole-vs-whole cross-tier live win, P0/P1).**

### One research-backed refinement to fold into the design
**Budgets must be a FRACTION OF THE EFFECTIVE WINDOW — never a fixed per-tier char constant.**
- Every serious framework keys truncation/offload to a % of the model's actual window
  (LangChain Deep Agents offloads at 85% of window; OpenAI `truncation:auto`; Mastra
  processors). RA's hardcoded `toolResultMaxChars` (frontier 600 / large 800 / mid 1200 /
  local 4000) is the named anti-pattern — it caused the T3 frontier-truncation balk
  (`phase1-postcond-ab-2026-06-01.md`: sonnet budget 600 → saw 3/25 rows → 0/3 selection).
- Effective window ≈ **60–70% of claimed** (Chroma *Context Rot*; NVIDIA *RULER*). Budget
  large enough for system prompt + relevant context + last few turns, with **30–50% headroom
  for tool outputs** — i.e. a fraction of the *effective* window.
- This **sharpens** (does not contradict) `canonical-context-assembly` Pillar 4 ("every
  budget is a function of `ResolvedCapability`; num_ctx predicted from the assembled prompt").
  Folded-in rule: `ResolvedCapability` encodes **effective** window (~65% of claimed); all
  projection budgets are %-of-effective with tool-output headroom; **user-overridable** as a
  first-class control surface (the transparency/control pillar — mirror Mastra per-request
  override / OpenAI `ModelSettings`).

### Execution decision: Approach 1 + start the bench
Bank this branch clean (bank-minimal, §2); do the redesign on a fresh branch, **bench-first**
(§3 = harness-core Phase A). Proven structural deletions (curate(), post-cond unconditional)
are deferred to the redesign arc — they are context-assembly migration step 3 + verification
consolidation, and the curate() receipt has no frontier cell (see §2).

---

## §2 — Branch-closure: bank-minimal (do now)

Goal: leave `overhaul/agentic-core-2026-05-31` **stable, honest, mergeable** — proven wins
locked, dead weight gone, tree clean — with **zero redesign half-done.**

**Bank-minimal checklist:**
1. **Commit completed work** — audit doc fixes (`kernel-extension` + `kernel-debug` SKILL.md
   path/phase-model corrections + the dangerous `buildStaticContext`-is-dead inversion fix;
   `AGENTS.md` strategy count + debt register; `.agents/MEMORY.md` 10-subdir/runner-LOC) +
   the `overhaul/result-store.ts` orphan deletion (already staged, zero callers, tests green).
2. **Triage + commit untracked artifacts** — `wiki/` research + design specs → commit; the
   `task-quality-gate-*.json` cohort dumps → keep as evidence under `wiki/Research/Harness-Reports/`
   OR `.gitignore` if scratch (decide per content at commit time); `apps/examples/src/research/`.
3. **Verify build + full test GREEN + clean tree.** Non-negotiable "stable" gate.

> Note: the stale `think.ts:280` comment ("ContextManager.build() is the sole path" — false;
> project() is default-on, curate() is the `RA_ASSEMBLY=0` fallback) is **deferred with the
> curate() deletion** below, not fixed here — the comment describes a path being deleted in the
> redesign arc, and the file is under `kernel/` (kernel-warden pilot). Fixing it now would be
> churn on soon-deleted code.

**Net bank state:** 65 commits intact; proven flags (RA_ASSEMBLY, RA_POST_CONDITIONS)
default-on with documented opt-out killswitch (harmless); dead orphan gone; tree clean; green.

**Deferred to the redesign arc (proven, but medium structural — NOT this branch):**
- Delete `curate()` / legacy context path (1 live caller at `think.ts` `RA_ASSEMBLY=0`
  else-branch; ripples 13 src files + 9 tests; shares prompt-composer / `buildStaticContext`
  with project() → disentangle, not clean-cut). **Receipt is local+mid only — no frontier cell.**
  Do it under the bench so frontier gets covered before the cut.
- Make `RA_POST_CONDITIONS` unconditional (reflexion + arbitrator opt-out branches).

---

## §3 — Phase A bench (start now): the measurement substrate

This is `canonical-harness-core` **Phase A**, made concrete. It is the substrate the entire
redesign rides on — **no core/redesign code until the bench exists + the thick baseline is
locked.**

**Purpose:** a turnkey, cross-tier, **pass^k**, failure-mode bench that runs the WHOLE loop
under two arms (baseline vs candidate) and renders a verdict that **fails any refactor that
drops value on any axis** — the hard invariant, mechanized.

**Reuse (already wired — do NOT rebuild):**
- `apps/examples/spot-test.ts` — per-cell probe; emits `SPOT_RESULT_JSON` + auto-writes trace
  to `~/.reactive-agents/traces/<taskId>.jsonl`.
- `apps/examples/decider-cohort-report.ts` — manifest → per-tier `CohortStats`.
- `packages/trace/src/cohort.ts` — `aggregateCohort` / `compareCohorts` (honesty-gated
  `CohortDelta`) / `renderCohortDelta`; `analyze.ts` `analyzeRun`.
- trace auto-capture (`defaultTracingConfig`, on-by-default).

**Build (the missing ~150–250 LOC + fixtures):**
1. **Failure-mode task set** (NOT comfort tasks): overflow-summarize, overflow-transcribe,
   multi-result accumulation, weak-tier recall-temptation, dishonest-success bait. Where value
   is won/lost. (+ 1–2 comfort baselines for sanity.)
2. **Grid runner** — the missing outer loop: `tiers × tasks × arms × N(≥3)`; set env per arm;
   spawn `spot-test`; collect `SPOT_RESULT_JSON` → `manifest-<arm>-<tier>.jsonl`.
3. **Two-arm compare wrapper** — aggregate each arm → `compareCohorts(baseline, candidate)` →
   render verdict.
4. **Tiers:** frontier (sonnet), mid (haiku / gpt-4o-mini), local (qwen3.5 — **NOT** cogito:3b,
   runaway).

**The verdict rule (the hard invariant, explicit):** a candidate PASSES only if, **cross-tier**,
every value axis is **flat-or-better** — faithfulness ≥, pass^k ≥, dishonest-success-rate ≤,
deliverable-produced ≥ — **AND** tokens ≤ (or within the ≤15% overhead allowance *iff* it buys
≥3pp first-attempt lift). A blind metric = **inconclusive, never a silent pass**. No "win"
bought by dropping honesty or losing the deliverable.

**Metric:** pass^k (N≥3), not pass@1 (τ-bench: 90% pass@1 → 57% at k=8). Plus faithfulness
(section-coverage), token p50/p95, recall-loop rate, runaway rate, dishonest-success rate,
deliverable-produced rate.

**Exit gate (Phase A done):** one-command run; thick baseline locked cross-tier; bench
**reproduces a known failure** (overflow-summarize on the tier it fails) **and a known success**
— proving it has teeth to catch regression before it gates any redesign.

**Scope guard:** Phase A builds ONLY the bench. No core/redesign code in Phase A.

---

## §4 — Sequencing

1. **Bank-minimal** (§2) — now. Stable mergeable branch.
2. **Phase A bench** (§3) — now (fresh branch / continued). The substrate.
3. **Phase B → D** (the redesign — `canonical-harness-core`) — bench-gated, future. Thin core
   frontier/mid first → graduate small-tier scaffolds by receipt → collapse + delete maze on
   aggregate live win (this is where curate()/post-cond deletions + flag collapse land,
   each proving equal-or-better value).

**Discipline (non-negotiable, the repo's hard-won lesson):** P0 live-or-it-doesn't-count;
unit-green is not evidence; delete only on aggregate cross-tier live win; the bench is the
arbiter of the equal-or-better invariant.
