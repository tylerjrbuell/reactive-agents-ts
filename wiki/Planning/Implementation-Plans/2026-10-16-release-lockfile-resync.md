# Bundle: release-lockfile-resync
Date: 2026-10-16
Budget: 45 min
Issues: #235 (singleton; release.ts lockfile resync)

## Acceptance criteria
- #235: `scripts/release.ts` resyncs `bun.lock` after stamping versions so `bun install --frozen-lockfile` CI passes on post-release commits. `bun run build` green, `bun scripts/release.ts --dry-run 0.17.0` parses clean, `bun install --frozen-lockfile` exit 0.

## GROUND (parent, pre-dispatch — VERIFIED 2026-10-16)
- Root cause CONFIRMED at file:line: `scripts/release.ts` stamps package.json + root + VERSION but never runs `bun install`, so `bun.lock` keeps stale `workspace:*` ranges while package.json carries exact stamped versions.
- `bun.lock` has 97 `workspace:` entries → stamp to exact semver creates package.json/lock mismatch.
- CI runs `bun install --frozen-lockfile` in `publish.yml:95`, `ci.yml`, `docs.yml`, `eval.yml`, `regression-gate.yml` → all fail post-release until ad-hoc resync.
- Fix option 1 preferred (per issue): `release.ts: stamp -> bun install -> stage bun.lock in same release commit`.
- `bun install` runs clean and fast (~3.6s, workspace deps resolve offline).
- release-warden.md authority manifest line 29: hard-refuses edits to `scripts/release.ts` → fix lands on main thread; warden only audits. Contract-compliant.

## Execution units (ordered)
1. **Unit 1 (parent, TDD):** RED — non-destructive drift demo: mismatch one package.json version vs bun.lock, run `bun install --frozen-lockfile`, confirm exit != 0 (proves failure mode is real + load-bearing), restore. GREEN — add `bun install` + `git add bun.lock` after the stamp block in scripts/release.ts. REVIEW + COMMIT.
2. **Unit 2 (parent verifier):** `bun install --frozen-lockfile` exit 0; `bun run build` 38/38; `bun scripts/release.ts --dry-run 0.17.0` parses; `bunx turbo run typecheck` green; record vs baseline.

## Risk register
- `bun install` needs network in CI → mitigation: workspace deps are `workspace:*`/local, bun install resolved offline in probe; add `nothrow()` + fail() so a failed install aborts before publish (fail-fast, matches release.ts design).
- `git add bun.lock` couples script to git → mitigation: release.ts already mutates files for the release commit; staging the lock it just regenerated is the script's responsibility per issue option 1.
- Destructive RED (running release.ts consumes changesets) → mitigation: RED via single-package.json mismatch demo only, never run release.ts mutating.

## Verification protocol
- `git diff bun.lock` → empty (tree clean of unrelated lock drift)
- `bun install --frozen-lockfile` → exit 0
- `bun run build` → 38/38
- `bun scripts/release.ts --dry-run 0.17.0` → exits 0, prints plan
- `bunx turbo run typecheck` → green
- Close #235 with file:line evidence + test counts

## Out-of-scope (explicit)
- Adding a duplicate `bun install --frozen-lockfile` step to publish.yml (option 2; issue presents as alternative, option 1 chosen)
- Cutting an actual tag / npm publish
- #248 / #240 / #206 (need design passes, carried separately)

## Baseline
- dev HEAD `6f2e57fe6` (#234 cherry-picked onto origin/dev). Working on `dev`.
- Baseline: `bun run build` 38/38; `bun install --frozen-lockfile` exit 0 (current tree consistent).
