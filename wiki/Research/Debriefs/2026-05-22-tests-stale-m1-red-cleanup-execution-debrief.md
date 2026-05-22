# Execution Retro: tests-stale-m1-red-cleanup

Date: 2026-05-22
Budget: 30 min | Actual: ~15 min

## Outcomes

- Issues closed: #80 (HS-24) — pending PR #99 merge
- Issues descoped: none
- Net test delta: 455 pass / 0 fail / **-1 skip** (455/0/2 — was 455/0/3)
- Net LOC delta: file 257 → 77 (-180)
- Verified-by recheck: target greps return 0 (was 4)

## What worked

- **Smallest-singleton-first heuristic paid off.** After two typing bundles (#97, #98), picking #80 — a pure deletion — kept session momentum without burning budget on new helpers/tests. ~15 minutes wall clock end-to-end.
- **Dead-cast sweep (skill v5) generalized to dead-code sweep.** The skill rule I just added for `as any` ("check if the underlying type already supports access; delete if so") translated directly to `test.skip` blocks ("check if the underlying shipped state already validates the mechanism; delete if so"). Same instinct, broader application.
- **Top-of-file pointer to the validation evidence.** Replaced the stale RED phase doc-block with a 6-line module comment citing the harness-report path. Future readers see WHY RED is gone, not just that it's gone. Costs nothing; saves a code-archaeology session later.

## What didn't

- **Bundle scope had a tiny gray area: trim or replace the 2 surviving smoke tests?** They're nearly-empty (`expect(0).toBe(0)`) and arguably also dead. I left them per the strict issue scope ("delete the lines the issue cites"). If a future audit flags them as zero-signal smoke tests, that's a separate fix. Worth noting: strict scope sometimes leaves nearly-adjacent dead code untouched. Skill already has a `feedback_flag_improvements_during_refactor.md` rule covering this — applied here by noting it in the PR's "Out of scope" section rather than expanding bundle.
- **No real verification beyond skip count.** Since the deleted test was *skipped*, the test runner couldn't tell me if it was load-bearing in any other way. The 4-grep verified-by recheck is the only objective signal. For dead-code deletions, this is structurally weaker than typing bundles' "X count drops to 0" check. Not a problem this pass — but worth tracking if more `test.skip`-deletion bundles come up.

## Skill improvements (apply on next pass)

1. **Phase 4 EXECUTE: generalize the "dead-cast sweep" to "dead-code sweep".** The v5 amendment said "check if the type already covers the access; delete the cast." Same logic applies to `test.skip` placeholders, dead helpers, stale interfaces — anything cited by an audit issue with a "delete dead X" verified-by. Update the section to phrase the check as: *"Before applying the issue's prescribed fix, check whether the cited code is dead in the current codebase state. Deletion is preferable to migration / replacement when the original purpose is already satisfied elsewhere."*
2. **Phase 5 VERIFY: explicit "dead-code deletion" verified-by guidance.** When the bundle is purely deletion (no new helper, no migration), the verified-by recheck is structurally weaker — just absence-of-pattern. Strengthen by also asserting: (a) test count drops by the expected delta (1 skip removed → skip count -1), (b) no inbound references remain to deleted symbols (`grep -rn "<DeletedSymbol>" packages/ … | wc -l` → 0 outside the test file itself). Add a small paragraph to Phase 5 verifying *intentionality* of the deletion via reference-count checks, not just absence of the target lines.

## Process inflation guard (HS-18/22/31 lesson)

- Was the verified-by inflated? **No.** Issue cited specific line ranges (L65–174, L246–257), helpers, and interfaces. All present, all removed cleanly.
- Drift check: line numbers matched exactly (no drift since the audit on 2026-05-20 — file untouched between audit and fix).
- Document the inflation shape: **none for this bundle.** Pure straight-line delete-as-cited. Counter-example for the inflation log: this is what a *clean* audit finding looks like — file:line ranges named, scope tight, evidence pointed at an external doc that confirms the staleness.
