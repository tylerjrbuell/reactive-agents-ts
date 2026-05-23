---
type: debrief
status: completed
created: 2026-05-23
feature: hs-116-controller-decision-classification
warden: none
verdict: PASS
tags: [harness-convergence, anti-scaffold, classification-pattern, no-warden, pilot]
related:
  - "[[2026-05-23-harness-convergence]]"
  - "[[2026-05-23-primitive-audit-fresh-lens]]"
  - "[[2026-05-23-team-ownership-dev-contract-pilot]]"
  - "[[2026-05-23-hs-129-recall-capability-phase1-debrief]]"
  - "[[2026-05-23-hs-128-budget-signal-arbitrator-debrief]]"
---

# Debrief — HS-116 ControllerDecision Union Classification + Coverage Guard (2026-05-23)

## What
Single-commit landing (`2f59bd50`, +154 LOC / -0 across 2 files) classifying the 13-variant `ControllerDecision` union in `packages/reactive-intelligence/src/types.ts`. Each variant tagged in JSDoc with one of three states — `✅ ACTIVE` (5), `🟡 UNFIRED` (4), `⚠ UNWIRED` (4) — plus cause note + followup direction. UNFIRED/UNWIRED variants marked `@experimental` to block silent public-API promotion. New `tests/controller/decision-coverage.test.ts` adds 5 regression cases pinning current registry shape: exactly 9 handlers, every ACTIVE/UNFIRED tag wired, every UNWIRED tag deliberately unwired, no handlers outside the union, no duplicates. **Zero code deletion.**

