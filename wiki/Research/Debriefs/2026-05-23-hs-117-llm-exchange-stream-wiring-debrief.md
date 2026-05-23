---
type: debrief
status: completed
created: 2026-05-23
feature: hs-117-llm-exchange-stream
warden: kernel-warden
verdict: PASS
tags: [harness-convergence, phase-1, raw-traces, pilot, anti-scaffold]
related:
  - "[[2026-05-23-harness-convergence]]"
  - "[[2026-05-23-team-ownership-dev-contract-pilot]]"
  - "[[2026-05-23-hs-113-capability-scoped-instrumentation-debrief]]"
---

# Debrief — HS-117 LLMExchangeEmitted on stream() (2026-05-23)

## What
Wired `LLMExchangeEmitted` raw-trace emission onto the `stream()` code path of the kernel observable wrapper. Single-commit landing (`60dac4b7`, +168/-18 across 2 files): `packages/reasoning/src/kernel/observable-llm.ts` gains a `Stream.tap` accumulator + `Stream.ensuring` single-emit, and `packages/reasoning/tests/kernel/observable-llm.test.ts` gains a stream-emission regression case.

## Why
Sweep-2026-05-23 evidence (`wiki/Research/Harness-Reports/sweep-2026-05-23-qwen3-14b.md` §F8): **0** `LLMExchangeEmitted` events across 97 probe traces — `makeObservableLLM` only wrapped `complete()` / `completeStructured()` while the kernel main loop calls `stream()`. F8 directly blocks diagnose-on-failure analysis: Stanford Meta-Harness (arXiv:2603.28052) reports raw traces account for a **15.4pp** accuracy delta (50% → 34.6% without). Closes F8 anti-scaffold per North Star §9 ("scaffold without callers").

## How
**Architectural call vs spec.** Issue #117 fix-shape proposed wiring at each of 4 provider adapters (anthropic / openai / google / ollama, ~160 LOC total). Wired once at the kernel observable wrapper instead — `runtime.ts:1101` stacks `makeObservableLLM` over the rate-limited layer, so every `LLMService` consumer routes through it. 4× LOC savings + no adapter-drift risk. Stream element + error types preserved (`Effect<Stream<StreamEvent, LLMErrors>, LLMErrors>`) so callers see identical events in identical order; `Stream.ensuring` fires only on finalization, so streams bound but never run produce no event.

Single `kernel-warden` dispatch shipped the source edits (+102/-16). Main-thread added the regression test in `packages/reasoning/tests/` because the tests/ tree is outside `kernel-warden` authority — handoff driven by warden's explicit risk-and-followups note.

## Outcome
- `bunx turbo run typecheck --filter=@reactive-agents/reasoning`: 8/8 green.
- `bun test packages/reasoning/tests/kernel/observable-llm.test.ts`: 3/3 (existing complete + completeStructured + new stream).
- `bun test packages/reasoning`: **1212 / 0 / 2941 expects** (was 1211; +1 new test).
- Warden: status=success, confidence=0.85, authority-bounds-honored=true, out-of-scope=[].
- Issue #117 closed. F8 closed. Phase 1.6 done.

## Surprises
- **Spec proposed the more expensive shape.** Issue #117's recommended fix was per-adapter wiring (~160 LOC, 4 surfaces, drift risk). The single-chokepoint alternative was strictly dominant once `runtime.ts:1101` was inspected — but the spec didn't flag the chokepoint. Suggests harness-convergence issue authoring leans toward "edit at the symptom" rather than "edit at the layer boundary."
- **Confidence 0.85, not 0.9+, despite zero out-of-scope edits.** Warden self-graded down because no test was added — correctly recognizing that the artifact was incomplete from a regression-prevention standpoint, even though authority bounds forbade the fix. The risk-flag handoff (warden → main-thread test add) is a pilot-positive signal: warden surfaced a known gap instead of silently leaving it.

## Lessons / What we'd do differently
- **Codify the risk-flag handoff pattern.** Warden authority-scoping means some artifacts will ship "complete within scope, incomplete overall." The HS-117 pattern — warden returns PASS with explicit `risk-and-followups: [no test added, tests/ outside authority]`, main-thread immediately closes the gap in same commit — should be the documented playbook, not an ad-hoc move. Add to pilot SOP.
- **Add "is there a single chokepoint?" to harness-convergence issue templates.** Before specifying N edit sites, the author should grep for layer wrappers (observable, rate-limit, retry) that all N sites already flow through. Would have collapsed #117 from 4-surface to 1-surface at spec time.
- **Stream-bound-never-run is a real category.** The `Stream.ensuring` semantics meant we got correct behavior (no spurious emit) for free, but it's worth flagging this class of bug as a future regression vector — e.g. a future refactor that swaps `Stream.ensuring` for `Stream.tap`-at-end would silently emit on bound-but-unrun streams. Test added.
- **Playbook held otherwise** — single dispatch, no re-spawn, authority bounds honored, evidence-anchored to sweep §F8.

## Anchors
- Commit: `60dac4b7`
- Stream wrap: `packages/reasoning/src/kernel/observable-llm.ts:115+`
- Regression test: `packages/reasoning/tests/kernel/observable-llm.test.ts:91+`
- Wrapper layer site: `packages/runtime/src/runtime.ts:1101` (stacks `makeObservableLLM` over rate-limited LLM)
- Evidence source: `wiki/Research/Harness-Reports/sweep-2026-05-23-qwen3-14b.md` §F8
- Research finding: arXiv:2603.28052 (Stanford Meta-Harness, 15.4pp raw-trace delta)
- Pilot log: `wiki/Research/Pilots/2026-05-23-team-ownership-dev-contract/log.md:38-58`
- Issue: [#117](https://github.com/tylerjrbuell/reactive-agents-ts/issues/117)
