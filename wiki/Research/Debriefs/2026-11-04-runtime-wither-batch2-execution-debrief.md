---
type: debrief
status: final
created: 2026-11-04
tags: [runtime, wither-census, execute-backlog]
---

# Execution Retro: runtime-wither-batch2
Date: 2026-11-04

## Outcomes
- Proven (red-on-cut): withMinIterations, withVerificationStep, withVerification, withHarness, withAgentTool.
- Left open: withA2A, withCircuitBreaker, withGrounding, withStallPolicy (#213 stays open).
- Net: +9 behavioral/baseline tests, 5 census rows SILENT -> PROVEN. Tests only, no source change.

## What worked
- LLM call count with a capturing `withReplayLLM` layer is a cheap deterministic observable for completion-gate withers.
- Cutting the wiring line in `runtime-construction.ts` / `build-effect.ts` turned exactly the targeted tests red.

## What didn't
- SCAN found no p0/p1 issues; #213 had no `Verified-by` block (census row used as evidence instead).
- `git checkout -B` in the shared checkout switched the other session's branch; reverted immediately, then moved to a worktree. Another live session had uncommitted edits in the same tree.
- `turbo typecheck --filter=runtime` fails in `observability#build` (OpenTelemetry duplicate-type error from the worktree's node_modules resolution); not verified against clean `dev`.
- `withTimeout` (batch 1) times out at 15s under machine load.

## Skill improvements (apply on next pass)
- Phase 3.5: when a live peer exists, create the worktree with `git worktree add` from the start; never run `git checkout -B` in a shared checkout.
- Phase 1: when no issue carries `Verified-by`, allow a named repo artifact (census/audit row) as evidence instead of dropping the whole backlog.

## Process inflation guard
- None found: the census claim ("SILENT") was accurate for all five.
