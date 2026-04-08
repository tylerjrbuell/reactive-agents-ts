---
name: update-docs
description: Synchronize all documentation (Starlight docs, README, AGENTS, skills, memory) after code changes. Use after completing a feature, fixing bugs, or changing public APIs.
disable-model-invocation: true
argument-hint: [optional: package-name or "release X.Y.Z"]
---

# Update Documentation After Code Changes

## Overview

This skill ensures all documentation stays truthful after code changes. Run it after completing any feature work.

Canonical source of truth for agent guidance is `AGENTS.md`. `CLAUDE.md` is a compatibility pointer only.

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

## Step 2: Update AGENTS.md (Canonical)

Check and update these sections as needed:

1. **Project status snapshot** — test count, package count, latest shipped capabilities
2. **Build commands** — keep commands current and scoped
3. **Documentation workflow** — ensure references point to AGENTS/README/docs, not CLAUDE
4. **Project skills index** — keep all `.agents/skills/*/SKILL.md` entries accurate
5. **Key file paths** — include memory files and active docs

## Step 3: Update README.md

Check and update:

1. **Subtitle** — package/layer counts
2. **Packages table** — add new packages
3. **Architecture diagram** — add new layers
4. **Providers table** — add new providers
5. **Strategies table** — add new strategies
6. **Development section** — test count
7. **Code examples** — verify they use actual API

Cross-check against latest release notes (`CHANGELOG.md`) for:
- Native function-calling behavior and tool-call fallback details
- Required-tools gating, dynamic stopping, and per-tool call budgets
- Builder/API additions (meta-tools, skills, composition, dynamic tools, pricing)

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

Required audit pages for framework-level changes:
- `apps/docs/src/content/docs/reference/builder-api.md`
- `apps/docs/src/content/docs/reference/configuration.md`
- `apps/docs/src/content/docs/guides/reasoning.md`
- `apps/docs/src/content/docs/guides/tools.md`
- `apps/docs/src/content/docs/guides/contributing.md`
- `apps/docs/src/content/docs/features/llm-providers.md`

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

## Step 6: Update Agent Skills (`.agents/skills/`)

The `.agents/skills/` directory contains skills used by agents to build with this framework. These must stay accurate — stale code examples or wrong API signatures directly cause agent errors.

### Always check after:
- Builder method signatures change (`.withReasoning()`, `.withTools()`, `.withMemory()`, etc.)
- New builder methods are added (`.withFallbacks()`, `.withLogging()`, `.withHealthCheck()`, etc.)
- New stream event types are added (`IterationProgress`, `StreamCancelled`, etc.)
- New conversational APIs added (`agent.chat()`, `agent.session()`)
- Config field names change (e.g., `resultCompression` field names)
- New strategy options added (`enableStrategySwitching`, etc.)

### Skills index (all project skills)

| Skill file | What to check |
|---|---|
| `architecture-reference/SKILL.md` | Dependency graph, build order, canonical docs pointers |
| `build-coordinator/SKILL.md` | Multi-agent coordination flow, parallelization assumptions |
| `build-package/SKILL.md` | Spec mapping and canonical references (AGENTS, not CLAUDE) |
| `codebase-to-course/SKILL.md` | Prompt quality, output structure, teaching flow |
| `effect-ts-patterns/SKILL.md` | Core Effect-TS constraints and anti-patterns |
| `implement-service/SKILL.md` | Service scaffolding patterns and exports |
| `implement-test/SKILL.md` | Test harness usage and timeout guidance |
| `llm-api-contract/SKILL.md` | `complete()/stream()/embed()` signatures and tool-call contracts |
| `memory-patterns/SKILL.md` | SQLite/WAL/FTS5/vector memory patterns |
| `review-patterns/SKILL.md` | 8-category compliance checks |
| `update-docs/SKILL.md` | This workflow, docs + memory synchronization |
| `validate-build/SKILL.md` | Build/test/review quality gates |

### How to update

1. For each skill affected by the change, open the file
2. Update code examples to use the current API
3. Update builder patterns in the "Agent objective" or "Implementation baseline" sections
4. Bump `version` in the frontmatter if the change is significant
5. Do NOT change prose that is still accurate — minimal diffs only

## Step 7: Update Project Memory

When docs or workflow guidance changes, update memory artifacts so future agents inherit the same context:

1. Update `.agents/MEMORY.md` with a concise entry under current status and shipped changes.
2. Update repository memory notes in `/memories/repo/` when conventions or canonical doc locations change.
3. Keep memory entries terse and factual (what changed, why it matters, where to look).

## Step 8: Update ROADMAP.md

If a milestone shipped:
- Move items from "target" to "✅ Released" with actual date
- Update the "Current State" section
- Update the Competitive Positioning table

## Step 9: Verify

```bash
# Docs build
cd apps/docs && npx astro build

# Check for stale references
grep -r "CLAUDE.md.*package map\|CLAUDE.md.*build commands\|withTestResponses\|15 packages\|17 packages\|2194 tests" AGENTS.md README.md apps/docs .agents/skills
```

## Step 10: CLAUDE.md Compatibility Check

Ensure `CLAUDE.md` remains a short compatibility pointer to `AGENTS.md` and does not become a second source of truth.

## Quick Reference: Current Stats

Update these numbers when they change:
- Test count: check with `bun test 2>&1 | tail -3`
- Package count: `ls packages/ | wc -l`
- Doc pages: `ls apps/docs/src/content/docs/**/*.md | wc -l`
