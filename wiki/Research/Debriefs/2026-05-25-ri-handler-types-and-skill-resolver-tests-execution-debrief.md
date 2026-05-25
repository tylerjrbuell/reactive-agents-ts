# Execution Retro: ri-handler-types-and-skill-resolver-tests

Date: 2026-05-25
Budget: 60 min | Actual: ~45 min
Branch: `bundle/ri-handler-types-and-skill-resolver-tests`
Commit: shipped on `bundle/ri-handler-types-and-skill-resolver-tests`
PR: [#139](https://github.com/tylerjrbuell/reactive-agents-ts/pull/139)

## Outcomes

- Issues closed: #85 (HS-29 — 9 sites cast cleanup) + #81 (HS-25 — un-skip 2 tests)
- Issues descoped: none
- Net test delta: +2 pass / -2 skip / 0 fail (RI package); 0 fail workspace
- Net LOC delta: +115 / -42
- Files touched: 6 (2 src + 2 tests + 1 plan + barrel: skipped, no plumb needed)
- Adjacent improvement landed: 9 same-pattern sites in `tests/controller/dispatcher-compose-bridge.test.ts` wrapped with the same helper (5 baseline typecheck errors silenced)

## What worked

- **Bundling two single-file fixes in same package.** Cohesion = same package + complementary concerns (type cleanup + test un-skip). Cap of 2 kept scope clean, single PR ships both.
- **Adjacent-improvement detection during baseline.** Baseline typecheck flagged 5 errors in `dispatcher-compose-bridge.test.ts` with **identical root cause** to #85. Surfaced in plan doc under "Adjacent improvement found" before edits — applied the same helper to those 9 test sites with no scope creep (still single package, single helper, single concept).
- **`skipGlobalPaths` flag already existed in `discoverSkills`.** Saved a roundtrip — `SkillResolverConfig` just needed to plumb it through. Root cause was config-not-config-plumbing, not missing impl.
- **Plan doc captured "Out-of-scope" pre-existing reds explicitly.** When verifying, no temptation to chase the 7 remaining typecheck errors that were pre-bundle baseline.

## What didn't

- **sed re-wrapped my Edit-wrapped sites.** When mixing Edit (precise) with sed (regex bulk), sed's pattern `asInterventionHandler(fixedHandler(...));$` matched **both** unwrapped (good) AND already-wrapped (bad) sites because both end in `));$`. Result: lines 129-131 ended up with one extra `)` each (`)))))` instead of `))))`). Caught immediately by typecheck (`TS1005: ';' expected`), fixed with a single `replace_all` Edit. **Lesson:** if running sed in a mixed-edit session, pre-grep the file for the OPPOSITE pattern (already-wrapped) and exclude those lines. Or skip sed entirely and use `Edit` with explicit unique strings per site.
- **First Edit attempt failed silently on a duplicate-string match.** `Edit` requires unique `old_string`; "tool-failure-redirect" appeared twice. Got `replace_all` error — minor friction, but the duplicate count check should happen BEFORE the first Edit attempt to plan a unique-context strategy.

## Skill improvements (apply on next pass)

1. **sed-after-Edit hazard.** When using `sed -i 's/A/B/g'` to bulk-rewrite after Edit has already partially rewritten the same file, **first grep for B to confirm no prior-wrapping sites exist** that would re-match A's tail. Pattern: `before bulk-rewriting via sed, grep -c '<post-state-tail>' file` — if non-zero, fall back to per-site Edit with replace_all=true after constructing a unique `old_string`. Add to Phase 4 EXECUTE under tooling notes.

2. **Adjacent-improvement detection codified.** When baseline typecheck/lint is RED with errors in the SAME package as the bundle, scan their fix-shapes. If any error shares the bundle's root-cause class (same anti-pattern as the cited verified-by), **add to the bundle as an adjacent improvement** rather than punting to a follow-up — bundling is cheaper because the helper/fix-shape is already in scope. Document in plan's "Adjacent improvement found" section and update verified-by to grep workspace-wide. This generalizes the "test+fix combo" rule (v9) to "scope+adjacent-bug combo". Add as a new bullet under Phase 3 PLAN.

## Process inflation guard (HS-18/22/31 lesson)

- #85: zero inflation. Exact 9 sites at cited lines. Bonus: 9 additional sites of same pattern in test file (not cited but found via baseline typecheck — same root cause).
- #81: line drift +5 (within tolerance threshold of >5, on the edge). Semantic pattern intact. Root cause was misattributed in issue body ("filter on resolver call or update assertion") — actual fix was "plumb existing `skipGlobalPaths` flag through `SkillResolverConfig`". The flag already existed in `discoverSkills(...)` at `skill-registry.ts:194`; only the resolver-side wiring was missing. **Lesson for issue authors:** when an issue's "Fix direction" cites two alternatives, sometimes there's a third path (existing flag, not yet plumbed) that's strictly better. Reviewers should grep for `<feature>` in the downstream function before writing the issue body.

## Bundle metadata

- Branched from `origin/main` (clean) after switching off PR #138's branch
- Baseline tests: 474 pass / 2 skip / 0 fail (RI package)
- Post-bundle tests: 476 pass / 0 skip / 0 fail (RI package)
- Workspace: 5647 pass / 23 skip / 0 fail (no net-new failures)
- Build: 38/38 successful
- Typecheck: pre-existing 12 RI errors → 7 errors remaining (5 InterventionHandler ones resolved by my changes; 7 unrelated reds out of scope)
