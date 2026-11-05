---
name: mission-brief
description: Compose the MissionBrief YAML block that must open every dispatch to a warden (any subagent whose definition has a `warden:` frontmatter block). Use BEFORE calling the Agent tool on a warden, and when re-dispatching after a failed UpwardReport. The wardens dispatch hook rejects briefs that are missing fields, vague, over the retry budget, or that widen the warden's authority.
---

# MissionBrief — intent in

> **Vendored** from [tylerjrbuell/wardens](https://github.com/tylerjrbuell/wardens) `skills/mission-brief/SKILL.md` (contract v2) so non-Claude agents see the same contract. With the `wardens` plugin enabled (`.claude/settings.json`), its hooks check briefs at dispatch. Edit upstream first, then re-sync. History: [[2026-09-03-warden-pilot-ratified]].

Commander's intent for one bounded mission: what done looks like, why it matters, and the box the warden works inside. The brief is the only context the warden gets, so it carries the *why* as well as the *what*.

## In this repo

- Fill the owner, `authority-bounds.paths` and the gates from `bun run repo scope <files>`. Ownership comes from `tools/repo/ownership.json`.
- List `bun run repo test <paths>` / `bun run repo verify <pkg-dir>` as the verification commands.

## Format

Put this block at the very top of the Agent `prompt` (a fenced ```yaml block is fine). Values are plain strings or `-` lists of strings.

```yaml
mission-brief:
  task: <short-slug>                      # ledger key; used by `warden stats`
  end-state: <one sentence, observable>    # what is true when the mission is done
  why: <one sentence>                      # the constraint or motivation; lets the warden make judgment calls
  key-tasks:                               # ≤ 5, ordered; more than 5 = split the mission
    - <step>
  authority-bounds:
    paths:                                 # edit scope for THIS mission; must sit inside the warden's authority
      - <glob>
    commands:                              # the verification commands you expect it to run
      - <command>
    out-of-scope:                          # explicit refusals: say what NOT to touch
      - <thing>
  success-criteria:                        # deterministic gates you will re-run yourself
    - <command → expected result | file:line landmark | LOC ceiling>
  attempt: 1                               # increment on every re-dispatch of the same mission
  retries-allowed: 2
  prior-blockers:                          # on attempt > 1: the blockers from the last UpwardReport, verbatim
    - <blocker>
  approved-actions:                        # actions the user approved after a needs-approval report
    - <action>
```

## Rules the hook enforces (dispatch is denied in `enforce` mode, recorded in `warn` mode)

1. `end-state`, `why`, `success-criteria`, `authority-bounds.paths` are present and are not `TBD`/`TODO`/`???`.
2. Every `authority-bounds.paths` glob sits inside the warden's authority. **A brief can narrow authority, never widen it.** If the work needs paths the warden doesn't own, run `bun run repo scope <path>` and dispatch the owner, or split the mission.
3. `key-tasks` has ≤ 5 items.
4. `attempt ≤ 1 + retries-allowed`. When the budget is spent you escalate to the user. You don't re-dispatch.

## Writing a good brief

- **End-state is observable.** "`loop-detector.ts` resets the streak only on ACTION steps; `bun run repo test …/reflect/` green." It is not "improve the loop detector."
- **Why is the real reason**, including the incident or constraint, so the warden can reject a plausible-but-wrong approach.
- **Success criteria are things you can re-run.** If you can't verify it deterministically, it isn't a criterion.
- **Out-of-scope names the tempting adjacent fix.** That's where wardens drift.
- On a retry, change something. Copy `prior-blockers` and adjust `key-tasks`. An identical re-dispatch is a silent retry.

## Example

```yaml
mission-brief:
  task: loop-detector-streak-reset
  end-state: "loop-detector.ts streak counter resets only on ACTION steps; reflect tests green."
  why: "IC-1 (Apr 12) regression — observations were resetting the streak, masking infinite loops."
  key-tasks:
    - Locate streak-reset call sites in loop-detector.ts
    - Write a failing test asserting the streak persists across an observation
    - Implement the guard
    - Run the reflect tests, then verify the reasoning package
  authority-bounds:
    paths:
      - packages/reasoning/src/kernel/capabilities/reflect/**
    commands:
      - bun run repo test packages/reasoning/src/kernel/capabilities/reflect/
      - bun run repo verify packages/reasoning
    out-of-scope:
      - Changes to act.ts or terminate.ts
  success-criteria:
    - "New test fails before the change and passes after"
    - "bun run repo verify packages/reasoning → green"
  attempt: 1
  retries-allowed: 2
```
