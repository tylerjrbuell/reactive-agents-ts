---
name: update-docs
description: Full docs lint, validate, and update pass — Starlight docs (incl. What's New release banners), README, AGENTS, CAPABILITIES manifest, CHANGELOG, skills, memory. Use after completing a feature, fixing bugs, changing public APIs, or cutting a release, and whenever docs need a truthfulness/drift audit across the board.
disable-model-invocation: true
argument-hint: package-name or "release X.Y.Z"
---

# Update Documentation After Code Changes

## Overview

This skill is the full-repo docs lint + validate + update pass: it doesn't just patch the one doc a change obviously touches, it re-checks every canonical doc surface (AGENTS.md, README, CAPABILITIES.md, CHANGELOG, Starlight site incl. What's New banners, agent skills, memory, wiki) for drift and fixes what it finds. Run it after completing any feature work, and run the full Step 10 lint pass even when a change seems doc-irrelevant.

Canonical source of truth for agent guidance is `AGENTS.md`. `CLAUDE.md` is a compatibility pointer only.

## Integration with the Wiki Workflow

This skill follows the canonical 4-step pattern documented at [[wiki/Development/Wiki-Workflow]]. Specifically:

- **Orient first:** Run `claude-obsidian:wiki-query "<feature-name>"` before writing docs to find related decisions, prior debriefs, and existing concept pages. Avoids duplicating documentation.
- **Capture correctly:** Use `claude-obsidian:obsidian-markdown` when writing wiki pages — ensures proper OFM (wikilinks, callouts, frontmatter) so the graph stays coherent.
- **Persist durably:** For significant changes (new public API, deprecation, architectural shift), use `claude-obsidian:save` to create a debrief at `wiki/Research/Debriefs/`.
- **Maintain after:** End with `claude-obsidian:wiki-lint` to catch any orphan pages or dead wikilinks introduced by the doc update.

**Storage convention reminder:** All plans, specs, decisions, and debriefs live in `wiki/`. The `docs/` directory was eliminated in May 2026. See `AGENTS.md` §Plans, Specs & Knowledge Storage.

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

-   [ ] New package created?
-   [ ] New/changed builder methods?
-   [ ] New CLI commands?
-   [ ] New reasoning strategies?
-   [ ] New LLM providers?
-   [ ] Test count changed?
-   [ ] API signatures changed?
-   [ ] New features needing docs pages?

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

-   Native function-calling behavior and tool-call fallback details
-   Required-tools gating, dynamic stopping, and per-tool call budgets
-   Builder/API additions (meta-tools, skills, composition, dynamic tools, pricing)

## Step 4: Update CHANGELOG.md

If this is a release (`$ARGUMENTS` starts with "release"):

```markdown
## [X.Y.Z] — YYYY-MM-DD

### Added

-   List each new feature with package scope in parentheses

### Changed

-   List package version bumps: `pkg` X.Y.Z → A.B.C: description

### Fixed

-   List bug fixes with root cause context

### Stats

-   N tests across M files (was P/Q)
```

## Step 5: Update CAPABILITIES.md (Manifest)

`CAPABILITIES.md` is the source of truth for what the framework claims to do — CI (`scripts/check-capabilities.ts`) fails if a listed capability has no runtime handler, or a registered handler is missing from the list.

Update when a change adds/removes/renames:

- a Reactive Intervention handler (`packages/reactive-intelligence/src/controller/handlers/*`) — dispatched section needs `` `type` — file/path `` entry
- an advisory-only intervention (visible via `pulse`, no dispatch)
- a meta-tool (`brief`, `pulse`, `activate-skill`, or new)
- an entropy sensor source, or an execution phase

Verify sync:

```bash
bun run scripts/check-capabilities.ts
```

## Step 6: Update Starlight Docs Site

### Check if pages need updating

Search docs for references to changed APIs:

```bash
grep -r "oldMethodName\|oldPackageName" apps/docs/src/content/docs/
```

### Pages to check by change type

| Changed      | Check These Pages                                                                |
| ------------ | -------------------------------------------------------------------------------- |
| Builder API  | `reference/builder-api.md`, `guides/quickstart.mdx`, `guides/your-first-agent.mdx` |
| CLI          | `reference/cli.md`                                                               |
| Reasoning    | `guides/reasoning.mdx`, `features/llm-providers.md`                               |
| Tools        | `guides/tools.md`                                                                |
| Memory       | `guides/memory.mdx`                                                              |
| Providers    | `features/llm-providers.md`                                                      |
| Architecture | `concepts/architecture.mdx`, `concepts/layer-system.md`                          |
| New feature  | Create new page in `features/` or `guides/`                                      |

Required audit pages for framework-level changes:

