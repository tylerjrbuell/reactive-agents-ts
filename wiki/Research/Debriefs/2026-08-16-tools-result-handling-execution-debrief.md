# Execution Retro: tools-result-handling
Date: 2026-08-16
Budget: 120 min | Actual: ~110 min

## Outcomes
- Issues closed: #47, #57, #58
- Issues descoped: none
- Net test delta: +12 (8890 → 8902 pass, 0 fail, both before/after)
- Net LOC delta: +550 / -23 across 12 files (2 commits: `4174138d`, `22547736`)

## What worked
- Re-verifying stale issues against current code (none had `verified-by:`
  evidence — all three predated the `packages/reactive-agents/src/tools/` →
  `packages/tools`/`packages/reasoning` restructuring) caught that #57's
  literal ask (ajv/raw JSON Schema) no longer applies at all, and re-scoped
  it to the current architecture's equivalent (Effect `Schema.decode`) —
  which turned out to be a real, still-open gap (`register()` had zero
  runtime validation), just not the one originally described.
- The "adjacent-improvement detection at baseline" rule caught a real
  pre-existing bug my own change surfaced: `tool-approval-gate.test.ts`'s
  fixtures were missing the required `source` field, invisible because
  `packages/tools/tsconfig.json` excludes `tests/**` from typecheck. 2-line
  fix, same package, same PR — exactly the rule's intended shape.
- Caught a real regression from my own Unit 1 fix via full-suite verification
  before committing: the `#58` fix's `undefined`-detection fired even when a
  tool had already explicitly reported `success: false` with no `result`
  payload (a normal failure shape), flipping content from an accidentally-
  falsy legacy value to a non-empty error string that broke plan-execute's
  grounded-terminal-gate redirect logic. Root-caused via bisected `git stash`
  of just the one file, not by guessing.

## What didn't
- The scratchpad-spill module (#47) needed a mid-implementation relocation:
  written first in `packages/reasoning/src/kernel/state/`, then moved to
  `packages/tools/src/` once `recall.ts` (a lower-layer package `reasoning`
  depends on, not vice versa) turned out to need the same marker-resolution
  logic. Should have grepped for every scratchpad *reader*, not just the two
  I already knew about, before picking the module's home package.
- `git checkout -B bundle/<name> origin/main` (the skill's literal branch
  command) silently dropped 3 already-committed local-main-only commits
  (docs sync, changeset conversion, roadmap reconciliation) from the new
  branch's base on first attempt — this repo holds work on local `main`
  unpushed until tag time, which the skill's default assumes doesn't happen.
  Caught immediately (diff against the just-verified state), but cost a
  branch recreation.
- Phase 6a (open PR) as written doesn't fit this repo: a PR against
  `origin/main` right now would carry 357+ unrelated commits as part of the
  diff. Deviated to a direct local-main merge instead, consistent with how
  the session's earlier `bundle/providers-dynamic-config` branch was closed.

## Skill improvements (apply on next pass)
- **Phase 3.5 BRANCH**: for repos where local `main` is known to run ahead
  of `origin/main` (this project's own convention — see
  `feedback_commit_before_branch` / release-flow memory), branch from local
  `main`, not `origin/main`. Add a one-line check before branching: `git log
  --oneline origin/main..main | wc -l` — if non-zero, branch from `main`
  and note why in the plan doc, rather than defaulting to `origin/main`
  unconditionally.
- **Phase 6a UPDATE**: add an explicit branch — "if this repo's convention
  is hold-until-tag (local main ahead of origin), merge to local main
  directly instead of opening a PR against origin/main; the PR flow assumes
  origin/main is the live integration target, which doesn't hold here."
- **SCAN Phase 1**: when a candidate issue's body references file paths that
  no longer exist in the repo (confirmed here for all 3: `packages/
  reactive-agents/src/tools/`), that's a stronger staleness signal than the
  existing "no verified-by block" rule alone — worth calling out explicitly
  as its own check, since it changes HOW you re-verify (grep the OLD path
  finds nothing; you have to re-derive the issue's intent from its body
  prose and find the equivalent current location) rather than just whether
  you re-verify at all.

## Process inflation guard (HS-18/22/31 lesson)
No inflation found. All three issues' final acceptance criteria were
re-scoped narrower/differently than their original bodies (see "What
worked" above), and that re-scoping is documented in the plan doc and the
issue-close comments rather than silently claiming the literal original ask
was satisfied.
