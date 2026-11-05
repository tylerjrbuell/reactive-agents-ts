---
type: debrief
status: complete
created: 2026-11-04
tags: [d3, error-tagging, execute-backlog, retro]
---

# Debrief: diagnose/replay error tagging (#285)

**Result:** 12 sites tagged, ratchet 286 -> 274, `repo verify` diagnose + replay green (88 tests), merged to local `dev` (`72b333a28`).

## What went well
- D3 template (byte-identical message + `_tag` anchor + same-commit ratchet drop) applied mechanically; no behavior change.
- Reverting the incidental `bun-types` lockfile bump kept the diff to one line.

## What went wrong
- Merge blocked by a peer session's staged rename in the shared index; a merge commit would have absorbed it. Waited for a clean index rather than merging around it.
- Worktree needed `--force` removal due to an untracked `.claude/skills/repo-tool` symlink artifact.

## Skill amendments
- execute-backlog MERGE step: check `git status --short` in the main checkout is empty before `git merge --no-ff`; if not, hold the branch (or PR) instead of merging.
- Worktrees: expect an untracked `.claude/skills/*` symlink; `worktree remove --force` is safe when it is the only entry.
- The `skills-valid` check fails in fresh worktrees (no `.repo-logs/overrides.jsonl`); environmental.
