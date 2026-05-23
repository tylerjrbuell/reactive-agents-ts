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
