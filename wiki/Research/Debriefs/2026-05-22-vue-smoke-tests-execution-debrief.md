# Execution Retro: vue-smoke-tests

Date: 2026-05-22
Budget: 30 min | Actual: ~25 min

## Outcomes

- Issue closed (entirely): #82 (HS-26) — vue portion finishes the trilogy alongside PR #100 + PR #101
- Bug fixed: `packages/vue/src/use-agent-stream.ts` `StreamError` swallow (surfaced by RED, GREEN'd with svelte-pattern mirror)
- Issue filed: #103 (recurring `httpbin.org` flake — first instance of the skill v7 "track recurring flakes in own issue" rule)
- Net test delta: +12 / 0 (packages/vue: 0 → 12 tests, file count: 0 → 1)
- Net LOC delta: +249

## What worked

- **Behavioral RED found a real bug, not a false positive.** The `StreamError → status: 'error'` test failed with `Received: "streaming"`. First instinct could have been "adjust test to match impl"; instead, traced through the SSE parser and found the inner JSON.parse `try/catch` swallowed the rethrow. Compared to svelte's working impl (direct assignment, no throw) — one-line fix. Test became the regression check. Real defect would have hit prod silently otherwise.
- **Svelte-as-reference pattern.** When the vue bundle's coverage spec mirrored the svelte bundle's, divergent behavior surfaced quickly. Cross-package consistency check fell out of the test work for free.
- **v6 dead-code/improvement-during-refactor rule activated.** Skill memory `feedback_flag_improvements_during_refactor.md` says: while in the code, fix adjacent small issues. Did exactly that. 2-line behavior fix landed in the same PR as the test that caught it.
- **v7 flake-tracking rule fired correctly.** User reported 2 httpbin failures mid-bundle. Skill v7 says: workspace flakes unrelated to touched package don't block, but track recurring flakes in their own issue. Filed #103 with verified-by evidence (PR #99 + this session) and three fix-direction options. Skill text drove the right action without re-thinking the protocol.

## What didn't

- **Initial test missed the swallow path.** First draft of the SSE-error test passed because I wrote it against the assumed-correct contract, not the actual impl. Only when I ran it did RED appear. Lesson: in behavioral tests for parser-like code with try/catch boundaries, write the test against the SPEC (what should happen), then run — RED that surfaces a swallow is the test doing its job. (This is the inverse of writing the test against the current impl and trusting whatever it does.)
- **One-line behavior change shipped in a "tests" bundle.** The PR title says `test(vue): ...; fix StreamError swallow` — mixing test+fix is borderline scope creep. Defended by: (a) RED would have stayed RED without the fix, (b) skill v6 explicitly allows adjacent improvements during refactors, (c) the fix is 2 lines mirroring an existing-working impl. Worth tracking if this pattern recurs — if 3+ bundles ship "test+fix" combos, the skill should codify the bundle type.

## Skill improvements (apply on next pass)

1. **Phase 4 EXECUTE: codify "test+fix combo bundle" as a recognized type.** When a behavioral RED surfaces an impl bug during a test-coverage bundle, the fix goes in the same PR (single concern: "make this code observably correct"). Add to Phase 4 EXECUTE: *"Behavioral test that fails on a real bug → the fix lands in the same bundle. The PR title combines verbs (`test(X): add coverage; fix Y`). The fix must be (a) ≤10 lines, (b) mirror an existing-working pattern in a sibling package OR pass a code-reviewer agent for correctness, (c) covered by the same test that surfaced it. If any of those fail, descope: file the bug as a separate issue and ship the bundle with the test marked `xfail` / `test.skip` referencing the new issue."*
2. **Phase 1 SCAN: cross-package consistency probe.** When the issue touches per-framework packages (react/svelte/vue/solid/...) doing similar work, briefly compare the impl shape across siblings. Divergent behavior in the "same" abstraction is a defect signal. Add to Phase 1: *"For per-framework / per-platform packages providing equivalent APIs, diff the source files. Same name + same signature + different behavior = latent defect. Surface in the plan, fix opportunistically per the test+fix combo rule."*

## Process inflation guard (HS-18/22/31 lesson)

- Was the verified-by inflated? **No.** Original audit said zero tests in three packages; current state confirms it. Three follow-up bundles each closed one third cleanly.
- **NEW inflation-shape category discovered.** The vue `StreamError` swallow was *latent* — the code looked correct on visual inspection (mirrored react's pattern roughly), and the impl is unreachable from typed exports (status remains "streaming" forever, but no compile-time error). A code review would have flagged it; the audit didn't because the file is small and superficially correct. Document: **"silent state-machine stuck states" can hide behind correct-looking code that catches its own errors.** Add to the audit-finding template's tip list.
