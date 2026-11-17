---
type: decision
status: proposed
created: 2026-11-17
tags: [decision, wardens, dev-tooling, friction, ownership]
---

# Dev efficiency pass and two new wardens (2026-11-17)

Measured from 562 session transcripts (23 sessions plus their subagents, 2026-11-10 to 2026-11-17), `.repo-logs/denies.jsonl` and `git log`. Supersedes the "park" rows for `tools/repo` and the dx surfaces in [[2026-11-11-warden-ownership-gaps]].

## Findings

| Friction | Count (6 sessions) | Root cause |
|---|---|---|
| Hook denies, all rules | 707 | 97% in subagents; 74% of warden spawns hit ≥1 on first contact, then comply |
| `no-scripted-edit` | 351 | Rule text sat at the end of each primer; the harness tells agents shell edits are fine |
| `no-piped-test` | 263 | `repo test` printed failing names only, so agents piped to see why |
| `no-shell-grep-repo` | 93 | Primers pointed at a `Grep` tool this Claude Code build lacks |
| `sleep` polling blocked | 75 | `repo verify` on runtime (~75 s tests) exceeds Bash's 120 s default, so agents backgrounded it |
| Shared Playwright profile in use | 36 | One browser profile for all concurrent sessions |
| `Edit` missing in ablation-warden | 32 | Not in its `tools:` list |
| `no-cd-prefix` warnings | 2,410 | Warn mode; no behavior change observed |
| Unowned main-thread commits | ~180 | `tools/repo`, `scripts`, `.githooks`, `.github` since 2026-11-01 |
| `apps/cli` main-thread commits | 9 | Parked dx trigger (3 in 30 days) met |

## Shipped (dev, 2026-11-17)

- `795e8690c`: `repo test` prints error, expected/received or diff, and location for the first 5 failures and takes `-t`. The pre-bash hook rewrites plain piped `bun test` calls to `bun run repo test` (PreToolUse `updatedInput`) instead of denying; 159 of 181 recorded denies fit.
- `82005e1b7`: the repo rules open every warden primer with concrete substitutions; `bun run repo check --only skills-valid --fix` syncs them; ablation-warden gains `Edit`; `PLAYWRIGHT_MCP_ISOLATED=true` per session.

## Proposed: two new wardens (drafted, live in warn mode)

Drafted on the owner's request. Primers, `wardens.yaml` entries and `ownership.json` rows are in place, so `repo scope` routes to them now; ratifying keeps them, rejecting reverts those three files.

### tooling-warden
- **Owns:** `tools/repo/**`, `scripts/**`, `.githooks/**`, `.github/**`, `.agents/skills/repo-tool/SKILL.md`.
- **Job:** the friction loop: session-stats, group denied commands by intent, fix the tool or rule at the boundary, replay recorded commands to measure coverage.
- **Guard rails:** may not weaken oversight (relax or delete a deny rule, add allow-paths, raise ceilings, move gates off a stage) or edit authority files (`ownership.json`, `wardens.yaml`, `.claude/agents/**`, `settings.json`) without `needs-approval`. Release scripts change only with release-warden as reviewer.
- **Why not widen harness-warden:** harness-warden measures the framework on real models; this is the repo's own developer tooling. Mixing them recreates the overload that produced eval-warden.

### dx-warden
- **Owns:** `apps/cli/**`, `packages/create-reactive-agent/{src,tests,package.json}`, `apps/examples/**`, `apps/stackblitz/**`.
- **Job:** the first ten minutes: keyless scaffold that typechecks and runs, examples on the current builder API, quiet and private CLI defaults, truthful `--help`. Launch-critical for Show HN / Reddit.
- **Ownership move:** `apps/cli/src/commands/deploy/**` and `tests/deploy.test.ts` move from gateway-warden to dx-warden (the wardens doctor treats nested globs as overlapping, so the CLI cannot be split by directory). gateway-warden keeps the deploy *design* workstream and reviews deploy code changes.

## Open decisions for the owner

1. **Ratify tooling-warden** (or fold into harness-warden).
2. **Ratify dx-warden**, including the deploy-code move from gateway-warden.
3. **`no-cd-prefix`:** delete (recommended: 2,410 warnings, no effect) or promote to deny.
4. **Pre-commit budget:** `check-cortex-compliance` takes ~1.9 s against a 1 s budget and fails `friction.test.ts`; make it faster or move it to stage `ci` (cortex session notified).
5. **Concurrency guard:** a machine-wide limit on simultaneous `repo test`/`verify` runs (two OOMs this week). First tooling-warden mission if approved.
6. **Cortex dev stack:** a `dev-stack` start/stop with pid files, replacing per-port `pkill` (21 auto-mode blocks for cortex-warden). cortex-warden mission.
7. **24 stale `git stash` entries** despite the ban: each session drops its own.
