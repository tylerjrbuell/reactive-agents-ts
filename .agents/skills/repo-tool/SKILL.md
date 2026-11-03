---
name: repo-tool
description: Use at the start of any repo work and whenever a hook denies a command. The `bun run repo` dev CLI replaces ad-hoc grep, piped tests and script hunting; this is its decision flow, override syntax and how to extend its manifests.
---

# repo-tool

`bun run repo help --all` lists every command and catalogued script. Policy lives in `tools/repo/*.json`; read `tools/repo/README.md` only to change it.

## Flow

1. `bun run repo status` - branch, active plans, debt, authority-doc pointers.
2. `bun run repo scope <files>` - owner/warden, checks and docs the change touches (no files = your diff).
3. `bun run repo find "<q>" [--wiki|--code|--scripts]` - locate; then `bun run repo outline <file>` and Read a range.
4. `bun run repo place <path>` before creating a file (`place --kind plan` = where a kind goes).
5. Edit with Edit/Write. No `sed -i`, no scripted replace.
6. `bun run repo test <paths>` - scoped tests, summary printed, full log saved. Never pipe `bun test`.
7. `bun run repo verify <pkg-dir>` - tests + typecheck + narrow gates for one package.
8. `bun run repo check --all` before commit/handoff (`--only <id>` for one gate).

## Which CLI

| CLI | Use for |
|---|---|
| `bun run repo` | Navigating, scoping, testing and gating this repo's source. |
| `bun run rax` | The product CLI (running agents, `rax ps`, `rax attach`). |
| `rax-diagnose` | Root cause of a recorded run: `rax-diagnose cause <runId\|path>`. |

## A hook denied me

Take the printed alternative; do not retry the same command. A genuine exception:
`REPO_ALLOW=<ruleId> REPO_ALLOW_REASON="<why>" <command>` (logged to `.repo-logs/overrides.jsonl`).
A hook itself is in your way (broken or wrong): `REPO_HOOKS=off` disables both hooks for the session (logged); then report the rule.
Blocked new file: move it to the printed canonical location, or `bun run repo place --allow <path> --reason "<why>"` (60 min, logged).

## Extend the tool (one manifest each, each has a `*-valid`/coverage check)

- Hook rule: `tools/repo/rules.json` (>=2 deny + >=2 allow examples). `check --only rules-valid`.
- Check: `tools/repo/checks.json` (`builtin:<name>` in `src/lib/builtins.ts` or `scripts/check-*.sh`).
- Ownership row: `tools/repo/ownership.json`, one per `packages/*` / `apps/*` dir. `check --only ownership-coverage`.
- Script catalog entry: `tools/repo/catalog.json`. `check --only catalog-coverage`.
- Placement rule: `tools/repo/placement.json` (>=2 ok + >=2 bad examples). `check --only placement`.
- Skill or warden text: `tools/repo/skills.json` (index gaps, shared warden paragraph). `check --only skills-valid`.
