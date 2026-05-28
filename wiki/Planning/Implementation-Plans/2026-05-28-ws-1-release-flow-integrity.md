---
title: WS-1 — Release-Flow Integrity
date: 2026-05-28
status: pending
master-plan: 2026-05-28-canonical-refactor.md
architecture-model: 2026-05-28-canonical-architecture-model.md
root-cause-closed: RC-5 (release stamping in ephemeral CI runner)
gh-issues-closed: [#159 (P0), #165]
authoritative-anchor: master-plan §3.4 RC-5 + §3.6 first-hand verification
owner-warden: release-warden
session-budget: 1 day (~4-6 hours active work + 1 release dry run)
risk: LOW (isolated, no kernel/runtime semantics touched, full rollback path)
---

# WS-1 — Release-Flow Integrity

## Goal (one sentence)

Move version stamping from CI ephemeral runner to local pre-tag step so workspace `packages/*/package.json` versions, root `VERSION`, npm published artifact, and git tags are structurally guaranteed to match.

## Anchor

Master plan §4 RC-5: "Release stamping happens in CI ephemeral runner, not in local pre-tag step. Mutations die with the runner." This violates the trust differentiator at the release surface: a `bun run release:dry 0.12.0` would today fail the drift gate AGAINST main even though npm shows 0.11.1 published.

## Current State (first-hand verified 2026-05-28)

```
root VERSION:                          0.11.1
npm @reactive-agents/core version:     0.11.1
packages/core/package.json:            0.10.6
packages/llm-provider/package.json:    0.10.6
packages/memory/package.json:          0.10.6
packages/reasoning/package.json:       0.10.6
packages/tools/package.json:           0.10.6
packages/runtime/package.json:         0.10.6
packages/reactive-agents/package.json: 0.10.6
packages/compose/package.json:         0.10.6
... (35 packages total — ALL at 0.10.6 except judge-server at 0.9.5)
git tags max:                          v0.9.0 (no v0.10.x, no v0.11.x)
```

The CI script at `release.ts:197-208` stamps inside the runner; the mutated files are not committed back to main. The drift compounds at every release.

## Scope IN

### Phase 1 — Restructure `release.ts` for local-stamp pattern

**Files touched:** `scripts/release.ts`

**Change:** Move the stamping logic OUT of the ephemeral path. Local invocation:

```bash
bun run release 0.12.0
```

MUST:
1. Read `0.12.0` from CLI arg
2. Stamp every `packages/*/package.json` `version` field to `0.12.0` (excluding `judge-server` if it stays on its own track — verify per policy)
3. Update root `VERSION` to `0.12.0`
4. Update workspace `package.json` references that pin versions
5. `bun install` to sync lockfile
6. `bun run build && bun run typecheck && bun test` to gate
7. `bun run release:dry 0.12.0` to confirm no drift remains
8. `git add` modified package.jsons + root VERSION + bun.lock
9. `git commit -m "chore(release): stamp 0.12.0"`
10. `git push origin main`
11. `git tag v0.12.0`
12. `git push origin v0.12.0`

After this, CI's `publish.yml` triggers on the tag and runs build + publish only — no mutations.

### Phase 2 — Simplify `publish.yml`

**Files touched:** `.github/workflows/publish.yml`

**Change:** Remove the "Sync VERSION to main" step (publish.yml:135-149) that commits only `VERSION` but not package.jsons. Replace with assertion: confirm tag commit's `packages/*/package.json` `version` field matches the tag (belt-and-suspenders).

### Phase 3 — Belt-and-suspenders gate in `test-clean-install.ts`

**Files touched:** `scripts/test-clean-install.ts` (per HS-H-04 audit recommendation)

**Change:** After clean install, assert published version matches the tag's expected version. Fails the workflow if any drift slips through.

### Phase 4 — Backfill workspace pkg.jsons + delete orphan draft

**Files touched:** All 35 `packages/*/package.json` files. GitHub release page (manual).

**Change:**
1. Stamp every workspace `packages/*/package.json` to `0.11.1` (current published) via the new `release.ts` flow
2. Commit + push the stamps (NO tag — this is backfill catching up reality to npm)
3. CHANGELOG backfill entries for v0.10.6 → v0.11.1 in their respective package CHANGELOG.md files (per `feedback_npm_version_drift`)
4. Delete orphan `v0.10.7` draft GH release (#165) via `gh release delete v0.10.7 --yes`

## Scope OUT (non-goals — flagged for refusal)

- Touching ANY package's source code (no behavior change)
- Changing the semantic of `release:dry` itself (only how it's invoked)
- Touching changesets (already removed May 2026)
- Touching CI for non-release workflows (PR CI stays as-is)
- Tagging a new version (this WS prepares the rails; an actual v0.12.0 release is downstream)

## Pre-Conditions

- `main` branch is current with `origin/main`
- Build green (`bunx turbo run build` 38/38)
- Tests green (`bun test` workspace pass)
- No uncommitted changes in tree
- `npm view @reactive-agents/core version` returns 0.11.1 (current truth)
- `node`, `bun`, `gh` CLI all available locally

## Tests (RED → GREEN)

### RED first

1. Manual repro: `bun run release:dry 0.12.0` against current main MUST fail with drift error
2. Snapshot the failure message — this is the RED state

### GREEN gates per phase

| Phase | Verification command | Expected pass |
|---|---|---|
| 1 | `bun run release 0.11.1 --dry` (no-op) | exits clean; no diff to commit |
| 1 | `bun run release 0.12.0-test --dry` (preview) | shows planned mutations; no actual writes |
| 2 | `cat .github/workflows/publish.yml \| grep -c "Sync VERSION to main"` | 0 |
| 2 | `cat .github/workflows/publish.yml \| grep -c "assert.*version.*tag"` | ≥1 |
| 3 | `bun run scripts/test-clean-install.ts --target 0.11.1` | exits 0 |
| 4 | `grep '"version": "0.11.1"' packages/*/package.json \| wc -l` | 35 (matches package count, allowing for judge-server policy) |
| 4 | `git tag --list v0.11.*` | (no tag — backfill is not a re-release) |
| 4 | `gh release list \| grep v0.10.7` | (empty) |

### Existing tests that MUST still pass

- All workspace `bun test` (3219+ tests at baseline)
- `bunx turbo run build` 38/38
- `bun run typecheck` clean

## Verification Protocol (commands + counts captured in PR body)

```bash
# Before
echo "Root VERSION: $(cat VERSION)"
echo "npm published: $(npm view @reactive-agents/core version)"
echo "pkg.json versions (unique):"
grep '"version"' packages/*/package.json | awk -F'"' '{print $4}' | sort -u
echo "Recent tags:"
git tag | grep -E '^v0\.(1[01]|9)\.' | tail -5

# Apply phases 1-3 changes (release.ts + publish.yml + test-clean-install.ts)
git checkout -b refactor/ws-1-release-flow-integrity
# ... edit release.ts, publish.yml, test-clean-install.ts ...

# Run dry preview
bun run release 0.12.0-preview --dry  # MUST exit clean

# Apply phase 4 backfill (NOT in this PR — separate commit)
bun run release 0.11.1  # this will stamp + commit + push (only the stamp commit, no tag)

# After
echo "pkg.json versions post-backfill:"
grep '"version"' packages/*/package.json | awk -F'"' '{print $4}' | sort -u  # MUST show only 0.11.1 (and judge-server's policy)

# Delete orphan draft
gh release delete v0.10.7 --yes
```

## Done Criteria (falsifiable)

- [ ] `grep '"version": "0.11.1"' packages/*/package.json | wc -l` == 35 (or 34 if judge-server has policy split)
- [ ] `git tag --list v0.9.* v0.10.* v0.11.*` shows v0.9.0 + v0.10.6 + v0.11.1 (matching npm published artifacts; tags catch up to reality)
- [ ] `bun run release:dry 0.12.0` exits clean (zero drift gate violations)
- [ ] `.github/workflows/publish.yml` has zero "Sync VERSION to main" mutations
- [ ] `gh release list` shows no orphan v0.10.7 draft
- [ ] All 3219+ tests pass
- [ ] Build 38/38 green
- [ ] PR body cites every grep + count above

## Rollback Plan

Single revert commit reverts release.ts + publish.yml + test-clean-install.ts changes. Workspace pkg.json backfill stays committed (it represents truth catching up to reality). Tag backfill stays. Net: rollback restores the old (broken) CI pattern but keeps reality-truth alignment on main.

If catastrophic (e.g. release.ts has a destructive bug): revert + immediately re-stamp pkg.jsons + push. Tagging is gated on local CLI.

## Evidence Artifact

`wiki/Research/Refactor-Reports/2026-05-28-ws-1-release-flow.md` containing:

- Before/after `grep + wc -l` snapshots
- The first successful `bun run release:dry 0.12.0` exit-clean output
- The first successful clean release dry-run end-to-end output
- Confirmation of #159 + #165 close

## Why This Workstream Is First

- Self-contained (no kernel/runtime semantics touched)
- P0 blocker for any future release
- Cheapest unblocker (≤1 day)
- Failure mode is bounded (single revert returns status quo)
- Subsequent WSes ship behavior changes — they need a working release flow to validate end-to-end

## Owner + Handoff

`release-warden` dispatch via Agent tool, with MissionBrief input. Warden produces UpwardReport on completion. Main thread reviews UpwardReport, runs the validation gates in `Verification Protocol`, merges PR.

## Cross-Reference

- Master plan: `wiki/Planning/Implementation-Plans/2026-05-28-canonical-refactor.md` §4 RC-5, §6.2 WS-1 summary
- Architecture model: §1 (layered dependency rule applies — release is L4 surface concern), §17 mapping
- Related closed issues: #159 P0, #165
- Memory cross-ref: `feedback_npm_version_drift`, `project_release_flow`