## Why
Audit R3 Tier 1 ([fresh-lens audit](2026-05-23-primitive-audit-fresh-lens.md) + `wiki/Research/Harness-Reports/ri-ablation-analysis-2026-05-23.md` §Q1a) showed only **5 of 13** declared variants empirically fire in the failure-corpus sweep — a North Star §9 anti-scaffold violation (declared > wired). Issue [#116](https://github.com/tylerjrbuell/reactive-agents-ts/issues/116) tasked disposition. The audit mandate was explicit: *"audit + prune/doc"* not *"delete now"* — evaluators may be referenced for Phase 2 wiring decisions, so the disposition needs to encode current state honestly rather than erase it.

## How
**Main-thread routing, zero warden dispatches.** `packages/reactive-intelligence/` is not in the warden authority table, so the pilot doctrine ([[2026-05-23-team-ownership-dev-contract-pilot]]) makes main-thread canonical owner. Three notable choices:

- **Three-state classification, not binary keep/remove.** ACTIVE (handler registered + corpus firing), UNFIRED (handler registered, no corpus firing), UNWIRED (evaluator file exists, no handler registration — dispatcher rejects with `reason="no-handler"`). Captures the actual spectrum instead of forcing a delete-or-promote choice.
- **`@experimental` JSDoc tag on UNFIRED + UNWIRED.** Prevents downstream consumers from depending on variants whose firing path is unproven; promotion to public API gated on wired+fired evidence accumulating per-variant.
- **Bi-directional drift guard.** The 5-case test fails on both `union-grew-without-handler` AND `handler-removed-while-variant-still-declared`. Catches scaffold drift from either direction at CI time, not at runtime as a silent `no-handler` rejection.

Pre-existing typecheck errors in `dispatcher-compose-bridge.test.ts` ablation-verified unrelated via `git stash`.

## Outcome
- `bun test packages/reactive-intelligence`: **469 pass / 2 skip / 0 fail** (was 464; +5 new `decision-coverage.test.ts`).
- `bunx turbo run typecheck --filter=@reactive-agents/reactive-intelligence`: new test compiles clean; pre-existing `dispatcher-compose-bridge.test.ts` errors unchanged + confirmed unrelated.
- 13/13 variants now have documented disposition + automated drift guard.
- Issue #116 closed. Audit R3 Tier 1 disposed.
- Followups filed via commit body: corpus expansion for 4 UNFIRED (probe scenarios for temp-adjust / skill-activate / tool-failure-redirect / harness-harm); handler registration decision per 4 UNWIRED (register OR delete; `human-escalate` bridges to canonical HITL gate at `packages/interaction/`); per-variant `@experimental` → public-API promotion as evidence accumulates.

## Surprises
- **UNWIRED is a stealthier anti-scaffold flavor than naïve "dead code."** A naive sweep would have caught variants with no evaluator file — but these have evaluator files (`controller/evaluators/`) that produce decisions which then reach the dispatcher and get silently rejected with `reason="no-handler"`. The failure mode is invisible from static grep — only the dispatcher-rejection log surfaces it. This is *executable* scaffold, not dead scaffold: it runs, allocates, logs, and accomplishes nothing. Worth promoting to North Star §9 vocabulary as a distinct anti-pattern: "scaffold that fires" vs "scaffold without callers."
- **`@experimental` JSDoc tag as a public-API protection mechanism is underused.** The tag exists in TypeScript convention but the project has no other current uses. HS-116 is the first time it's load-bearing — preventing premature contract lock-in on variants whose firing path is unproven. Promote to pilot doctrine: any union variant whose handler/caller pair isn't end-to-end proven should ship `@experimental` until proof lands.
- **No-warden routing produced a cleaner disposition than warden routing would have.** A warden dispatch would have asked "is this within my authority?" first; main-thread asked "what's the right classification taxonomy?" first. For audit-driven multi-dimensional sweeps (evaluator + handler + corpus), the synthesis question dominates the authority question. Codify: audit-driven classification work belongs on main-thread unless a single package owns all three dimensions.

## Lessons / What we'd do differently
- **"Audit + classify + drift-guard" is the canonical disposition pattern when delete-now is too aggressive.** Promote to convergence doctrine alongside HS-129's "seam-only Phase 1." Three components: (1) explicit multi-state classification in source-of-truth file with cause + followup-direction; (2) `@experimental` tag on unproven variants to protect public-API surface; (3) bi-directional regression test that catches drift in either direction. Applies any time an audit reveals N declared > M wired with the gap traceable to multiple causes (UNFIRED ≠ UNWIRED).
- **Failure-corpus expansion should be the default followup, not deletion.** Three of the 4 UNFIRED variants have plausible firing scenarios (entropy-driven temp, post-HS-122 skill persistence, repeated tool failure) that the corpus simply doesn't cover. Deleting them would lose Phase 2 leverage; expanding the corpus surfaces real lift evidence. Codify: UNFIRED disposition defaults to corpus expansion FU; UNWIRED disposition defaults to per-variant register-or-delete decision.
- **No-warden tasks deserve their own pilot-log section, not warden=none.** The pilot template assumes warden routing; HS-116 is the first session entry where `warden: none` is correct-by-design, not a bypass. Future audit-driven classification work will likely reuse this shape — add a "synthesis tasks" section to the pilot log schema so the routing decision is first-class.
- **Playbook held otherwise** — zero out-of-scope edits, ablation-verified unrelated test errors, followups enumerated with correct routing (RI package owner for handler decisions, runtime-warden for HITL bridge work, main-thread for `@experimental` promotion gates).

## Anchors
- Commit: `2f59bd50`
- Classified union: `packages/reactive-intelligence/src/types.ts:167-243` (13 variants × 3-state JSDoc)
- Drift guard: `packages/reactive-intelligence/tests/controller/decision-coverage.test.ts` (5 tests, +94 LOC)
- Audit evidence: `wiki/Research/Harness-Reports/ri-ablation-analysis-2026-05-23.md` §Q1a
- Audit context: `wiki/Research/2026-05-23-primitive-audit-fresh-lens.md` §R3
- Pilot log: `wiki/Research/Pilots/2026-05-23-team-ownership-dev-contract/log.md:39-60`
- Issue: [#116](https://github.com/tylerjrbuell/reactive-agents-ts/issues/116)