-   `apps/docs/src/content/docs/reference/builder-api.md`
-   `apps/docs/src/content/docs/reference/configuration.md`
-   `apps/docs/src/content/docs/guides/reasoning.mdx`
-   `apps/docs/src/content/docs/guides/tools.md`
-   `apps/docs/src/content/docs/guides/contributing.md`
-   `apps/docs/src/content/docs/features/llm-providers.md`

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

### What's New release banners

`apps/docs/src/content/docs/guides/whats-new.mdx` is the quick-scan changelog readers hit first. **On every release** (`$ARGUMENTS` starts with "release", or `CHANGELOG.md` gains a new version header), add a matching section here — don't let CHANGELOG.md and What's New drift apart.

Pattern (newest release goes directly under the intro, above older `---`-separated sections):

```markdown
## vX.Y.Z — <one-line theme> (Month Year)

<Aside type="note" title="Breaking changes">   <!-- omit Aside if none -->
...
</Aside>

One-paragraph summary of the release's character (hardening pass / feature release / security fix).

**Added:** / **Changed:** / **Fixed:** — bullet groups, each bullet a plain-English claim a user would search for, linking to the relevant guide/reference page where one exists.
```

Keep entries evidence-based: only claim what actually shipped (cross-check `CHANGELOG.md` and `git log --oneline vPREV..HEAD`), same truthfulness bar as every other doc this skill touches.

## Step 7: Sync Canonical Documents (Critical)

**After ANY code change, verify the canonical documents stay synchronized.**

> **2026-08-18 correction:** this section previously pointed at `docs/spec/docs/` (eliminated
> in the May 2026 wiki consolidation — see `AGENTS.md` hard rule "NO new files in `docs/`")
> and at `04-PROJECT-STATE.md`/`05-DESIGN-NORTH-STAR.md`/`06-AUDIT-v0.10.0.md`/
> `07-ROADMAP-v1.0.md`, all deprecated. Corrected below against the current authority chain —
> see `wiki/Architecture/Specs/DOCUMENT_INDEX.md`.

### Canonical Document Sync Rules

Numbered specs live in `wiki/Architecture/Specs/` (`NN-NAME.md`); current authority is `09-UNIFIED-PROGRAM.md` > `08-AGENTIC-OS-NORTH-STAR.md`. See `AGENTS.md` §Documentation Workflow for the fuller trigger table (also covers README/Starlight/CHANGELOG).

The code↔doc pairs below are judgment calls (this skill decides what needs updating). A subset with a clean git-history signal — a rule's code paths changed but its doc paths didn't — is instead tracked mechanically by `scripts/docs-sync-ledger.json` + `scripts/check-docs-sync.ts` (Step 10): no LLM judgment needed for the two easy cases (nothing changed / docs already moved with the code), only genuine drift surfaces. Extend the ledger by adding a rule (new code paths + doc paths + current HEAD sha as baseline) whenever you notice a pairing this table covers by judgment alone that could instead be caught by git history.

| Change Type | Update These Documents | How to Verify |
|---|---|---|
| New package shipped | `AGENTS.md` (package map), `README.md` (packages table), `apps/docs/src/data/metrics-cache.json` | `ls packages \| wc -l` matches AGENTS.md count |
| Mechanism/experiment validated | `wiki/Experiments/` (M-series note with verdict) | Verdict + rationale present in the note |
| Test count changed | `apps/docs/src/data/metrics-cache.json`, then `bun run --cwd apps/docs metrics:sync-readme` | `bun test 2>&1 \| tail -3` matches the synced count |
| New FM discovered | `wiki/Failure-Modes/` (add `FM-<X>-<name>.md`) + `02-FAILURE-MODES.md` catalog entry | FM-* code + references present |
| Architecture refined | Amend `09-UNIFIED-PROGRAM.md` in place — do not write a new north-star doc | Change logged as a ratification event, not silent drift |
| Debt found/fixed | `wiki/Architecture/DEBT-REGISTER.md` (the only debt list) | Row present with verdict + evidence file:line |
| Release shipped | `ROADMAP.md` (move to "Released") + `CHANGELOG.md` + `wiki/Hot.md` | Version present in all 3 |

### Authority Enforcement

- **DO NOT** create one-off phase/spike plans for permanent planning — use `wiki/Planning/Implementation-Plans/YYYY-MM-DD-<feature>.md`
- **If docs conflict:** Amend lower-authority doc per the `09` > `08` > ratified design-specs > active plans > evidence hierarchy; never silent drift
- **Naming:** Numbered canonical docs use `NN-NAME.md`, `10+` for new ones — `05`/`06`/`07` are double-booked with deprecated docs, don't reuse them

### Quick Sync Checklist

After completing ANY feature, bug fix, or validation:

