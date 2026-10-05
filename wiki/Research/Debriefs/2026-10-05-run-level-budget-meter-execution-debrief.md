---
type: debrief
status: complete
created: 2026-10-05
tags: [execute-backlog, budget, kernel, arbitrator, #231]
---

# Execution Retro: `run-level-budget-meter` (#231)

Date: 2026-10-05
Budget: 240 min (oversized P1, declared up front) | Actual: ~1 session

## Outcomes

- Issues: **#231 partially addressed** (kept open); follow-ups filed **#232, #233, #234**
- Net test delta: **+20** (reasoning 2907 → 2927; 0 fail)
- Net LOC delta: **+1064 / −4** (13 files)
- Merged locally to `dev` (`79686793`); no PR (local `dev` is ahead of `origin/dev`)

## What shipped

Canonical run-scoped budget meter: `kernel/run-budget.ts` (plain mutable
`RunBudgetMeter` + `CurrentRunBudget` FiberRef), fed by `observable-llm.ts`
(`complete` + `stream`), armed per execution by `services/reasoning-service.ts`,
seeded by `loop/runner.ts` onto `state.meta.runBudgetMeter`, consumed by
`arbitrationContextFromState` as `Math.max(meter, state.tokens)`. Verified:
reasoning 2927/0, typecheck 68/68, build 38/38, 0 new `as unknown as` sites.

## What worked

- **Deep recon before dispatch paid off.** Reading `observable-llm.ts`,
  `arbitrator.ts`, `runner.ts`, `reasoning-service.ts`, and the layer topology
  established that the pure+sync `arbitrationContextFromState` rules out an
  Effect `Ref` — the mutable-object-on-FiberRef design fell out of that
  constraint and the warden implemented it cleanly first try.
- **Declaring the oversize up front and descoping at PLAN time** (reasoning-only,
  cleanup deferred) kept the bundle within one package and shippable.
- **The warden reported an honest 0.78 confidence and a real caveat** instead of
  overclaiming.

## What didn't

- **The warden's strategy integration tests are partly masked by pre-existing
  gates.** For plan-execute and blueprint, the halt on `tokenLimit: 1` is driven
  by their existing strategy-level gates (the "interim"), not necessarily the new
  meter; `tokenLimit: 1` also trips the per-kernel `state.tokens` guard. The
  meter's *unique* run-scoped contribution is isolated only in the unit test
  (`state.tokens: 5, meter: 250, limit: 100`). The end-to-end tests prove the
  thread is live (`meter.tokens > 0`) but not that the meter alone caused the
  halt.
- **The warden's tests bypassed the production wiring seam.** They call
  strategies directly with `withRunBudgetMeter`, so `ReasoningService.execute`
  arming the meter was untested. The parent had to add
  `services/reasoning-service-run-budget.test.ts`.
- **The first services-wiring test failed typecheck** (`llm.complete` widens the
  error channel to `LLMErrors`, which `StrategyFn` rejects) — caught only by the
  full workspace typecheck, not the filtered package run.
- **A concurrent peer session** was active on the same checkout (untracked
  `2026-10-05-systemone-decision-backends.md`, edits to `Planning-Index.md` /
  `.astro`). No collision, but the live-peer hazard is real; `git add` was
  strictly file-scoped.
- **`completeStructured` exposes no usage**, so structured calls are unmetered —
  a genuine hole discovered mid-implementation, filed as #232.

## Skill improvements (applied to SKILL.md this pass)

1. **Mechanism isolation in integration tests.** When a bundle adds a mechanism
   whose observable effect is masked by a pre-existing fallback/gate, the
   integration test must isolate the new mechanism or the bundle must pin the
   isolation at the unit level and say so. Add as a Phase 4 rule.
2. **Production-seam test requirement.** For a mechanism wired at a service
   entry point (not just inside the changed module), the MissionBrief must require
   a test at the production seam; kernel-unit tests bypassing the wiring are not
   sufficient. Add to the warden-brief guidance.
3. **Warden dispatch under a harness without warden agent types.** This OpenCode
   harness exposes only `explore`/`general` subagents; the `.claude/agents`
   warden definitions are not dispatchable. Dispatch `general` with the warden
   definition + MissionBrief embedded, and record the deviation. Add to Phase 4.

## Process inflation guard (HS-18/22/31 lesson)

- The original issue's title said "80 src" while its summary said "79"; re-grounding
  gave **80 src / 266 tests**, confirming the counts in the title/comment over the
  summary. No inflation in this bundle's own claims: the warden's confidence (0.78)
  and caveat were honest, and the retro records the masked-integration-test
  limitation rather than claiming a clean per-strategy proof.
