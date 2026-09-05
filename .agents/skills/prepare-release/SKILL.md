---
name: prepare-release
description: Use when cutting, tagging, or publishing a new Reactive Agents version, or when a release/publish run fails and needs resuming. Covers the tag-driven lockstep flow (scripts/release.ts + .github/workflows/publish.yml).
argument-hint: [vX.Y.Z]
---

# Prepare Release: $ARGUMENTS

## Mental model — read this first

Release is **tag-driven lockstep**. One version number stamps **all** public
packages. The release mechanism is `scripts/release.ts`, run by
`.github/workflows/publish.yml` when you push a `vX.Y.Z` tag.

- **Changesets are notes, not the driver.** `bun run changeset` only writes
  `.changeset/*.md` prose. `release.ts` aggregates those into root
  `CHANGELOG.md` under `## [<version>] — <date>` and deletes them at release
  time.
- **Do NOT hand-edit `CHANGELOG.md`.** It is generated. Curate the wording in
  the changeset `.md` body instead.
- **No `docs/releases/`.** That directory was eliminated. The GitHub Release
  (auto-created from the CHANGELOG section) is the announcement.
- **`publish.yml` is the sole GitHub Release author.** release-drafter was
  removed — there is no parallel PR-label draft. The published release body =
  the `## [<version>] — <date>` CHANGELOG section, verbatim.
- **No changesets/action, no "Version Packages" PR.** That flow was removed.
  Pushing the tag is the entire trigger.
- **Drift is impossible by construction** — there is nothing to reconcile and
  no `check:versions` / `check-npm-versions` step anymore. Don't look for them.

## Step 0: Gather release context (wiki orient)

```
claude-obsidian:wiki-query "completed plans since <last-release-date>"
claude-obsidian:wiki-query "debriefs <package-or-feature-area>"
```
High-volume cycle (>20 plans/debriefs): `claude-obsidian:wiki-fold wiki/Research/Debriefs` first, then draft from the fold.

Sources: `wiki/Planning/Planning-Index.md`, `wiki/Research/Debriefs/`, `wiki/Decisions/Decision Index.md`, `wiki/Failure-Modes/`, `wiki/Issues/Running Issues Log.md`.

## Step 1: Pre-flight gate — all must pass

```bash
bun run build       # all packages, 0 errors
bun test            # 0 failures
bun run typecheck   # 0 errors
```
**Hard stop on any failure.** Fix before continuing.

## Step 2: Identify changes since last release

```bash
git describe --tags --abbrev=0                                   # last tag
git log $(git describe --tags --abbrev=0)..HEAD --oneline        # commits
git diff $(git describe --tags --abbrev=0)..HEAD --name-only | grep '^packages/' | cut -d/ -f2 | sort -u
```

## Step 3: Audit documentation

Run the `update-docs` skill against changes since last release. Verify AGENTS.md / README.md test-count and package-count claims still match reality. Verify changed public APIs (`git diff <lasttag>..HEAD -- packages/*/src/index.ts | grep '^+export'`) are documented. Fix stale docs before proceeding.

## Step 4: Author the change notes (changeset)

```bash
bun run changeset
```
Choose the bump for the **note's** semver intent:

| Change type | Bump |
|---|---|
| Bug fix, internal refactor, perf | `patch` |
| New feature / package / builder method | `minor` |
| Breaking API change, removed export | `major` |

The changeset `.md` **body becomes the public changelog text verbatim** (its
frontmatter is stripped). Write it as the user-facing note: what changed, which
package, migration if breaking. This is the only place you curate prose.

> Lockstep note: every public package ships at the same tag version regardless
> of per-changeset bump. The bump type informs the note; it does not produce
> independent package versions.

## Step 5: Decide the version number

You choose the explicit version — it is the git tag, the single source of
truth. There is no tool that computes it for you (by design).

## Step 6: Dry-run gate (no mutation, no npm)

