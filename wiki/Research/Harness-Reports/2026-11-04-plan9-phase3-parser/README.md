---
type: experiment
status: complete
created: 2026-11-04
tags: [harness, h3, plan-9, tool-call-parser, stall-guard, regression-check]
---

# Plan 9 Phase 3 + 2a: targeted H3 (2026-11-04)

Targeted H3 on the four tasks with the most mangled tool calls (rw-6, rw-7, h3-todo-heavy, rw-9; k=5, cell timeout 150 s) on `dev` after `a854ebb06` (one assistant-text tool-call parser, Phase 3) and `281f5e737` (meta-only passes never stall, Phase 2a). Before = the same cells of the D9 full rerun (`2026-11-04-d9-full-h3`). Results: `results-cogito-8b.json`, `results-qwen3-4b.json`. Ledger entries 15 (cogito) and 16 (qwen), `--reason harness:tool-call-corrupted`.

| Tier | tool-call-corrupted | Pass | Verdict |
|---|---|---|---|
| cogito:8b | 9 → 0 | 3/20 → 5/20 | FIXED |
| qwen3:4b | 0 → 0 | 10/20 → 12/20 | NO-CHANGE (no regression) |

Pass deltas are within noise (20 Bernoulli runs per tier).

## What moved

- cogito: the parser now recognizes 17/20 runs' text calls (`guard:tool_call_extracted`). Where the arguments are not plain values it asks the model to restate the call instead of guessing (`signal:redirect@unresolved-tool-call-guard` 17/20). Six runs still end at that guard (`signal:block` 6/20).
- qwen: deliverable-decision blocks 5 → 2 and terminal status overrides 5 → 2; no new harness reason.

## Follow-up rerun (2026-11-05)

Same cogito cells after the follow-up fixes (`de759a2b5` batch pairing + parser hints, `c98609a2f` multi-positional binding, `30a3ab31c` riskLevel forwarded, `94442d65b` exact-call reprompt, `1e6f5ad8c` seeded-pass evidence). Results: `results-cogito-8b-followup.json`; ledger entry 17, verdict against the Phase 3 run above.

| | Phase 3 | Follow-up |
|---|---|---|
| tool-call-corrupted | 0 | 0 |
| ended at the unresolved-call guard | 6/20 | 2/20 |
| pass (verdict) | 5/20 | 6/20 (within noise) |
| harness-attributed failures | — | 2, both `harness:false-veto` |

The unresolved-call target moved as intended. Failures are now mostly model-attributed (8 of 16: ignored guidance, wrong output from correct evidence). The remaining harness reason is the Phase 2b authority defect.

## Remaining root causes (queued for kernel-warden)

1. The six cogito runs that end at the unresolved-call guard write `const x = fileRead("/abs", "utf-8")` or a bash fence `file-read /abs`. The kernel's hints to the parser (`assistant-turn.ts:215-218`) carry no `requiredParams` or `riskLevel`, so a positional argument cannot be bound to `path`.
2. Inside one parallel batch, the duplicate-read cache returned `a.json`'s content for a `b.json` read (run `01M6MBTSV7MQZS6QYHMFM2SYHH`, seq 2452/2481/2510). This is a correctness bug.
3. A correct synthesis grounded in tool evidence is vetoed by `output-is-model-authored` plus the `answer` floor, and `answer` was marked satisfied from text written before any evidence arrived (Phase 2b scope).
