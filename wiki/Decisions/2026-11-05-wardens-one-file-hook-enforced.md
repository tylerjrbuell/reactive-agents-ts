---
type: decision
status: accepted
created: 2026-11-05
tags: [dev-workflow, multi-agent, wardens, governance, tooling]
related:
  - "[[2026-09-03-warden-pilot-ratified]]"
  - "[[2026-11-05-wardens-pack-design]]"
  - "[[2026-05-23-team-ownership-dev-contract-pilot]]"
---

# Wardens: hook-enforced authority, defined in one file

**Decision:** Warden authority stops being prose and becomes configuration that is enforced. The warden system is packaged as the open-source [`wardens`](https://github.com/tylerjrbuell/wardens) Claude Code plugin. This repo enables it in `.claude/settings.json` and defines the whole team in **one committed file, `.claude/wardens.yaml`**. Domain wardens' owned paths still come from `tools/repo/ownership.json`.

## Why

- **Nothing enforced authority.** Every warden had `Edit` and unrestricted `Bash`. Its "hard limits" were Markdown. The plugin's hooks now check each dispatch's MissionBrief, every tool call a warden makes, and its final UpwardReport.
- **The lift evaluation never ran** ([[2026-09-03-warden-pilot-ratified]] says so). The hooks write an outcome ledger as a side effect, so the data that evaluation needed now accumulates without anyone having to remember to collect it.
- **One file instead of eleven.** The first cut put authority in each agent's frontmatter plus `.wardens/config.json`. Overlaps were hard to see, and "what do we commit?" had a three-file answer. `wardens.yaml` puts the whole team in one diff. Agent files hold only prompts, and `.wardens/` holds only the gitignored ledger.

## What it changes

| Before | After |
|---|---|
| Authority in prose in each agent file | `kind` + `run` in `.claude/wardens.yaml`, `owns` via `tools/repo/ownership.json`, both enforced by hooks |
| Contract checked by eye, or by `bun run repo warden-report` after the fact | Briefs checked at dispatch; reports checked at stop (one send-back); same v2 rules in `warden-report` |
| `git stash` banned by convention only | `git stash/clean/reset --hard/checkout --/restore`, commit/push/tag/rebase and publish are built-in `never-run` for every warden |
| Primer anchors rotted silently (5 dead found) | `check-wardens` runs `warden doctor --strict` in CI |

## Mode: `warn`, then `enforce`

The plugin starts in `mode: warn`: it records would-be denials, rejected briefs and malformed reports, and blocks nothing. After about a week, read `warden team` / `warden stats`, resize `run`/`ownership.json` where legitimate work was flagged, then set `mode: enforce`. That switch is the owner's call (Tyler).

## Honest limits

- The hooks have not yet run in a live session here. Their payload fields come from the Claude Code hooks documentation. The first `warn`-mode session is the real test.
- The guard is a guardrail, not a sandbox: an allowed command prefix can still do anything that command can do.
- `check-wardens` skips with a warning while the `wardens` repo is private, because CI can't fetch the pinned CLI.

## Open decisions (owner: Tyler)

1. When to switch `mode` to `enforce`.
2. memory-warden, compose-warden, debrief-scribe had **0 missions** in 166 logged tasks: keep them, or retire them until the ledger shows demand.
3. Keep the hand-written pilot log alongside the ledger, or retire it. The log is committed and team-visible; the ledger is per-machine.
4. Make the `wardens` repo public, which enables CI enforcement and lets others install the plugin.
