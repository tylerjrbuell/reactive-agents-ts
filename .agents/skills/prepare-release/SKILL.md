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
  `CHANGELOG.md` under `## <version>` and deletes them at release time.
- **Do NOT hand-edit `CHANGELOG.md`.** It is generated. Curate the wording in
  the changeset `.md` body instead.
- **No `docs/releases/`.** That directory was eliminated. The GitHub Release
  (auto-created from the CHANGELOG section) is the announcement.
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

## Step 7: Tag and push — this triggers the release

```bash
git tag v<version>
git push origin v<version>          # e.g. git push origin v0.11.0
```
`publish.yml` then: install → build → test → clean-install smoke →
`release:dry` gate → `release.ts <version>` (aggregate CHANGELOG, consume
changesets, stamp all packages + root, build, publish in dependency order,
fail-fast) → create GitHub Release from the `## <version>` CHANGELOG section.

Manual fallback / resume: GitHub → Actions → "Publish to npm" →
`workflow_dispatch`, enter the version. Re-running is safe — already-published
packages are skipped (idempotent), so a partial failure resumes cleanly after
you fix the cause.

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
- [ ] Tag pushed; "Publish to npm" workflow green (Step 7)
- [ ] GitHub Release present with notes
- [ ] `.agents/MEMORY.md` + Claude memory updated (Step 8)

## Common mistakes

| Mistake | Reality |
|---|---|
| Hand-editing `CHANGELOG.md` | `release.ts` generates it; manual edits collide. Edit the changeset `.md` instead. |
| Creating `docs/releases/vX.Y.Z.md` | `docs/` was eliminated — that's an orphan file. The GitHub Release is the announcement. |
| Waiting for a "Version Packages" PR | changesets/action was removed. Pushing the tag is the whole trigger. |
| `git tag` without `git push origin <tag>` | The tag push is what fires CI. A local tag releases nothing. |
| Looking for `check:versions` / drift scripts | Deleted — drift is structurally impossible in lockstep. |
| Running `release.ts` with no version arg | It requires an explicit semver and exits otherwise. |
