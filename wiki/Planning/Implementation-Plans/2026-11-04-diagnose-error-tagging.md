---
type: plan
status: complete
created: 2026-11-04
tags: [d3, error-tagging, diagnose, replay, execute-backlog]
---

# Bundle: diagnose-error-tagging
Date: 2026-11-04 · Issue: #285 (D3 tranche 2)

## Acceptance
- #285: the 12 `new Error` sites in diagnose (10) and replay (2) become `Data.TaggedError` classes with byte-identical messages; each class has a `_tag` anchor in a covering test; `check-string-errors.sh` baseline 286 -> 274 in the same commit.

## Execution units
1. Mint `packages/diagnose/src/errors.ts` (DiagnoseUsageError, GrepExpressionError, TraceNotFoundError) and `packages/replay/src/errors.ts` (ReplayLoadError); convert throw sites; export from both indexes.
2. Add `effect` as a direct diagnose dependency (one `bun.lock` line; frozen-lockfile verified).
3. `_tag` assertions in `diagnose.test.ts` and `load.test.ts`; lower ratchet; append tranche-2 dispositions to `d3-error-site-classification.md`.

## Risks
- Rejection identity for callers → messages unchanged, `instanceof Error` still true (TaggedError extends Error).
- Lockfile churn → reverted unrelated `bun-types` bump.

## Out of scope
- Remaining 274 sites (later tranches); changeset for new exports (not user-facing behavior).
