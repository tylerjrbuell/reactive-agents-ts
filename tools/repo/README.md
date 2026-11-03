# tools/repo

Internal dev CLI: `bun run repo help`. All policy lives in JSON manifests next to this file; the TypeScript is generic.
Every manifest has `schemaVersion: 1`. Rows in `checks.json`, `rules.json`, `placement.json` (rules and `grandfathered`) carry `owner`/`reviewBy`: warn when past, `check --all` (CI) fails 30 days later; hooks and pre-commit only warn. `ownership`, `catalog`, `baseline` rows have no `reviewBy`.
`bun tools/repo/src/cli.ts <cmd>` skips bun's `$ …` echo and exit-code wrapper line that `bun run repo` adds. Exit codes: 0 ok, 1 check failed, 2 usage, 3 internal error (pre-commit fails open on 3).

## Orient and route
`bun run repo status` prints branch, active plans, open debt, and pointers to the authority doc's headings (never its text).
`bun run repo warden-report <file|-> [--retries N]` validates a warden's `upward-report:` block and prints `next:` per the Dispatcher FSM.
`bun run repo find "<query>" [--wiki|--code|--scripts]` is ranked, capped search over git's file universe (use it, not shell `grep -r`).
`bun run repo outline <file.md|.ts>` lists headings/exports with line numbers so you Read a range, not the whole file.
`bun run repo session-stats [--since <ISO>]` measures Claude transcripts against `baseline.json`; with `--since` and >=3 sessions it exits 1 if a habit threshold is missed.

## Add a hook rule (`rules.json`)
1. Append to `rules`: `id`, `match.command` (regex), `match.notInside` (`quotes`, `heredoc-to-file`), `reason`,
   `alternative` (`{name}` fills from a named regex group), `owner`, `reviewBy`.
2. Give it at least 2 `examples.deny` and 2 `examples.allow`. `rules-valid` checks each deny is denied by this rule
   and each allow is allowed by every rule.
3. `bun run repo check --only rules-valid`. A malformed file fails the check but the hook fails open (see
   `.repo-logs/hook-errors.jsonl`).
Override one call: `REPO_ALLOW=<id> REPO_ALLOW_REASON="<why>" <command>`; logged to `.repo-logs/overrides.jsonl`.

Escape hatch: prefix one Bash command with `REPO_HOOKS=off`; for Write use `repo place --allow`; `REPO_HOOKS=off` in the launching shell (before Claude Code starts) disables all. Logged to `.repo-logs/overrides.jsonl`.
Shipped as `warn`: hook rule `no-cd-prefix`; placement rules `no-stray-artifacts`, `root-allowlist`, `scripts-only`, `tests-beside-code`. Warn text drops the override hint (the call already proceeded). When several placement rules match a path, a `deny` beats an earlier `warn`.
Rules and placement rules take `"mode": "deny"` (default) or `"warn"` (allow + same text as advice); other values fail load. Promote warn to deny by editing the manifest once `session-stats` shows no false positives. Placement `warn` applies to the hook only: the CI `placement` check fails either way.
Every deny/warn is appended to `.repo-logs/denies.jsonl`; `session-stats` reports `hookDenies`, `repeatedDenies` (rule denied >=3x in one session) and `warns`, and `status` lists removal candidates (0 denies in 30d, log >=7 days old) and rules overridden >=3x.
Message budget (`rules-valid`, `placement`): rendered text <=4 lines and <=400 chars; hook rule `alternative` must name a backticked command or tool. Placement `nextHint` (optional, `{base}` = basename) feeds the single `next:` line of `repo place`.
Latency budgets are tests (`tests/friction.test.ts`): hooks <300 ms; scope/place/find <1.5 s; set `REPO_BUDGET_FACTOR=3` on slow CI to scale them.

## Add a check (`checks.json`)
`check --staged` selects by `git diff --cached` (what pre-commit uses); `--changed` is the working diff plus untracked. `as-unknown-as-*` entries have `stages: []`: they are enforced by `packages/runtime/test/as-unknown-as-ceiling.test.ts`, and `repo ratchet` measures them.
Add an entry (`id`, `script`, `scope`, `stages`, `owner`, `reviewBy`). `script` is `scripts/check-*.sh` or
`builtin:<name>` (implement in `src/lib/builtins.ts`). Every `scripts/check-*.sh` needs exactly one entry.

## Add an ownership row (`ownership.json`)
One row per `packages/*` and `apps/*` directory; `ownership-coverage` names the missing one in its `next:` line.

## Add a catalog entry (`catalog.json`)
Every script in catalog scope needs `id`, `path`, `kind`, `summary`, `invoke`. `catalog-coverage` names the gap.

## Before creating a file
`bun run repo place <path>...` says `ok` or the broken rule plus the canonical location; `bun run repo place --kind plan` answers "where do plans go?" (kinds: plan spec decision debrief experiment failure-mode test script skill).
The `Write` hook (`hook pre-write`) denies a NEW file that breaks a rule in `placement.json`; existing files, out-of-repo paths and `hookExempt` scratch dirs (`.superpowers/` etc.) pass. Override: `bun run repo place --allow <path> --reason "<why>"` (env vars cannot reach a Write call).
Add a rule: append to `placement.json` `rules` (`scope`/`exempt`/`allow`/`deny` globs, `naming` basename regex, `canonical`, >=2 `ok` + >=2 `bad` examples); every matching rule applies, and a `deny` beats a `warn`.
`grandfathered` lists known violations (`path`, `reason`, `reviewBy`); it may only shrink. The `placement` check fails on a new violation or a stale entry, with `next:`.
`scripts/` holds runnable scripts only (rule `scripts-only`): tests, data and docs live beside their owner.
