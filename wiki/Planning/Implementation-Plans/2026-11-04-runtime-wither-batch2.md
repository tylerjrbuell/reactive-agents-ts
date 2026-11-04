---
type: plan
status: shipped
created: 2026-11-04
tags: [runtime, builder, wither-census, backlog]
---

# Bundle: runtime-wither-batch2
Date: 2026-11-04
Budget: 90 min
Issues: #213 (partial: 5 of 9)

## Acceptance criteria
- #213: each proven wither has a red-on-cut behavioral test through the real builder in `builder-seam-behavioral.test.ts`; its `wither-census.test.ts` row flips SILENT -> PROVEN.

## Execution units
1. withMinIterations / withVerificationStep / withVerification: observed as LLM call-count delta (baseline 1 -> 4 / 2 / 3).
2. withHarness (prompt.system transform reaches request) / withAgentTool (tool schema offered; `.withTools()` on both arms).

## Risk register
- Seam file timing test (`withTimeout`) flakes under machine load -> verified passes alone and at baseline; not caused by bundle.
- Other session edits main checkout -> work isolated in a git worktree.

## Verification protocol
- `bun run repo test` seam + census files; cast-ceiling test; red-on-cut by nulling each wiring line.

## Baseline
Seam file: 13 pass / 0 fail before the bundle.

## Out-of-scope (explicit)
- withA2A, withCircuitBreaker, withGrounding, withStallPolicy: census says they need live network failures, grounded or long runs; leave for a live-provider probe.
- #213 acceptance for those four stays open.
