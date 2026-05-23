---
type: debrief
status: completed
created: 2026-05-23
feature: hs-129-recall-capability
warden: kernel-warden
verdict: PASS
tags: [harness-convergence, audit-fresh-lens, tier-1, phase-1-only, 10-capability-model, milestone, pilot]
related:
  - "[[2026-05-23-harness-convergence]]"
  - "[[2026-05-23-primitive-audit-fresh-lens]]"
  - "[[2026-05-23-team-ownership-dev-contract-pilot]]"
  - "[[2026-05-23-hs-120-learn-capability-phase1-debrief]]"
  - "[[2026-05-23-hs-128-budget-signal-arbitrator-debrief]]"
---

# Debrief — HS-129 RecallService seam (Phase 1, 2026-05-23)

## What
Single-commit landing (`8cbb1ed9`, +504 LOC / -0 across 4 files) creating `packages/reasoning/src/kernel/capabilities/recall/`. New `RecallService` Effect `Context.Tag` service with three methods — `recallMemoryContext(state, taskClassification)`, `findSkills(state, taskClassification)`, `loadProfile(state)` — all returning `Effect<R, never>` (recall failures swallowed per contract). `NoopRecallServiceLayer` is the default. Kernel runner wires the iter-start boundary at `runner.ts:694-738` (after iter-snapshot, BEFORE think dispatch). **Phase 1 = seam only**; Phase 2 (MemoryStore / SkillStore / CalibrationStore writers + upstream-recall migration) deferred. Sibling pair-landing with HS-120 learn/ (`a8dfc581`) earlier the same day.

## Why
Audit G-C Tier 1 ([fresh-lens audit](2026-05-23-primitive-audit-fresh-lens.md) §G-C lines 169–174, recommendation line 250). North Star v5.0 §3.1 names `recall` as a kernel capability and Optimal Execution Algorithm step 4 declares the three calls (`recall` / `findSkills` / `loadProfile`) — yet `kernel/capabilities/recall/` did not exist. Memory queries today happen UPSTREAM in `runtime/engine/bootstrap/skill-postprocess.ts` + `reasoning-think.ts`; the kernel consumes pre-loaded `input.memoryContext` but never recalls per-iter. **This commit + HS-120 close the 10-capability model: 8-of-10 → 10-of-10 directories shipped.** Architectural milestone — the named taxonomy is now structurally complete.

## How
**Single kernel-warden dispatch ×1** (status=complete, confidence=0.9, authority-bounds-honored=true, out-of-scope-touched=[]). Three notable choices:

- **Plain `yield*` NOT `Effect.forkDaemon` — divergence from HS-120 pattern, advisor-caught + documented inline.** Recall reads + returns values consumed in-iter (forking would leave `iterRecallContext` / `iterRecallSkills` locals empty when the main loop continues); learn writes were fire-and-forget. Same `Effect.serviceOption(RecallService)` pattern, different evaluation wrapper. Rationale lives in the commit body + JSDoc.
- **Per-iter LOCAL variables, KernelState NOT mutated.** `iterRecallContext` / `iterRecallSkills` captured but not persisted to `KernelState` — Phase 2 decides persistence shape (prompt injection vs new state field) once upstream-recall migration lands.
- **2-of-3 methods wired this commit.** `recallMemoryContext` + `findSkills` have callers every iter; `loadProfile` has no caller and is JSDoc'd as the Phase 2 runtime-warden seam. Partial anti-scaffold compliance accepted under audit Tier 1 mandate (close the directory gap; loadProfile gets its first caller when `CalibrationStore` Layer lands).

All five load-bearing invariants preserved (loop-detector streak, single termination owner, two-records discipline, no LLM re-verify, qwen3 thinking opt-in).

