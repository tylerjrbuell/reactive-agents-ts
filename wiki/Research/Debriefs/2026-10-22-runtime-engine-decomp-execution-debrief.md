---
type: debrief
status: shipped
created: 2026-10-22
tags: [runtime, decomposition, engine, execute-backlog, warden]
---

# Debrief — runtime-engine-decomp (GH #221 / program Task 4)

**Bundle:** Quality & Scalability Program Task 4 (fourth verbatim decomposition of the family).
**Merged:** PR #272 → `dev` (2026-10-22). Closes #221.

## What shipped

`packages/runtime/src/execution-engine.ts`: **1,976 → 991 LOC (−985)**, target ≤1,200 (beaten by 209). Issue cited 1,807 at filing; regrew to 1,976 in ~4 weeks — the fourth data point of the same disease, and the first decomposition landed UNDER the Phase A ratchet: the ceiling line was shrunk 1976→991 as a deliberate ledger edit in the same branch, so re-monolithing this file is now a CI failure, not a memory test.

11 verbatim `engine/execute-*.ts` modules (table in PR #272): obs-wiring 105, event-collectors 284, killswitch-bridge 91, telemetry-notice 70, lifecycle-guard 86, agent-started 110, output-derivation 67, output-screens 154, success-invariants 224, result-assembly 268, completion-obs 118. `ExecutionEngine` Context.Tag + interface + `ExecutionEngineLive` export + back-compat re-exports bit-identical; `index.ts` untouched.

## Shape note (new for this family)

This file is Effect-native (unlike the #217/#218 Promise shells), so the extraction idiom adapted: clusters moved as functions taking their acquired services/Refs/accumulators via explicit deps params — Ref and mutable-array IDENTITIES are passed in, never re-created (a re-created Ref would silently fork state). The warden script-verified line-set equality for all 14 ranges (0 divergences) — the verbatim-proof tooling from #219 extended.

## Clusters that stayed inline (all load-bearing reasons)

1. `isRootExecution` + status-renderer block: `tests/status-renderer-root-only.test.ts` READS execution-engine.ts source and pins literals to this file. Moving would break a source-scanning test — the test is the contract. (Future: that test should pin the new module path when the renderer cluster eventually moves; noted, not done.)
2. executeCore preamble + PhaseDeps bundle: orchestrator-level, ~10 LOC net for pure indirection.
3. Phase-dispatch sequence: already fully modularized (W23/W24 bootstrap→complete call sites).
4. Debrief-prep glue: `yield*` acquisitions must stay in the execute fiber/scope.

## Known follow-up (flagged by warden, honest)

`emitErrorSwallowed` site-strings inside moved modules still say `runtime/src/execution-engine.ts:<line>` (kept byte-identical per verbatim mandate; `error-swallowed-wiring.test.ts` validates format/uniqueness, not location — green). A re-anchoring tranche (point strings at true originating modules, shrink the file) is a small follow-up; filed as part of Task 5 scope in the tracker.

## Verification (parent, deterministic)

- tsc rc=0 + downstream turbo typecheck 29/29
- Runtime suite **1,679 / 7 skip / 0 fail / 310 files = exact baseline** (re-run on the rebased tree before push)
- Cast-ceiling 2/2; new modules 0 casts; raw 40→40
- Zero new throw/as-any in additions; all imports `.js`-suffixed
- Gates: `check-file-size.sh` green at 991 ceiling + 9 fixtures green; `check-string-errors.sh` 300/129 green
- Scope: 1 modified + 11 new files; commits ordered refactor-then-ledger (bisect-green intermediate states)

## Metrics for the program scoreboard

| Bundle | Shell LOC before → after | Modules | Verdict |
|---|---|---|---|
| #217 reactive-agent.ts | 3,303 → 2,338 | 4+review fix | merged |
| #218 builder.ts | 3,348 → 2,222 | 9 | merged |
| #219 think.ts | 2,445 → 676 | 10 | merged |
| #221 execution-engine.ts | 1,976 → 991 | 11 | merged |

Remaining ratcheted giants for future tasks: arbitrator 1,970 (#220), runner 1,903 + iterate-pass 1,896 (#222), plan-execute 1,714 (#265), benchmarks/runner 1,599 (#268), event-bus 1,576 (#266), runtime.ts 1,540 (#267), builder.ts 2,222 + reactive-agent.ts 2,338 (shells — shrink further only opportunistically via D1).