```bash
bun run release:dry <version>          # e.g. bun run release:dry 0.11.0
```
Confirms package discovery (expect ~35 public), topological publish order,
already-published classification, and changeset note count. Mutates nothing.

Optional full local confirm (stamps + builds, stops before npm):

```bash
bun scripts/release.ts <version> --no-publish
git restore .            # revert stamped versions + CHANGELOG + consumed changesets
```

## Step 7: Push `main`, then tag and push — this triggers the release

**Push `main` first, always — even if this repo's convention is normally
"push at release/tag time."** `publish.yml`'s post-publish sync step resets to
`origin/main` and reapplies only VERSION/CHANGELOG/package.json on top of it
(`git checkout -f -B main origin/main`, not the tag's own ancestry). If
`origin/main` is behind the tagged commit when the tag is pushed, that reset
discards every local commit made since the last push, and the sync commit
lands on stale history — a divergent-history mess to reconcile by hand
(2026-09-05 incident, v0.16.0). Confirm before tagging:

```bash
git push origin main
git merge-base --is-ancestor origin/main HEAD && echo "OK: origin/main is caught up"
```

```bash
git tag v<version>
git push origin v<version>          # e.g. git push origin v0.11.0
```
`publish.yml` then: install → build → test → clean-install smoke →
`release:dry` gate → `release.ts <version>` (aggregate CHANGELOG, consume
changesets, stamp all packages + root, build, publish in dependency order,
fail-fast) → create GitHub Release from the `## [<version>] — <date>`
CHANGELOG section.

Manual fallback / resume: GitHub → Actions → "Publish to npm" →
`workflow_dispatch`, enter the version. Re-running is safe — already-published
packages are skipped (idempotent), so a partial failure resumes cleanly after
you fix the cause.

If npm published but the GitHub Release is missing (GH-release step flaked
after publish): GitHub → Actions → "Backfill GitHub Releases" →
`workflow_dispatch`. It recreates releases for every tag from its CHANGELOG
section. Idempotent (skips/updates existing).

## Step 8: Post-release — update memory

```markdown
## Current Status (<Month> <Day>, <Year>)
- **v<version> released** — <one-line summary>
```
Update `.agents/MEMORY.md` AND Claude project memory under
`~/.claude/projects/*/memory/` (keep both in sync — other agents read
`.agents/MEMORY.md`).

## Final checklist

- [ ] Build / test / typecheck green (Step 1)
- [ ] Docs audited, AGENTS.md & README counts current (Step 3)
- [ ] Changeset authored with user-facing prose (Step 4)
- [ ] `release:dry <version>` clean (Step 6)
- [ ] `main` pushed and `origin/main` confirmed caught up (Step 7, before tagging)
- [ ] Tag pushed; "Publish to npm" workflow green (Step 7)
- [ ] GitHub Release present with notes
- [ ] `.agents/MEMORY.md` + Claude memory updated (Step 8)

## Common mistakes

| Mistake | Reality |
|---|---|
| Hand-editing `CHANGELOG.md` | `release.ts` generates it; manual edits collide. Edit the changeset `.md` instead. |
| Creating `docs/releases/vX.Y.Z.md` | `docs/` was eliminated — that's an orphan file. The GitHub Release is the announcement. |
| Tagging before pushing `main` | The post-publish sync resets to `origin/main`, discarding any local commits main doesn't have yet. Push `main` first — see Step 7. |
| Waiting for a "Version Packages" PR | changesets/action was removed. Pushing the tag is the whole trigger. |
| Looking for a release-drafter draft | release-drafter was removed. `publish.yml` is the sole GitHub Release author. |
| `git tag` without `git push origin <tag>` | The tag push is what fires CI. A local tag releases nothing. |
| Looking for `check:versions` / drift scripts | Deleted — drift is structurally impossible in lockstep. |
| Running `release.ts` with no version arg | It requires an explicit semver and exits otherwise. |
