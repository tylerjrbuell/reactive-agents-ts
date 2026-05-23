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

(none yet)

## Summary (2026-06-15)

(written on evaluation day)
