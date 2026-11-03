# tools/repo

Internal dev CLI: `bun run repo help`. All policy lives in JSON manifests next to this file; the TypeScript is generic.
Every manifest has `schemaVersion: 1`; entries carry `owner` and `reviewBy` (warn when past, fail 30 days later).

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