- [ ] Test count synced (`apps/docs/src/data/metrics-cache.json` + `metrics:sync-readme`) if it changed
- [ ] `wiki/Architecture/DEBT-REGISTER.md` updated if debt was found or closed
- [ ] `wiki/Failure-Modes/` updated if a new FM was discovered
- [ ] `.agents/MEMORY.md` and Claude auto-memory updated (new findings documented)
- [ ] No orphan one-off docs left outside `wiki/` (see `AGENTS.md` §Plans, Specs & Knowledge Storage)
- [ ] No broken cross-references in `AGENTS.md` or `DOCUMENT_INDEX.md`

---

## Step 7b: Update Agent Skills (`.agents/skills/`)

The `.agents/skills/` directory contains skills used by agents to build with this framework. These must stay accurate — stale code examples or wrong API signatures directly cause agent errors.

### Always check after:

-   Builder method signatures change (`.withReasoning()`, `.withTools()`, `.withMemory()`, etc.)
-   New builder methods are added (`.withFallbacks()`, `.withLogging()`, `.withHealthCheck()`, etc.)
-   New stream event types are added (`IterationProgress`, `StreamCancelled`, etc.)
-   New conversational APIs added (`agent.chat()`, `agent.session()`)
-   Config field names change (e.g., `resultCompression` field names)
-   New strategy options added (`enableStrategySwitching`, etc.)

### Skills index (all project skills)

| Skill file                        | What to check                                                          |
| --------------------------------- | ---------------------------------------------------------------------- |
| `architecture-reference/SKILL.md` | Dependency graph, build order, canonical docs pointers                 |
| `build-coordinator/SKILL.md`      | Multi-agent coordination flow, parallelization assumptions             |
| `build-package/SKILL.md`          | Add-new-package scaffolding; canonical references (AGENTS, not CLAUDE) |
| `kernel-extension/SKILL.md`       | Composable kernel phases, guards, meta-tools                           |
| `agent-tdd/SKILL.md`              | Effect-TS TDD, timeouts, Effect.flip, server teardown                  |
| `kernel-debug/SKILL.md`           | Symptom-to-phase debugging map                                         |
| `provider-streaming/SKILL.md`     | Provider streaming and adapter hooks                                   |
| `mcp-integration/SKILL.md`        | MCP client, Docker lifecycle, transport inference                      |
| `reactive-feature-dev/SKILL.md`   | End-to-end feature workflow routing                                    |
| `prepare-release/SKILL.md`        | Release checklist, changeset, changelog template                       |
| `effect-ts-patterns/SKILL.md`     | Core Effect-TS constraints and anti-patterns                           |
| `implement-service/SKILL.md`      | Service scaffolding patterns and exports                               |
| `implement-test/SKILL.md`         | Test harness usage and timeout guidance                                |
| `llm-api-contract/SKILL.md`       | `complete()/stream()/embed()` signatures and tool-call contracts       |
| `memory-patterns/SKILL.md`        | SQLite/WAL/FTS5/vector memory patterns                                 |
| `review-patterns/SKILL.md`        | 9-category compliance checks (incl. kernel extension)                  |
| `update-docs/SKILL.md`            | This workflow, docs + memory synchronization                           |
| `validate-build/SKILL.md`         | Build/test/review quality gates                                        |
| `obsidian-vault-query/SKILL.md`   | Read the Obsidian vault (external project oracle) at session start     |
| `obsidian-vault-sync/SKILL.md`    | Write durable artifacts (decisions, experiments, sessions) to the vault|
| `obsidian-vault-hygiene/SKILL.md` | Orphan/bitrot/duplicate loops keeping the vault graph coherent         |

### How to update

1. For each skill affected by the change, open the file
2. Update code examples to use the current API
3. Update builder patterns in the "Agent objective" or "Implementation baseline" sections
4. Bump `version` in the frontmatter if the change is significant
5. Do NOT change prose that is still accurate — minimal diffs only

## Step 8: Update Project Memory

When docs or workflow guidance changes, update memory artifacts so future agents inherit the same context:

1. Update `.agents/MEMORY.md` with a concise entry under current status and shipped changes.
2. Update repository memory notes in `/memories/repo/` when conventions or canonical doc locations change.
3. Keep memory entries terse and factual (what changed, why it matters, where to look).

### Update Agent Memory Files

After any significant feature or architecture change:

-   Update `.agents/MEMORY.md` with new capabilities, patterns, or status
-   Update Claude project memory at `~/.claude/projects/*/memory/` if session-level context has changed
-   These two files keep future agents oriented without re-discovering project state

## Step 8b: Sync to the Obsidian Vault (External Oracle)

The `reactive-agents-ts` Obsidian vault at `<repo>/wiki/` is the project's external long-running oracle — compounding knowledge across sessions. Any doc update that reflects real project evolution should also land here so future agents discover it on query.

Delegate the write-back to `obsidian-vault-sync`. Rough protocol:

1. **Decision-class change** (architecture, canonical rename, public-API break) → create a note in `Decisions/YYYY-MM-DD-<slug>.md` from `Templates/Decision Template`.
2. **Experiment-class change** (benchmark result, failure-corpus finding, calibration update) → create a note in `Experiments/YYYY-MM-DD-<slug>.md`.
3. **Concept / Package / Architecture refinement** → edit the matching note in `Concepts/` / `Packages/` / `Architecture/`; bump `updated: YYYY-MM-DD` in frontmatter.
4. **New failure mode** → add an entry in `Failure-Modes/` and update `Failure-Modes/W-series Catalog.md`.
5. **Release** → update `Releases/vX.Y.Z.md` + pointer in `MOCs/Releases MOC.md`.
6. **Running Issues Log** — if the change fixes or surfaces an issue, append to `Issues/Running Issues Log.md`.

Keep writes minimal and frontmatter-disciplined. See `obsidian-vault-sync/SKILL.md` for the full protocol and `Playbooks/Agent Query API.md` inside the vault for the schema.

## Step 9: Update ROADMAP.md

If a milestone shipped:

-   Move items from "target" to "✅ Released" with actual date
-   Update the "Current State" section
-   Update the Competitive Positioning table

## Step 10: Full Lint & Validate Pass

**Run this pass every time this skill runs — not only when a change looks doc-relevant.** It's the mechanical half of "full docs lint": drift here is auto-detectable, so let the tools catch it rather than eyeballing.

```bash
# 1. Deterministic docs-vs-code sync ledger — the mechanical gate this Step
#    exists to run. Rule-based: pairs code paths with the docs that must move
#    with them, walks git history since each rule's baseline commit. Fails
#    ONLY on real drift (code changed, paired docs didn't); "nothing changed"
#    and "docs already moved with the code" both pass with zero judgment.
bun run docs:sync:check
#   → DRIFT for a rule: fix the named docs, then re-run; or if genuinely no
#     doc change is needed: bun run scripts/check-docs-sync.ts --ack <rule-id>
#   → New code↔doc pairing worth tracking mechanically: add a rule to
#     scripts/docs-sync-ledger.json (codePaths, docPaths, lastSha: current HEAD)

# 2. Capability manifest drift (handler ↔ CAPABILITIES.md)
bun run scripts/check-capabilities.ts

# 2b. Config-field / builder-method reference tables (configuration.md,
#     builder-api.md) — these are GENERATED from AgentConfigSchema + the
#     builder prototype, not hand-maintained. --check fails if a schema or
#     wither change wasn't followed by regenerating the tables.
bun run docs:gen:api -- --check
#   drift found → bun run docs:gen:api   (regenerates in place, commit the diff)

# 3. Cross-cutting architecture gates (envelope cascade, sub-agent inheritance, etc.)
bash scripts/check-cross-cutting.sh

# 4. Starlight/Astro build — catches broken links and MDX errors
cd apps/docs && rm -rf dist && bunx astro build; cd -

# 5. Stale numeric/reference claims across all doc surfaces
grep -rn "CLAUDE.md.*package map\|CLAUDE.md.*build commands\|withTestResponses\|15 packages\|17 packages\|2194 tests" AGENTS.md README.md CAPABILITIES.md apps/docs .agents/skills

# 6. Test/package counts actually match what docs claim
bun test 2>&1 | tail -3
ls packages | wc -l
```

**Link-path rules (Starlight/Astro rewrites relative paths):**

```
❌ ](./sibling-page)        — rendered as /guides/whats-new/sibling-page
❌ ](../guides/sibling-page) — from /guides/file becomes /guides/guides/sibling-page
✅ ](/guides/sibling-page)   — absolute path works everywhere
✅ ](../features/page)       — relative across directories OK (up then down)
```

Astro build failure looks like: `Cannot find file: file:///path/guides/guides/filename`. Fix by converting to an absolute `/section/page` link.

Treat every failure from steps 1–5 as a doc bug to fix now, not a follow-up — this is the validate half of the pass, not merely advisory.

## Step 11: CLAUDE.md Compatibility Check

Ensure `CLAUDE.md` remains a short compatibility pointer to `AGENTS.md` and does not become a second source of truth.

## Quick Reference: Current Stats

Update these numbers when they change:

-   Test count: check with `bun test 2>&1 | tail -3`
-   Package count: `ls packages/ | wc -l`
-   Doc pages: `ls apps/docs/src/content/docs/**/*.md | wc -l`
-   Capability manifest sync: `bun run scripts/check-capabilities.ts`
-   Docs-vs-code drift: `bun run docs:sync:check` (ledger: `scripts/docs-sync-ledger.json`)
-   What's New latest section: top of `apps/docs/src/content/docs/guides/whats-new.mdx`, should match `CHANGELOG.md`'s newest `## [X.Y.Z]` header