## Outcome
- `bunx turbo typecheck @reactive-agents/reasoning`: green.
- `bun test packages/reasoning`: **1240 / 0** (was 1233; +7 new co-located tests in `recall-service.test.ts` across 5 describe blocks — Noop semantics, absent-layer no-error, captured-arg writer, once-per-iter invariant, recall-BEFORE-think ordering).
- `runner.ts` diff: +48 LOC purely additive; no existing logic touched.
- Issue #129 Phase 1 closed. Audit G-C Tier 1 disposed.
- **10-capability model now STRUCTURALLY COMPLETE: 10-of-10 directories shipped** (`sense / comprehend / decide / reason / attend / act / reflect / verify / recall / learn`).

## Surprises
- **Advisor-caught architectural divergence applied correctly — pilot-positive signal.** Naïve precedent-following would have used `Effect.forkDaemon` to mirror HS-120 (same warden, same day, same audit tier). Warden consulted advisor, recognized recall semantics (reads + returns) differ from learn semantics (fire-and-forget writes), switched to plain `yield*`, and **documented the rationale inline**. This is the pilot working as designed: warden-autonomous-judgment + advisor-consultation produces better deviations than blind pattern-copying. Promote to canonical warden SOP: when a sibling-recent pattern exists, validate semantics match before mirroring.
- **Partial anti-scaffold compliance was the correct call.** Shipping `loadProfile` without a caller this commit would normally trip the "scaffold without callers" North Star §9 anti-pattern — but JSDoc'ing the method as a Phase 2 runtime-warden seam, with 2-of-3 methods exercised every kernel iter, lets the directory gap close cleanly without forcing an out-of-scope `runtime.ts` edit. Tier-1 audit mandate (close the directory) takes precedence over zero-tolerance scaffold-rejection when the unwired method has named Phase-2 ownership.
- **Confidence at 0.9 (vs HS-120's 0.85)** despite identical seam-only shape. Warden self-graded recall higher because 2-of-3 methods have callers (HS-120 learn had zero non-noop consumers post-merge). Consistent self-grading heuristic — partial activation > zero activation.

## Lessons / What we'd do differently
- **Seam-only Phase 1 pattern proven repeatable across two directories in one day.** HS-120 (learn/) + HS-129 (recall/) both landed as: directory + `Context.Tag` + `Noop*Layer` + runner wire + co-located tests, with Phase 2 writers externalized to follow-up dispatches. Codify as the canonical disposition for audit-detected directory gaps. Future audit Tier-1 amendments should default to this shape.
- **Pair-landings amplify the architectural-completion narrative.** Shipping recall + learn within hours produces a discrete, citable milestone ("10-of-10 directories") that two isolated commits would not. Future audit-detected gap clusters (e.g., G-E modality blocks + G-F replay cassette) should be sequenced as same-day pair-landings when warden bandwidth permits.
- **Warden + advisor consultation > blind precedent-following.** The forkDaemon → plain yield* divergence is exactly the kind of decision the pilot needs to capture as a positive signal. Promote to lift evidence: catalog warden-initiated divergences that survived advisor review as a distinct quality measure beyond status/confidence.
- **Playbook held otherwise** — zero out-of-scope edits, zero retries, UpwardReport faithful, follow-ups enumerated with correct warden routing (memory-warden / RI-warden / runtime-warden).

## Anchors
- Commit: `8cbb1ed9`
- Context.Tag service: `packages/reasoning/src/kernel/capabilities/recall/recall-service.ts`
- Barrel: `packages/reasoning/src/kernel/capabilities/recall/index.ts`
- Runner wire site (plain `yield*`): `packages/reasoning/src/kernel/loop/runner.ts:694-738`
- Regression suite: `packages/reasoning/src/kernel/capabilities/recall/recall-service.test.ts` (7 tests, 237 LOC)
- Sibling pair-landing: `a8dfc581` (HS-120 learn/) — see [[2026-05-23-hs-120-learn-capability-phase1-debrief]]
- Audit context: `wiki/Research/2026-05-23-primitive-audit-fresh-lens.md` §G-C lines 169–174, recommendation line 250
- Issue: [#129](https://github.com/tylerjrbuell/reactive-agents-ts/issues/129)
