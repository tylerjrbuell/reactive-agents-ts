---
date: 2026-05-24
bundle: w26b2-builder-withers
pr: "#134"
issue: "#76 (final follow-up)"
status: shipped
---

# Execution Retro: W26-B-2 builder wither + api-surface

**Budget:** ~60 min | **Actual:** ~25 min execute phase

## Outcomes

- **Net LOC delta:** builder.ts: 2512 → 2372 (-140 / -5.6%). Two new modules (api-surface.ts +127, wither-applies.ts +163).
- **Net test delta:** 0 (runtime 811/0/1; build 38/38).
- **Issue #76 status:** still over ≤1500 LOC threshold for builder.ts; recommended close with W26 cumulative summary.

## What worked

- **Identified the realistic upper bound early.** Quick survey of 71 wither methods showed most bodies are 1-5 LOC; only ~5 had bodies large enough to make extraction worthwhile. Stopped chasing the ≤1500 target after this analysis and shipped what was clearly worth shipping.
- **Boundary-typed helpers.** `wither-applies.ts` declares a `BuilderState` interface listing exactly the private fields each helper mutates. Single named cast (`asState(builder)`) replaces 10+ scattered `(this as any)._field` accesses. Reviewer can grep the interface to know the helper's blast radius.
- **Re-export `ReactiveAgents.create` inline.** The `.create` factory is one line (`new ReactiveAgentBuilder()`). Trying to extract it would have required a dynamic-import dance to avoid the api-surface ↔ builder cycle. Keeping it inline was the right call; `fromConfig` and `fromJSON` extract cleanly because they already use dynamic imports internally.

## What didn't

- **builder.ts doesn't fit ≤1500 LOC under any plausible refactor scheme.** ~150 LOC of private state field declarations + ~40 wither docstrings (20-30 lines each = ~1000 LOC of just docs) + the `buildEffect` orchestrator (~200 LOC even after W26-B). Removing the doc weight isn't refactoring — it's a documentation choice. The ≤1500 target from #76 was probably set without accounting for JSDoc bulk.
- **Same master-plan stale-baseline issue.** Branched off origin/main pre-#131 merge; baseline was 2512 (pre-W26-B) rather than 2271 (post-W26-B). Decided to ship anyway — extractions are independent and trivially rebase-able when #131 lands.

## Skill improvements

1. **When LOC reduction stalls because of docstring weight, document the cap honestly.** The ≤1500 target from #76 didn't anticipate that wither methods carry ~30 LOC of JSDoc each. Future LOC-cap issues should specify whether docstrings count or not, and the audit skill should weight docstring bulk separately from logic bulk.
2. **For builder.ts specifically**: any further reduction needs either (a) a `withers/*.ts` per-domain split with one file per option family + class-mixin composition, OR (b) moving @example blocks to docs/. Both are bigger projects than a single bundle.

## Process inflation guard

- #76 verified-by claim held (builder.ts at 2512 at branch creation, matching what audit-2026-05-21 reported drift-adjusted).
- No bugs surfaced.

## Next actions

- [ ] PR #134 awaits review + merge.
- [ ] After all open W26 PRs (#130, #131, #132, #133, #134) merge: close #76 with cumulative-W26 summary comment.
- [ ] If ≤1500 builder.ts is a strict requirement: file separate "builder.ts doc-bulk reduction" issue (move @example blocks to docs/).
