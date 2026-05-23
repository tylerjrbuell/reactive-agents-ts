---
type: pilot-log
status: active
created: 2026-05-23
---

# Pilot Log — Team-Ownership Dev Contract

> Append-only. One block per logical kernel/* task. Format below. Summary section appended on 2026-06-15.

## Entry format

```yaml
- task: <short slug>
  date: YYYY-MM-DD
  warden: kernel-warden | provider-warden | tools-warden | memory-warden | runtime-warden | compose-warden | harness-warden | ablation-warden | release-warden | debrief-scribe | <main if bypass>
  routed: warden | main | bypass
  bypass-reason: <if bypass>
  commits: <count>                       # first-attempt = 1
  agent-spawns: <count>                  # for re-spawn metric
  tokens-est: <number from rtk gain>
  regression-prevented: <description | none>
  notes: <one line>
```

## Baseline (computed 2026-05-23)

> Run on day 1 of Phase 1. Compute first-attempt-completion and token-cost over the last 10 commits across the pilot's combined scope (all warden authority manifests: kernel + llm-provider + tools + memory + runtime + compose + cross-cutting), so the baseline matches the aggregate metric used in Phase 2 evaluation.

| Metric | Value |
|---|---|
| First-attempt completion rate | TBD-day-1 |
| Avg tokens / task | TBD-day-1 |
| Sample tasks (10) | TBD-day-1 |

## Entries

```yaml
- task: hs-129-recall-capability-seam-phase1
  date: 2026-05-23
  warden: kernel-warden
  routed: warden
  commits: 1  # 8cbb1ed9
  agent-spawns: 1
  tokens-est: ~67K
  regression-prevented: forkDaemon-misapplication (advisor-caught divergence)
  notes: >
    Single kernel-warden dispatch shipped Phase 1 SEAM mirroring HS-120
    learn/ pattern. Key divergence: recall uses plain `yield*` not
    Effect.forkDaemon — recall returns values consumed in-iter (forking
    would leave per-iter locals empty), learn fires fire-and-forget.
    Warden caught this via advisor consultation, applied correctly, +
    inline-documented rationale. Pilot-positive: warden autonomous
    judgment + correct deviation from precedent + traceable evidence.
    2 of 3 methods wired (recallMemoryContext + findSkills); loadProfile
    JSDoc'd as Phase 2 runtime-warden seam (no caller this commit by
    design — Phase 2 first consumer).
  evidence-anchors:
    - packages/reasoning/src/kernel/capabilities/recall/recall-service.ts:1-202 (3-method tag + Noop)
    - packages/reasoning/src/kernel/loop/runner.ts:694-738 (iter-start wire)
    - packages/reasoning/src/kernel/capabilities/recall/recall-service.test.ts (7 tests)
    - bun test packages/reasoning 1240/1240 (was 1233; +7 new)

- task: hs-120-learn-capability-seam-phase1
  date: 2026-05-23
  warden: kernel-warden
  routed: warden
  commits: 1  # a8dfc581
  agent-spawns: 1
  tokens-est: ~75K
  regression-prevented: forkDaemon-wraps-slow-writers (blocks-hot-path-risk)
  notes: >
    Single kernel-warden dispatch shipped Phase 1 SEAM only — directory
    + Context.Tag service + NoopLearningPipelineLayer + runner wire +
    4 co-located tests. Phase 2 (actual writes) deferred to follow-up
    dispatches per audit Tier 1 plan. Warden's autonomous decisions:
    (a) forkDaemon-wrap user writers (matches tool-execution.ts:526
    precedent for memory writes), (b) learn-specific delta cursors
    (avoid coupling with loop-detection's prevStepCount), (c) class-style
    Context.Tag (mirrors PromptServiceTag canonical pattern). All 5
    load-bearing invariants preserved.
  evidence-anchors:
    - packages/reasoning/src/kernel/capabilities/learn/learning-pipeline.ts:98-103 (Context.Tag)
    - packages/reasoning/src/kernel/capabilities/learn/learning-pipeline.ts:116-119 (NoopLayer)
    - packages/reasoning/src/kernel/loop/runner.ts:1494-1525 (forkDaemon write site)
    - packages/reasoning/src/kernel/capabilities/learn/learning-pipeline.test.ts (4 tests)
    - bun test packages/reasoning 1233/1233 (was 1229; +4 new)

- task: hs-128-budget-signal-arbitrator
  date: 2026-05-23
  warden: kernel-warden,runtime-warden
  routed: warden+main
  commits: 1  # 3db49f4a
  agent-spawns: 2  # kernel-warden + runtime-warden
  tokens-est: ~340K (provider runs combined)
  regression-prevented: side-channel-vs-canonical-termination
  notes: >
    Multi-warden coordinated landing. kernel-warden shipped arbitrator
    pre-guard + KernelInput type + runner seed + diagnostics emit
    + 17 co-located regression tests (confidence 0.85, +553 LOC, over
    ~200 LOC budget but justified by JSDoc heavy production helper).
    runtime-warden shipped .withBudget() builder + RuntimeOptions +
    config schema + 6 builder tests (status=partial-shipped, flagged
    strategy-bridge as out-of-authority FU). Main-thread completed:
    AgentEvent schema variant in core/event-bus.ts, StrategyFn input
    type, ReasoningService.execute params, ReactiveInput + DirectInput
    + kernelInput pass-through. End-to-end activation path now
    reaches Arbitrator pre-guard. Pilot data: 2 wardens both honored
    authority bounds, zero out-of-scope edits, zero retries; both
    flagged correct followups including kernel-warden's accurate
    pre-existing-runtime-error ablation note (FU-5).
  evidence-anchors:
    - packages/reasoning/src/kernel/capabilities/decide/arbitrator.ts:501 (BudgetLimits type)
    - packages/reasoning/src/kernel/capabilities/decide/arbitrator.budget.test.ts (17 tests)
    - packages/runtime/src/builder.ts withBudget chainable method
    - packages/runtime/src/__tests__/builder-with-budget.test.ts (6 tests)
    - packages/core/src/services/event-bus.ts:1060+ BudgetSignalCollectedEmitted
    - bun test packages/reasoning 1229/1229 + packages/runtime 817 pass

- task: hs-117-llm-exchange-stream-wiring
  date: 2026-05-23
  warden: kernel-warden
  routed: warden
  commits: 1  # 60dac4b7
  agent-spawns: 1
  tokens-est: ~62K (provider runs)
  regression-prevented: stream-bound-never-run-spurious-emit
  notes: >
    Single kernel-warden dispatch shipped makeObservableLLM.stream wrap in
    observable-llm.ts (+102/-16). Confidence 0.85 because no test added
    (tests/ tree outside warden authority — explicit out-of-scope per
    brief). Main-thread added 1 stream-emit regression test in
    packages/reasoning/tests/kernel/observable-llm.test.ts immediately
    after, per warden's risk-and-followups note. Closed F8 anti-scaffold.
    Authority discipline: warden refused to edit tests/ correctly.
  evidence-anchors:
    - packages/reasoning/src/kernel/observable-llm.ts:115+ (stream wrap)
    - packages/reasoning/tests/kernel/observable-llm.test.ts:91+ (regression test)
    - bun test packages/reasoning 1212/1212 (was 1211, +1)

- task: hs-113-emit-helper-extension
  date: 2026-05-23
  warden: kernel-warden
  routed: warden
  commits: 1  # 6af922cb
  agent-spawns: 2
  tokens-est: ~100K
  regression-prevented: none-known
  notes: >
    Dispatch #1 added optional outerLoopName?/outerIter? params to
    emitKernelStateSnapshot in kernel/utils/diagnostics.ts (+7/-1 LOC,
    1211/1211 tests). Dispatch #2 narrowed args.state from KernelState to
    a local KernelStateLike interface (+46/-9 LOC, 576/576 kernel tests).
    Both dispatches: confidence ≥0.9, authority-bounds-honored=true,
    out-of-scope-touched=[]. Re-spawn driven by genuine scope progression
    (signature opens → shape opens for outer-loop callers), not retry.
  evidence-anchors:
    - packages/reasoning/src/kernel/utils/diagnostics.ts:23-46 (KernelStateLike)
    - packages/reasoning/src/kernel/utils/diagnostics.ts:80 (signature)
    - packages/core/src/services/event-bus.ts:980-991 (schema fields)
```


## Summary (2026-06-15)

(written on evaluation day)
