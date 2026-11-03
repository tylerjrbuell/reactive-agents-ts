# tools/repo

Internal dev CLI: `bun run repo help`. All policy lives in JSON manifests next to this file; the TypeScript is generic.
Every manifest has `schemaVersion: 1`; entries carry `owner` and `reviewBy` (warn when past, fail 30 days later).

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

## Add a check (`checks.json`)
Add an entry (`id`, `script`, `scope`, `stages`, `owner`, `reviewBy`). `script` is `scripts/check-*.sh` or
`builtin:<name>` (implement in `src/lib/builtins.ts`). Every `scripts/check-*.sh` needs exactly one entry.

## Add an ownership row (`ownership.json`)
One row per `packages/*` and `apps/*` directory; `ownership-coverage` names the missing one in its `next:` line.

## Add a catalog entry (`catalog.json`)
Every script in catalog scope needs `id`, `path`, `kind`, `summary`, `invoke`. `catalog-coverage` names the gap.

## Before creating a file
`bun run repo place <path>...` says `ok` or the broken rule plus the canonical location; `bun run repo place --kind plan` answers "where do plans go?" (kinds: plan spec decision debrief experiment failure-mode test script skill).
The `Write` hook (`hook pre-write`) denies a NEW file that breaks a rule in `placement.json`; existing files, git-ignored and out-of-repo paths pass. Override: `REPO_ALLOW=<ruleId> REPO_ALLOW_REASON="<why>"`.
Add a rule: append to `placement.json` `rules` (`scope`/`exempt`/`allow`/`deny` globs, `naming` basename regex, `canonical`, >=2 `ok` + >=2 `bad` examples); first matching rule wins.
`grandfathered` lists known violations (`path`, `reason`, `reviewBy`); it may only shrink. The `placement` check fails on a new violation or a stale entry, with `next:`.
`scripts/` holds runnable scripts only (rule `scripts-only`): tests, data and docs live beside their owner.
