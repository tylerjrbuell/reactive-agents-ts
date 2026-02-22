---
name: update-docs
description: Synchronize all documentation (Starlight docs, README, CHANGELOG, CLAUDE.md) after code changes. Use after completing a feature, fixing bugs, or changing public APIs.
disable-model-invocation: true
argument-hint: [optional: package-name or "release X.Y.Z"]
---

# Update Documentation After Code Changes

## Overview

This skill ensures all documentation stays truthful after code changes. Run it after completing any feature work.

## Arguments

`$ARGUMENTS` = optional package name (e.g., `a2a`) or release tag (e.g., `release 0.5.0`).

If no arguments, scan for what changed and update accordingly.

## Step 1: Determine What Changed

```bash
# See what files changed
git diff --name-only HEAD
git diff --stat HEAD

# Count current tests
bun test 2>&1 | tail -5
```

Categorize changes:
- [ ] New package created?
- [ ] New/changed builder methods?
- [ ] New CLI commands?
- [ ] New reasoning strategies?
- [ ] New LLM providers?
- [ ] Test count changed?
- [ ] API signatures changed?
- [ ] New features needing docs pages?

## Step 2: Update CLAUDE.md

Check and update these sections as needed:

1. **Project Status** (line 5) — test count, package count
2. **Build Commands** — test count in comment
3. **Skills Library** — if new skills added
4. **Spec File Index** — if new spec files
5. **Package Map** — if new packages

## Step 3: Update README.md

Check and update:

1. **Subtitle** — package/layer counts
2. **Packages table** — add new packages
3. **Architecture diagram** — add new layers
4. **Providers table** — add new providers
5. **Strategies table** — add new strategies
6. **Development section** — test count
7. **Code examples** — verify they use actual API

## Step 4: Update CHANGELOG.md

If this is a release (`$ARGUMENTS` starts with "release"):

```markdown
## [X.Y.Z] — YYYY-MM-DD

### Added
- List each new feature with package scope in parentheses

### Changed
- List package version bumps: `pkg` X.Y.Z → A.B.C: description

### Fixed
- List bug fixes with root cause context

### Stats
- N tests across M files (was P/Q)
```

## Step 5: Update Starlight Docs Site

### Check if pages need updating

Search docs for references to changed APIs:
```bash
grep -r "oldMethodName\|oldPackageName" apps/docs/src/content/docs/
```

### Pages to check by change type

| Changed | Check These Pages |
|---------|-------------------|
| Builder API | `reference/builder-api.md`, `guides/quickstart.md`, `guides/your-first-agent.md` |
| CLI | `reference/cli.md` |
| Reasoning | `guides/reasoning.md`, `features/llm-providers.md` |
| Tools | `guides/tools.md` |
| Memory | `guides/memory.md` |
| Providers | `features/llm-providers.md` |
| Architecture | `concepts/architecture.md`, `concepts/layer-system.md` |
| New feature | Create new page in `features/` or `guides/` |

### If new docs page needed

Create at `apps/docs/src/content/docs/{section}/{name}.md`:

```markdown
---
title: Page Title
description: Brief description for SEO
---

Content here...
```

Sidebar is auto-generated from directory structure. Use `sidebar: { order: N }` in frontmatter to control ordering.

## Step 6: Update ROADMAP.md

If a milestone shipped:
- Move items from "target" to "✅ Released" with actual date
- Update the "Current State" section
- Update the Competitive Positioning table

## Step 7: Verify

```bash
# Docs build
cd apps/docs && npx astro build

# Check for stale references
grep -r "0\.3\.0\|300 tests\|15 packages" README.md CLAUDE.md apps/docs/
```

## Step 8: Update AGENTS.md

If workflow patterns changed, update the relevant section in `AGENTS.md`.

## Quick Reference: Current Stats

Update these numbers when they change:
- Test count: check with `bun test 2>&1 | tail -3`
- Package count: `ls packages/ | wc -l`
- Doc pages: `ls apps/docs/src/content/docs/**/*.md | wc -l`
