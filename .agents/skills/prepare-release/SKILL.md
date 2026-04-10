---
name: prepare-release
description: Prepare a Reactive Agents release. Validates build and tests, audits documentation, generates changeset, and writes a consistent changelog entry. Use when cutting a new release version.
argument-hint: [vX.Y.Z]
---

# Prepare Release: $ARGUMENTS

## Step 1: Pre-Flight Gate — All Must Pass

```bash
# 1. Full build
bun run build
# Expected: all packages build without errors

# 2. Full test suite with timeout
bun test --timeout 15000
# Expected: all tests pass, 0 failures

# 3. Type checking
bun run typecheck
# Expected: 0 errors
```

**Hard stop:** Do not proceed if any of these fail. Fix failures before continuing.

## Step 2: Identify Changes Since Last Release

```bash
# Find last release tag
git describe --tags --abbrev=0

# List all commits since last tag
git log $(git describe --tags --abbrev=0)..HEAD --oneline

# List all changed packages
git diff $(git describe --tags --abbrev=0)..HEAD --name-only | grep "^packages/" | cut -d/ -f2 | sort -u
```

## Step 3: Audit Documentation

Run the `update-docs` skill against all changes since last release. Verify:

```bash
# Current test count in docs matches reality
bun test --timeout 15000 2>&1 | grep "tests passed"
# Compare against what AGENTS.md and README.md say

# Current package count matches
ls packages/ | wc -l
# Compare against AGENTS.md package count
grep -n "packages" AGENTS.md | grep -i "22\|count\|total" | head -5

# API signatures in docs match current code
# (search for any changed public APIs and verify docs reference current signatures)
git diff $(git describe --tags --abbrev=0)..HEAD -- packages/*/src/index.ts | grep "^+export"
```

Fix any documentation that is stale before proceeding.

## Step 4: Create Changeset

```bash
bun run changeset
```

When prompted, choose the semver bump:

| Change type | Bump |
|------------|------|
| Bug fix, internal refactor, perf improvement | `patch` |
| New feature, new package, new builder method | `minor` |
| Breaking API change, removed export, behavioral change | `major` |

Select affected packages. Write a one-sentence summary of the change for the changeset.

## Step 5: Write the Changelog Entry

Add a new entry at the top of `CHANGELOG.md` using this mandatory template:

```markdown
## vX.Y.Z — YYYY-MM-DD

### Highlights

[1-3 sentences describing the theme and most important changes of this release.
What problem does this release primarily solve? What is the headline capability?]

### Breaking Changes

[List each breaking change with migration guidance. If none, write "None."]

- `MethodName` renamed to `NewMethodName` — update all callers
- `PackageName` now requires `newField` in config

### New Features

[Each item: what it does, which package, brief usage example if non-obvious]

- **`featureName`** (`@reactive-agents/package`): Description of what it does.
  ```typescript
  // Usage example
  ```

### Bug Fixes

[Each item: what was broken, what the fix is, affected package]

- Fixed `ServiceName.method()` returning stale state after concurrent updates (`@reactive-agents/package`)

### Internal / Architecture

[Significant internal changes that don't affect the public API but matter for contributors]

- Refactored `kernel-runner.ts` into composable phase pipeline
- Dead code sections isolated behind feature flag

### Migration Guide

[Only if there are breaking changes. Step-by-step migration for each breaking change.]

#### Migrating from vX.Y.Z-1

**If you use `oldMethodName`:** Replace with `newMethodName`. The signature is identical.
```

> **Repo note:** This monorepo normally uses Changesets to generate `CHANGELOG.md` on the version PR. Use Step 4 (`bun run changeset`) as the primary release mechanism; treat manual `CHANGELOG.md` edits here as optional documentation prep only when not using the automated flow.

## Step 6: Write Release Overview Document

Create `docs/releases/vX.Y.Z.md` with the same content as the changelog entry. This file serves as the standalone release announcement.

```bash
mkdir -p docs/releases
# Write the file using the template above
```

## Step 7: Update Agent Memory

Update `.agents/MEMORY.md` with the new version status:

```markdown
## Current Status ([Month] [Day], [Year])
- **vX.Y.Z released** — [one-line summary of what shipped]
```

Also update Claude project memory in `~/.claude/projects/*/memory/` if maintained.

## Step 8: Final Checklist

```bash
# Verify changeset file exists
ls .changeset/

# Confirm CHANGELOG.md has the new entry at top
head -20 CHANGELOG.md

# Confirm release doc exists
ls docs/releases/

# Final full test run
bun test --timeout 15000

# Tag if ready (only after all checks pass)
git tag vX.Y.Z
```

- [ ] All tests pass
- [ ] Build succeeds
- [ ] Typecheck clean
- [ ] AGENTS.md test/package counts current
- [ ] README.md accurate
- [ ] Changeset file created
- [ ] CHANGELOG.md has new entry with mandatory template sections (or changeset will generate it)
- [ ] `docs/releases/vX.Y.Z.md` created
- [ ] `.agents/MEMORY.md` updated with release status
