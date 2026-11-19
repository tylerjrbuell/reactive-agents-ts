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
6. `bun run repo test <paths> [-t <name>]` - scoped tests; prints counts, failing names and each failure's error, expected/received and location; full log saved. Never pipe `bun test` (the hook rewrites a plain piped call to this command and denies the rest). A `N error` in the counts is an unhandled error outside any test (file load, between tests): the run fails and names it `unhandled error in <file>: <message>`. Full suite: `bun run repo test --all` (one run per `packages/<x>`, `apps/<x>`, `tools/<x>` and `scripts`, queued on the test slots, totals plus each failed chunk; Bash `timeout` 600000). Do not run `repo test packages` as one run: it exceeds the 600 s cap. Each run gets one temp root (`<tmp>/ra-tests-<pid>-*`, removed on exit) holding TMPDIR and HOME (a mirror of your home without `~/.reactive-agents`, so suites never write agent memory, runs or traces into the real one); `repo test`, `repo verify` and `repo ci` first run `bun run repo janitor` (reaps leaked test dirs of dead PIDs and a stale/oversized `node-compile-cache`; `--dry-run` to preview; it also lists, never deleting, each with its cleanup command: every linked git worktree idle > 24 h, test-fixture memory dirs in the real `~/.reactive-agents/memory`, `.turbo` > 2 GB, the bun install cache > 5 GB and big temp entries) and refuse to start when MemAvailable < 1 GB, swap > 97% full with MemAvailable < 3 GB, or a RAM-backed temp dir is > 80% full (`bash scripts/mem-watch.sh` shows top RSS). `repo test --all` and `repo ci` re-check before each chunk/step and start no more once the guard refuses. Before a build, probe or bench: `bun run repo guard && bun run build` (same checks, exit 1 on refuse). Opt in: `REPO_TEST_MEM_MAX=8G` runs tests in a memory-capped systemd scope; `REPO_TEST_TMPDIR=$HOME/.cache/ra-tmp` moves test temp to disk.
7. `bun run repo verify <pkg-dir>` - tests + typecheck + narrow gates for one package.
8. `bun run repo check --all` before commit/handoff (`--only <id>` for one gate).
9. `bun run repo ci` before push: runs `.github/workflows/ci.yml`'s own steps on a fresh `git clone --local` of HEAD (committed state only, no `.env`), with CI=true, no API keys, a temp HOME and TMPDIR, and Ollama unreachable. Prints one line per step, logs to `.repo-logs/ci-<time>/`, removes the clone. A full run takes many minutes: from an agent, run it as a background task, never with a foreground Bash call. A pass records the commit, so the `pre-push` hook does not re-run it. `--only <job>` runs one ci.yml job. `--fast` runs install, build, typecheck, `check --all` and changed-package tests; it is weaker than CI. `--run '<cmd>'` runs only install plus `<cmd>` in the CI-like clone, to reproduce one CI-only failure. `--dry-run` prints the plan. If ci.yml gains a step the mirror cannot map, `repo ci` fails until `tools/repo/src/lib/ci-plan.ts` learns it.

## Which CLI

| CLI | Use for |
|---|---|
| `bun run repo` | Navigating, scoping, testing and gating this repo's source. |
| `bun run rax` | The product CLI (running agents, `rax ps`, `rax attach`). |
| `rax-diagnose` | Root cause of a recorded run: `rax-diagnose cause <runId\|path>`. |

## A hook denied me

Take the printed alternative; do not retry the same command. A genuine exception:
`REPO_ALLOW=<ruleId> REPO_ALLOW_REASON="<why>" <command>` (logged to `.repo-logs/overrides.jsonl`).
A hook is in your way (broken or wrong): prefix one Bash command with `REPO_HOOKS=off`; for Write use `repo place --allow`; `REPO_HOOKS=off` in the launching shell disables all (logged). Then report the rule.
Blocked new file: move it to the printed canonical location, or `bun run repo place --allow <path> --reason "<why>"` (60 min, logged).

## Extend the tool (one manifest each, each has a `*-valid`/coverage check)

- Hook rule: `tools/repo/rules.json` (>=2 deny + >=2 allow examples). `check --only rules-valid`.
- Check: `tools/repo/checks.json` (`builtin:<name>` in `src/lib/builtins.ts` or `scripts/check-*.sh`).
- Ownership row: `tools/repo/ownership.json`, one per `packages/*` / `apps/*` dir. `check --only ownership-coverage`.
- Script catalog entry: `tools/repo/catalog.json`. `check --only catalog-coverage`.
- Placement rule: `tools/repo/placement.json` (>=2 ok + >=2 bad examples). `check --only placement`.
- Skill or warden text: `tools/repo/skills.json` (index gaps, shared warden paragraph). `check --only skills-valid`.
